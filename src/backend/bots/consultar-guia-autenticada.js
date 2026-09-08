const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const fileUtils = require('../utils/file-utils.js');
const angUtils = require('../utils/angular-utils.js');
const navUtils = require('../utils/navigation-utils.js');
const logger = require('../utils/logger.js');

puppeteer.use(StealthPlugin());

const DEFAULT_SELECTORS = {
    inputId: '#in-iddeposito',
    cardComprovante: 'h4::-p-text(Comprovante de Depósito)',
    btnConsultar: 'button::-p-text(Consultar ID)',
    btnVisualizar: 'button::-p-text(Visualizar Comprovante)'
};

const DEFAULT_CONFIG = {
    url_portal: 'https://novodepositojudicial.caixa.gov.br/comprovante',
    url_formulario_direto: 'https://novodepositojudicial.caixa.gov.br/comprovante/deposito',
    url_direta: 'https://novodepositojudicial.caixa.gov.br/comprovante/deposito',
    timeout_padrao_ms: 15000,
    timeout_captcha_ms: 60000,
    timeout_deteccao_captcha_ms: 1200,
    timeout_blob_ms: 20000,
    texto_guia_nao_paga: 'Não consta pagamento para o ID informado',
    pasta_pdf: '',
    seletores: DEFAULT_SELECTORS
};

const CAPTCHA_SELECTORS = [
    'iframe[src*="captcha" i]',
    'iframe[title*="captcha" i]',
    '[id*="captcha" i]',
    '[class*="captcha" i]',
    '[data-sitekey]',
    '.g-recaptcha',
    '.h-captcha',
    'app-captcha'
].join(',');

function obterConfig(configPerfil = {}) {
    const fixas = configPerfil.configuracoes_fixas || {};
    const url_portal = configPerfil.url_portal || DEFAULT_CONFIG.url_portal;
    const url_formulario_direto = configPerfil.url_formulario_direto || configPerfil.url_portal || DEFAULT_CONFIG.url_formulario_direto;

    return {
        ...DEFAULT_CONFIG,
        ...fixas,
        url_portal,
        url_formulario_direto,
        url_direta: url_formulario_direto,
        fixas,
        seletores: {
            ...DEFAULT_SELECTORS,
            ...(fixas.seletores || {})
        }
    };
}

function normalizarTexto(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor).trim();
}

function valorDaLinha(linha, mapa, chave) {
    return linha[mapa?.[chave] || chave];
}

async function instalarEspiaoBlobNaPagina(page) {
    await page.evaluate(() => {
        if (window.__blobStoreInstalado) return;
        window.__blobStore = [];

        const _createObjectURL = URL.createObjectURL.bind(URL);
        URL.createObjectURL = function (obj) {
            const url = _createObjectURL(obj);
            window.__blobStore.push({ blob: obj, url, type: obj?.type, size: obj?.size });
            return url;
        };

        window.__blobStoreInstalado = true;
    });
}

async function extrairPdfDaMemoria(page, timeoutMs = DEFAULT_CONFIG.timeout_blob_ms) {
    const inicio = Date.now();

    while (Date.now() - inicio < timeoutMs) {
        await navUtils.delay(400);

        const base64 = await page.evaluate(async () => {
            const store = window.__blobStore ?? [];
            const entrada = store.find(e => e.type === 'application/pdf');
            if (!entrada?.blob) return null;

            const ab = await entrada.blob.arrayBuffer();
            const bytes = new Uint8Array(ab);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return window.btoa(binary);
        });

        if (base64) {
            await page.evaluate(() => { window.__blobStore = []; });
            return Buffer.from(base64, 'base64');
        }
    }

    throw new Error(`Timeout (${timeoutMs}ms): Blob PDF não apareceu na memória após o clique.`);
}

async function fecharAbasBlob(browser) {
    const targets = browser.targets();
    for (const t of targets) {
        if (t.type() === 'page' && t.url().startsWith('blob:')) {
            const aba = await t.page().catch(() => null);
            if (aba) await aba.close().catch(() => {});
        }
    }
}

async function detectarCaptchaVisivel(page, timeoutMs) {
    if (typeof page.waitForFunction !== 'function') return true;

    const captchaDetectado = await page.waitForFunction((seletorCaptcha) => {
        const elementoVisivel = (elemento) => {
            const estilo = window.getComputedStyle(elemento);
            const retangulo = elemento.getBoundingClientRect();
            return estilo.display !== 'none'
                && estilo.visibility !== 'hidden'
                && retangulo.width > 0
                && retangulo.height > 0;
        };

        return Array.from(document.querySelectorAll(seletorCaptcha)).some(elementoVisivel);
    }, { timeout: timeoutMs }, CAPTCHA_SELECTORS).catch(() => null);

    return Boolean(captchaDetectado);
}

async function aguardarResultadoConsultaId(page, config) {
    const timeoutMs = config.timeout_captcha_ms;
    const manterPendente = () => new Promise(() => {});
    let timer;

    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`Timeout (${timeoutMs}ms): consulta do ID não apresentou comprovante nem mensagem de guia não paga.`));
        }, timeoutMs);
    });

    const comprovantePromise = page.waitForSelector(config.seletores.btnVisualizar, {
        visible: true,
        timeout: timeoutMs
    })
        .then(() => ({ tipo: 'COMPROVANTE' }))
        .catch(manterPendente);

    const guiaNaoPagaPromise = typeof page.waitForFunction === 'function'
        ? page.waitForFunction((textoNaoPaga) => {
            const normalizar = (texto) => String(texto || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();

            return normalizar(document.body?.innerText).includes(normalizar(textoNaoPaga));
        }, { timeout: timeoutMs }, config.texto_guia_nao_paga)
            .then(() => ({
                tipo: 'GUIA_NAO_PAGA',
                mensagem: config.texto_guia_nao_paga
            }))
            .catch(manterPendente)
        : manterPendente();

    try {
        const resultado = await Promise.race([comprovantePromise, guiaNaoPagaPromise, timeoutPromise]);

        if (resultado.tipo === 'GUIA_NAO_PAGA') {
            throw new Error(`Guia não paga: ${resultado.mensagem}. Caso deseje efetuar seu pagamento, utilize as informações apresentadas nessa tela.`);
        }

        return resultado;
    } finally {
        clearTimeout(timer);
    }
}

async function aguardarCaptchaOuConsultarId(page, config, logTotal, numLinha) {
    const captchaSolicitado = await detectarCaptchaVisivel(
        page,
        config.timeout_deteccao_captcha_ms || DEFAULT_CONFIG.timeout_deteccao_captcha_ms
    );

    if (!captchaSolicitado) {
        logTotal(`✅  [${numLinha}] Captcha não solicitado. Consultando ID automaticamente...`);
        await page.waitForSelector(config.seletores.btnConsultar, { visible: true, timeout: 1500 });
        await page.click(config.seletores.btnConsultar);
    } else {
        logTotal(`⚠️  [${numLinha}] Ação necessária: resolva o Captcha, clique em "Consultar ID" e aguarde o robô continuar.`);
    }

    await aguardarResultadoConsultaId(page, config);
    logTotal(`✔️  [${numLinha}] Consulta liberada. Acionando captura...`);
}

function sanitizarNomeArquivo(texto) {
    if (!texto) return '';
    // 1. Normalizar Unicode (remover acentos)
    let normalizado = String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // 2. Substituir caracteres invalidos e espaços por sublinhado (_)
    normalizado = normalizado.replace(/[\\/:*?"<>|\r\n\t\s]/g, '_');
    // 3. Limitar a 100 caracteres
    return normalizado.substring(0, 100);
}

async function processarLinhaConsulta(page, linha, numLinha, configPerfil, diretorios, logTotal, totalLinhas) {
    const config = obterConfig(configPerfil);
    const observacaoOriginal = normalizarTexto(valorDaLinha(linha, configPerfil.mapeamento_colunas, 'OBSERVACAO'));
    const idDeposito = normalizarTexto(valorDaLinha(linha, configPerfil.mapeamento_colunas, 'ID_DEPOSITO'));
    if (!idDeposito) throw new Error('ID_DEPOSITO ausente na linha.');

    const observacaoSanitizada = sanitizarNomeArquivo(observacaoOriginal);
    const temCaracteresUteis = observacaoSanitizada.replace(/_/g, '').length > 0;
    const nomeBase = temCaracteresUteis ? observacaoSanitizada : idDeposito;

    if (!temCaracteresUteis) {
        logTotal(`⚠️  [${numLinha}/${totalLinhas}] OBSERVACAO ausente na linha. O ID será utilizado para nomear o comprovante.`);
    }

    logTotal(`▶️  [${numLinha}/${totalLinhas}] Processando Guia: ${observacaoOriginal || idDeposito}`);

    await page.goto(config.url_direta, { waitUntil: 'networkidle2' });
    await instalarEspiaoBlobNaPagina(page);

    const pastaDestino = path.join(diretorios.evidencias, config.pasta_pdf);
    if (!fs.existsSync(pastaDestino)) fs.mkdirSync(pastaDestino, { recursive: true });

    let nomeArquivo = `comprovante-${nomeBase}.pdf`;
    let caminhoArquivo = path.join(pastaDestino, nomeArquivo);

    if (temCaracteresUteis && fs.existsSync(caminhoArquivo)) {
        nomeArquivo = `comprovante-${observacaoSanitizada}-${idDeposito}.pdf`;
        caminhoArquivo = path.join(pastaDestino, nomeArquivo);
    }

    await page.waitForSelector(config.seletores.inputId, { visible: true });
    await angUtils.preencherCampoAngular(page, config.seletores.inputId, idDeposito);

    await aguardarCaptchaOuConsultarId(page, config, logTotal, numLinha);

    await page.click(config.seletores.btnVisualizar);
    const pdfBuffer = await extrairPdfDaMemoria(page, config.timeout_blob_ms);

    await fecharAbasBlob(page.browser());

    fs.writeFileSync(caminhoArquivo, pdfBuffer);
    logTotal(`✅  [${numLinha}/${totalLinhas}] Comprovante salvo: ${path.basename(caminhoArquivo)} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

    return {
        status: 'SUCESSO',
        dados: linha,
        linha: numLinha,
        id_deposito: idDeposito,
        arquivo: path.basename(caminhoArquivo),
        caminho_completo: caminhoArquivo,
        tamanho_bytes: pdfBuffer.length,
        mensagem: `Comprovante do ID ${idDeposito} capturado com sucesso.`
    };
}

async function aguardarAutenticacaoECartao(page, config, logTotal) {
    const urlPortal = config.url_portal || DEFAULT_CONFIG.url_portal;
    const urlFormulario = config.url_formulario_direto || DEFAULT_CONFIG.url_formulario_direto;

    logTotal(`▶️  Acessando página inicial: ${urlPortal}`);
    await page.goto(urlPortal, { waitUntil: 'networkidle2' });

    let urlAtual = '';
    try {
        urlAtual = page.url();
    } catch (_) {}

    const jaNoFormulario = urlAtual.includes('/comprovante/deposito');
    if (!jaNoFormulario) {
        logTotal(`⚠️  Ação necessária: resolva o Captcha e clique no cartão "Comprovante de Depósito" no navegador.`);
    }

    await page.waitForSelector(config.seletores.inputId, {
        visible: true,
        timeout: config.timeout_captcha_ms || 120000
    });

    logTotal(`✅  Navegação para a página de consulta confirmada (${urlFormulario}).`);
}

const { extrairDadosGuiaPdf } = require('../utils/pdf-guia-parser.js');

async function carregarDadosEntrada(entrada, logTotal) {
    if (Array.isArray(entrada)) {
        const registros = [];
        for (const item of entrada) {
            const ext = path.extname(item).toLowerCase();
            if (ext === '.pdf') {
                try {
                    const dadosPdf = extrairDadosGuiaPdf(item);
                    if (dadosPdf.idDeposito) {
                        registros.push({
                            ID_DEPOSITO: dadosPdf.idDeposito,
                            Observação: dadosPdf.observacao,
                            OBSERVACAO: dadosPdf.observacao,
                            'Proc. Judicial': dadosPdf.processo,
                            'Arquivo Origem': path.basename(item)
                        });
                    } else {
                        logTotal(`⚠️ [PDF] Não foi possível encontrar ID de depósito em: ${path.basename(item)}`);
                    }
                } catch (e) {
                    logTotal(`❌ [PDF] Erro ao ler guia ${path.basename(item)}: ${e.message}`);
                }
            } else if (ext === '.xlsx' || ext === '.xls') {
                const linhas = await fileUtils.lerExcelInput(item);
                registros.push(...linhas);
            }
        }
        logTotal(`📋 ${registros.length} registro(s) carregado(s) a partir de ${entrada.length} arquivo(s).`);
        return registros;
    }

    if (typeof entrada === 'string') {
        if (!fs.existsSync(entrada)) {
            throw new Error(`Arquivo ou diretório não encontrado: ${entrada}`);
        }

        const stat = fs.statSync(entrada);
        if (stat.isDirectory()) {
            const arquivos = fs.readdirSync(entrada).map(f => path.join(entrada, f));
            return await carregarDadosEntrada(arquivos, logTotal);
        }

        const ext = path.extname(entrada).toLowerCase();
        if (ext === '.pdf') {
            const dadosPdf = extrairDadosGuiaPdf(entrada);
            if (!dadosPdf.idDeposito) {
                throw new Error(`Não foi possível extrair o ID de depósito da guia PDF: ${path.basename(entrada)}`);
            }
            logTotal(`📄 Guia PDF carregada: ${path.basename(entrada)} (ID: ${dadosPdf.idDeposito} | Obs: ${dadosPdf.observacao || 'N/A'})`);
            return [{
                ID_DEPOSITO: dadosPdf.idDeposito,
                Observação: dadosPdf.observacao,
                OBSERVACAO: dadosPdf.observacao,
                'Proc. Judicial': dadosPdf.processo,
                'Arquivo Origem': path.basename(entrada)
            }];
        }

        const dados = await fileUtils.lerExcelInput(entrada);
        logTotal(`📋 ${dados.length} registro(s) encontrado(s) no Excel.`);
        return dados;
    }

    throw new Error('Tipo de entrada inválido para consulta de guia.');
}

async function executarConsultaGuiaAutenticada(configPerfil, caminhoExcel, diretorioSaida, enviarLog, controle) {
    const logTotal = (msg) => {
        enviarLog(msg);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`);
    };

    let browser = null;
    const resultados = [];

    try {
        const diretorios = fileUtils.prepararDiretorios(diretorioSaida, configPerfil.nome);
        const dados = await carregarDadosEntrada(caminhoExcel, logTotal);
        const config = obterConfig(configPerfil);

        if (dados.length === 0) {
            logTotal('⚠️ Nenhum registro válido encontrado para consulta.');
            return { sucesso: true, resumo: { qtdSucesso: 0, qtdErro: 0 } };
        }

        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: ['--start-maximized']
        });

        const page = (await browser.pages())[0] || await browser.newPage();
        if (typeof page.setDefaultTimeout === 'function') {
            page.setDefaultTimeout(config.timeout_padrao_ms);
        }

        if (dados.length > 0 && (!controle || !controle.abortar)) {
            await aguardarAutenticacaoECartao(page, config, logTotal);
        }

        for (let i = 0; i < dados.length; i++) {
            if (controle && controle.abortar) {
                logTotal('⏹️ Processo interrompido pelo usuário.');
                break;
            }

            const linha = dados[i];
            const numLinha = i + 1;
            const idAtual = normalizarTexto(valorDaLinha(linha, configPerfil.mapeamento_colunas, 'ID_DEPOSITO'));

            try {
                const res = await processarLinhaConsulta(page, linha, numLinha, configPerfil, diretorios, logTotal, dados.length);
                resultados.push(res);
            } catch (erro) {
                logTotal(`❌  [${numLinha}] Erro no ID ${idAtual}: ${erro.message}`);
                logger.gravarLogSistema(`[BOT-${configPerfil.nome}] STACK: ${erro.stack}`);
                resultados.push({
                    status: 'ERRO',
                    dados: linha,
                    linha: numLinha,
                    id_deposito: idAtual,
                    arquivo: null,
                    tamanho_bytes: 0,
                    mensagem: erro.message
                });
            }
        }

        const resumo = await fileUtils.exportarRelatorios(diretorios.planilhas, resultados);

        logTotal('🏁 PROCESSO CONCLUÍDO!');
        logTotal(`   Sucessos: ${resumo.qtdSucesso} | Erros: ${resumo.qtdErro}`);

        return { sucesso: true, resumo };
    } catch (error) {
        logTotal(`❌ Erro Crítico: ${error.message}`);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ERRO CRÍTICO STACK: ${error.stack}`);
        return { sucesso: false, erro: error.message };
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = {
    executarConsultaGuiaAutenticada,
    obterConfig,
    aguardarAutenticacaoECartao,
    detectarCaptchaVisivel,
    aguardarResultadoConsultaId,
    aguardarCaptchaOuConsultarId,
    processarLinhaConsulta,
    instalarEspiaoBlobNaPagina,
    extrairPdfDaMemoria,
    fecharAbasBlob
};
