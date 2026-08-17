// ===========================================================
// consultar-cnd.debug.js
// Versão de diagnóstico — NÃO usar em produção.
// Adiciona logs detalhados sem alterar a lógica central.
// ===========================================================

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const fileUtils = require('../utils/file-utils.js');
const angUtils = require('../utils/angular-utils.js');
const navUtils = require('../utils/navigation-utils.js');
const logger = require('../utils/logger.js');
const { extrairCertidoes } = require('../utils/certidaoExtractor.js');

puppeteer.use(StealthPlugin());

// -----------------------------------------------------------
// DEBUG HELPER — prefixo [DBG] para filtrar nos logs
// -----------------------------------------------------------
function dbg(...args) {
    //const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    //console.log(`[DBG ${ts}]`, ...args);
}

const DEFAULT_CONFIG = {
    url_direta: 'https://www.sefaz.go.gov.br/Certidao/Emissao/',
    tipo_certidao: 'Divida Ativa',
    timeout_padrao_ms: 15000,
    timeout_confirmacao_ms: 5000,
    timeout_pdf_ms: 30000,
    pasta_pdf: '',
    pessoa_fisica: {
        select_tipo_certidao: 'Certidao.Tipo',
        radio_tipo_documento: 'Certidao.TipoDocumentoCPF',
        campo_documento: 'Certidao.NumeroDocumentoCPF',
        radio_espolio: 'Certidao.EspolioN'
    },
    pessoa_juridica: {
        select_tipo_certidao: 'Certidao.Tipo',
        radio_tipo_documento: 'Certidao.TipoDocumentoCNPJ',
        campo_documento: 'Certidao.NumeroDocumentoCNPJ',
        radio_espolio: 'Certidao.EspolioN'
    },
    botao_emitir: 'Emitir',
    botao_confirmar_emissao: 'Certidao.ConfirmaNomeContribuinteSim'
};

function obterConfig(configPerfil = {}) {
    const fixas = configPerfil.configuracoes_fixas || {};
    return {
        ...DEFAULT_CONFIG,
        ...fixas,
        url_direta: configPerfil.url_formulario_direto || configPerfil.url_portal || DEFAULT_CONFIG.url_direta,
        pessoa_fisica: { ...DEFAULT_CONFIG.pessoa_fisica, ...(fixas.pessoa_fisica || {}) },
        pessoa_juridica: { ...DEFAULT_CONFIG.pessoa_juridica, ...(fixas.pessoa_juridica || {}) }
    };
}

function normalizarDocumento(valor) {
    return String(valor || '').replace(/\D/g, '');
}

function formatarDocumento(documento) {
    const digitos = normalizarDocumento(documento);
    if (digitos.length === 11) return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (digitos.length === 14) return digitos.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return String(documento || '').trim();
}

function detectarTipoDocumento(documento) {
    const digitos = normalizarDocumento(documento);
    if (digitos.length === 11) return 'pessoa_fisica';
    if (digitos.length === 14) return 'pessoa_juridica';
    throw new Error(`CPF/CNPJ invalido: ${documento || '(vazio)'}`);
}

function escapeAttr(valor) {
    return String(valor).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function seletorPorId(id) {
    return `[id="${escapeAttr(id)}"]`;
}

function caminhoBaseArquivo(valor) {
    if (!valor) return '';
    return path.basename(String(valor));
}

function prepararEntradasPdf(caminhosPdf) {
    const arquivos = Array.isArray(caminhosPdf) ? caminhosPdf : [caminhosPdf];
    return arquivos.filter(Boolean);
}

function consolidarCertidoes(relatorioExtracao, caminhosPdf) {
    const arquivosOrigem = prepararEntradasPdf(caminhosPdf).map(caminhoBaseArquivo).join('; ');
    const negativas = Array.isArray(relatorioExtracao?.negativa) ? relatorioExtracao.negativa : [];
    const positivas = Array.isArray(relatorioExtracao?.positiva) ? relatorioExtracao.positiva : [];
    const porDocumento = new Map();

    for (const [statusExtraido, lista] of [['negativa', negativas], ['positiva', positivas]]) {
        for (const certidao of lista) {
            const documentoNormalizado = normalizarDocumento(certidao?.cpf_cnpj);
            if (!documentoNormalizado) continue;

            const entrada = porDocumento.get(documentoNormalizado) || {
                ...certidao,
                cpf_cnpj: formatarDocumento(certidao.cpf_cnpj),
                documento_normalizado: documentoNormalizado,
                status_extraido: statusExtraido,
                status_extraidos: [],
                situacoes_extraidas: [],
                ocorrencias: 0,
                arquivos_origem: arquivosOrigem
            };

            entrada.ocorrencias += 1;
            if (!entrada.status_extraidos.includes(statusExtraido)) entrada.status_extraidos.push(statusExtraido);
            if (certidao?.situacao && !entrada.situacoes_extraidas.includes(certidao.situacao)) entrada.situacoes_extraidas.push(certidao.situacao);
            if (statusExtraido === 'positiva') {
                entrada.status_extraido = 'positiva';
                entrada.situacao = certidao.situacao || entrada.situacao;
            }
            porDocumento.set(documentoNormalizado, entrada);
        }
    }

    return {
        contagem: { negativa: negativas.length, positiva: positivas.length },
        positivas,
        negativas,
        documentos: Array.from(porDocumento.values())
    };
}

// -----------------------------------------------------------
// DEBUG: isRespostaPdf com log de TODAS as respostas recebidas
// -----------------------------------------------------------
function isRespostaPdf(response) {
    if (!response) return false;
    const headers = typeof response.headers === 'function' ? response.headers() : {};
    const contentType = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
    const url = typeof response.url === 'function' ? response.url() : '';

    // Loga todas as respostas para inspecionar o que chega na nova aba
    dbg(`RESPOSTA | status=${response.status()} | content-type="${contentType}" | url=${url}`);

    const isPdf = contentType.includes('application/pdf') || /\.pdf(?:$|[?#])/i.test(url);
    if (isPdf) dbg('>>> PDF DETECTADO na resposta acima <<<');
    return isPdf;
}

// -----------------------------------------------------------
// aguardarProximoPdf — com debug de ciclo de vida de targets/páginas
// -----------------------------------------------------------
function aguardarProximoPdf(browser, timeoutMs, paginasIniciais = []) {
    return new Promise((resolve, reject) => {
        const paginasMonitoradas = new Set();
        let finalizado = false;

        dbg(`aguardarProximoPdf iniciado | timeout=${timeoutMs}ms | paginasIniciais=${paginasIniciais.length}`);

        const limpar = () => {
            clearTimeout(timer);
            if (typeof browser.off === 'function') browser.off('targetcreated', monitorarTarget);
            else if (typeof browser.removeListener === 'function') browser.removeListener('targetcreated', monitorarTarget);
            for (const page of paginasMonitoradas) {
                if (typeof page.off === 'function') page.off('response', capturarResposta);
                else if (typeof page.removeListener === 'function') page.removeListener('response', capturarResposta);
            }
            dbg(`aguardarProximoPdf limpo | paginasMonitoradas=${paginasMonitoradas.size}`);
        };

        const resolver = (resultado) => {
            if (finalizado) return;
            finalizado = true;
            limpar();
            dbg(`aguardarProximoPdf RESOLVIDO | url=${resultado.url} | bytes=${resultado.buffer?.length}`);
            resolve(resultado);
        };

        const rejeitar = (erro) => {
            if (finalizado) return;
            finalizado = true;
            limpar();
            dbg(`aguardarProximoPdf REJEITADO | erro=${erro.message}`);
            reject(erro);
        };

        const capturarResposta = async (response) => {
            if (!isRespostaPdf(response)) return;
            
            try {
                dbg('Tentando ler buffer do PDF...');
                let buffer = await response.buffer();
                
                // Verifica a assinatura do arquivo (Magic Bytes)
                const magic = buffer.slice(0, 4).toString('ascii');

                if (magic !== '%PDF') {
                    dbg('🚨 Bug do Chrome PDF Viewer detectado! O buffer retornou HTML. Aplicando extração via Fetch interno...');

                    // Clona as propriedades da requisição interceptada
                    const req = response.request();
                    const url = req.url();
                    const method = req.method();
                    const postData = req.postData();
                    const headers = req.headers();

                    // Filtramos apenas os cabeçalhos essenciais para evitar bloqueios de CORS/Host
                    const safeHeaders = {};
                    if (headers['content-type']) safeHeaders['Content-Type'] = headers['content-type'];
                    if (headers['accept']) safeHeaders['Accept'] = headers['accept'];

                    // Recupera a página principal (a que submeteu o form e detém a sessão)
                    const paginaPrincipal = paginasIniciais[0] || (await browser.pages())[0];

                    if (!paginaPrincipal) throw new Error("Nenhuma página ativa para executar o fetch.");

                    // Executa o fetch nativo por dentro do navegador para herdar cookies e sessão
                    const base64Pdf = await paginaPrincipal.evaluate(async (fUrl, fMethod, fHeaders, fBody) => {
                        const res = await fetch(fUrl, {
                            method: fMethod,
                            headers: fHeaders,
                            body: fBody
                        });
                        
                        if (!res.ok) throw new Error(`HTTP Status: ${res.status}`);
                        
                        const blob = await res.blob();
                        
                        // Converte o Blob para Base64 nativamente
                        return new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result.split(',')[1]);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                    }, url, method, safeHeaders, postData);

                    // Converte a string Base64 extraída de volta para Buffer no ambiente Node
                    buffer = Buffer.from(base64Pdf, 'base64');
                    dbg(`✅ Fetch alternativo concluído com sucesso | bytes=${buffer.length}`);
                } else {
                    dbg(`✅ Buffer lido nativamente com sucesso | bytes=${buffer.length}`);
                }

                resolver({ buffer, url: typeof response.url === 'function' ? response.url() : '' });
            } catch (erro) {
                rejeitar(new Error(`PDF detectado, mas falhou ao extrair conteudo binario: ${erro.message}`));
            }
        };

        const monitorarPagina = (page, origem = 'desconhecida') => {
            if (!page || paginasMonitoradas.has(page)) {
                dbg(`monitorarPagina IGNORADA (já monitorada ou nula) | origem=${origem}`);
                return;
            }
            paginasMonitoradas.add(page);
            dbg(`monitorarPagina REGISTRADA | origem=${origem} | total monitoradas=${paginasMonitoradas.size}`);
            if (typeof page.on === 'function') {
                page.on('response', capturarResposta);
            }
        };

        const monitorarTarget = async (target) => {
            const tipo = typeof target.type === 'function' ? target.type() : 'desconhecido';
            const targetUrl = typeof target.url === 'function' ? target.url() : 'N/A';
            dbg(`TARGET CRIADO | tipo=${tipo} | url=${targetUrl}`);

            try {
                if (tipo !== 'page') {
                    dbg(`TARGET ignorado (nao é page)`);
                    return;
                }
                const page = await target.page();
                monitorarPagina(page, `targetcreated url=${targetUrl}`);
            } catch (err) {
                dbg(`Erro ao obter page do target: ${err.message}`);
            }
        };

        const timer = setTimeout(() => {
            // DEBUG EXTRA: lista o estado atual de todas as páginas no timeout
            (async () => {
                try {
                    const todasPaginas = await browser.pages();
                    dbg(`TIMEOUT atingido | paginas abertas no browser=${todasPaginas.length}`);
                    for (const p of todasPaginas) {
                        try {
                            const u = p.url();
                            dbg(`  - aba: ${u}`);
                        } catch (_) {
                            dbg(`  - aba: (url indisponivel)`);
                        }
                    }
                } catch (_) {}
                rejeitar(new Error(`Timeout (${timeoutMs}ms): PDF da certidao nao foi detectado na rede.`));
            })();
        }, timeoutMs);

        paginasIniciais.forEach((p, i) => monitorarPagina(p, `paginaInicial[${i}]`));

        if (typeof browser.on === 'function') {
            browser.on('targetcreated', monitorarTarget);
        }
    });
}

async function selecionarTipoCertidao(page, config) {
    const seletor = seletorPorId(config.pessoa_fisica.select_tipo_certidao);
    await page.waitForSelector(seletor, { visible: true });

    const selecionou = await page.evaluate((selector, textoDesejado) => {
        const select = document.querySelector(selector);
        if (!select) return false;
        const alvo = String(textoDesejado || '');
        const normalizar = (txt) => String(txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const opcoes = Array.from(select.options || []);
        const porTexto = opcoes.find(opcao => normalizar(opcao.textContent).includes(normalizar(alvo)));
        const porValor = opcoes.find(opcao => String(opcao.value) === alvo);
        const primeiraValida = opcoes.find(opcao => String(opcao.value || '').trim() !== '') || opcoes[0];
        const opcao = porTexto || porValor || primeiraValida;
        if (!opcao) return false;
        select.value = opcao.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }, seletor, config.tipo_certidao);

    if (!selecionou) throw new Error('Nao foi possivel selecionar o tipo da certidao.');
}

async function clicarPorId(page, id) {
    const seletor = seletorPorId(id);
    await page.waitForSelector(seletor, { visible: true });
    await page.click(seletor);
}

async function preencherCampoPorId(page, id, valor) {
    const seletor = seletorPorId(id);
    await page.waitForSelector(seletor, { visible: true });
    await page.click(seletor, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(seletor, valor);
}

async function clicarBotaoPorValorOuTexto(page, valor) {
    const clicou = await page.evaluate((texto) => {
        const alvo = String(texto || '').trim();
        const elementos = Array.from(document.querySelectorAll('input, button, a'));
        const botao = elementos.find((el) => {
            const value = String(el.value || '').trim();
            const text = String(el.textContent || '').trim();
            const id = String(el.id || '').trim();
            const name = String(el.name || '').trim();
            return value === alvo || text === alvo || id === alvo || name === alvo;
        });
        if (!botao) return false;
        botao.click();
        return true;
    }, valor);

    if (!clicou) throw new Error(`Botao "${valor}" nao encontrado.`);
}

async function confirmarEmissaoSeNecessario(browser, config, logTotal, promessaPdf) {
    const seletorConfirmacao = seletorPorId(config.botao_confirmar_emissao);
    const inicio = Date.now();
    let pdfRecebido = false;

    if (promessaPdf) {
        promessaPdf.then(() => { pdfRecebido = true; }).catch(() => { pdfRecebido = true; });
    }

    // Procura o botão até o limite de tempo do PDF ou até o PDF chegar sozinho
    while (Date.now() - inicio < config.timeout_pdf_ms) {
        if (pdfRecebido) {
            dbg(`confirmarEmissao | PDF detectado em background, cancelando busca pelo botao`);
            return false;
        }

        const paginas = typeof browser.pages === 'function' ? await browser.pages() : [];
        dbg(`confirmarEmissao | paginas abertas=${paginas.length}`);

        for (const pagina of paginas) {
            const botao = typeof pagina.$ === 'function'
                ? await pagina.$(seletorConfirmacao).catch(() => null)
                : null;
            if (!botao) continue;

            logTotal(`   Confirmando nome do contribuinte...`);
            dbg(`Botao de confirmacao encontrado em: ${pagina.url()}`);
            await botao.click();
            return true;
        }
        await navUtils.delay(500);
    }

    dbg(`confirmarEmissao | botao nao encontrado e timeout maximo atingido`);
    return false;
}

function criarDadosRelatorio(registro, caminhoPdf) {
    return {
        nome: registro.nome || '',
        cpf_cnpj: registro.cpf_cnpj || '',
        situacao: registro.situacao || '',
        status_extraido: registro.status_extraido || '',
        status_extraidos: (registro.status_extraidos || []).join('; '),
        ocorrencias: registro.ocorrencias || 1,
        arquivos_origem: registro.arquivos_origem || '',
        pdf_emitido: caminhoPdf || ''
    };
}

async function salvarPdfCertidao(diretorios, config, documentoNormalizado, pdfBuffer) {
    const pastaDestino = config.pasta_pdf
        ? path.join(diretorios.evidencias, config.pasta_pdf)
        : diretorios.evidencias;

    if (!fs.existsSync(pastaDestino)) fs.mkdirSync(pastaDestino, { recursive: true });

    const caminhoArquivo = angUtils.resolverNomeArquivoPdfUnico(pastaDestino, `${documentoNormalizado}.pdf`);
    fs.writeFileSync(caminhoArquivo, pdfBuffer);
    return caminhoArquivo;
}

async function salvarEvidenciaErro(page, diretorios, documentoNormalizado, numLinha) {
    const nomeBase = documentoNormalizado || `linha_${numLinha}`;
    const screenshotPath = path.join(diretorios.evidencias, `ERRO_CND_${nomeBase}.png`);
    if (page && typeof page.screenshot === 'function') {
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    }
    return screenshotPath;
}

async function preencherFormularioCND(page, registro, config) {
    const tipoDocumento = detectarTipoDocumento(registro.documento_normalizado || registro.cpf_cnpj);
    const campos = config[tipoDocumento];
    await selecionarTipoCertidao(page, config);
    await clicarPorId(page, campos.radio_tipo_documento);
    await preencherCampoPorId(page, campos.campo_documento, formatarDocumento(registro.documento_normalizado || registro.cpf_cnpj));
    await clicarPorId(page, campos.radio_espolio);
    // Adicionar espera pela rede estabilizar
    if (typeof page.waitForNetworkIdle === 'function') {
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 0 });
    }
}

// -----------------------------------------------------------
// processarDocumentoCND — com debug de estado das abas
// e fechamento da aba do PDF ao final de cada iteração
// -----------------------------------------------------------
async function processarDocumentoCND(page, browser, registro, numLinha, configPerfil, diretorios, logTotal) {
    const config = obterConfig(configPerfil);
    const documentoNormalizado = registro.documento_normalizado || normalizarDocumento(registro.cpf_cnpj);

    detectarTipoDocumento(documentoNormalizado);

    // DEBUG: estado das abas no início de cada documento
    const abasAntes = await browser.pages();
    dbg(`=== INICIO doc ${numLinha} | abas abertas=${abasAntes.length} ===`);
    for (const a of abasAntes) dbg(`  aba: ${a.url()}`);

    await page.goto(config.url_direta, { waitUntil: 'domcontentloaded' });
    dbg(`Formulario carregado`);

    await preencherFormularioCND(page, registro, config);
    dbg(`Formulario preenchido`);
    await navUtils.delay(1000);
    const paginasMonitoradas = typeof browser.pages === 'function' ? await browser.pages() : [];
    dbg(`Snapshot de paginas para monitorar: ${paginasMonitoradas.length}`);

    const promessaPdf = aguardarProximoPdf(browser, config.timeout_pdf_ms, paginasMonitoradas);

    await navUtils.delay(1000);
    dbg(`Clicando em Emitir...`);
    await clicarBotaoPorValorOuTexto(page, config.botao_emitir);
    dbg(`Emitir clicado`);

    await confirmarEmissaoSeNecessario(browser, config, logTotal, promessaPdf);
    dbg(`Confirmacao tratada`);
    await navUtils.delay(1000);

    // DEBUG: estado das abas enquanto aguarda o PDF
    const abasAposEmitir = await browser.pages();
    dbg(`Abas apos clicar Emitir: ${abasAposEmitir.length}`);
    for (const a of abasAposEmitir) dbg(`  aba: ${a.url()}`);

    dbg(`Aguardando promessa do PDF...`);
    const pdf = await promessaPdf;
    dbg(`PDF recebido | bytes=${pdf.buffer?.length} | url=${pdf.url}`);

    const caminhoPdf = await salvarPdfCertidao(diretorios, config, documentoNormalizado, pdf.buffer);
    logTotal(`✅   Certidão salva: ${path.basename(caminhoPdf)} (${(pdf.buffer.length / 1024).toFixed(1)} KB)`);

    // CORREÇÃO: fecha a aba do PDF após salvar para não acumular abas entre iterações
    const abasAposSalvar = await browser.pages();
    for (const aba of abasAposSalvar) {
        if (aba === page) continue; // nunca fecha a aba principal do formulário
        try {
            dbg(`Fechando aba extra: ${aba.url()}`);
            await aba.close();
        } catch (err) {
            dbg(`Erro ao fechar aba: ${err.message}`);
        }
    }

    return {
        status: 'SUCESSO',
        linha: numLinha,
        dados: criarDadosRelatorio(registro, caminhoPdf),
        mensagem: `Certidao emitida com sucesso para ${formatarDocumento(documentoNormalizado)}.`,
        numeroOP: caminhoPdf
    };
}

async function executarConsultaCND(configPerfil, caminhosPdf, diretorioSaida, enviarLog, controle) {
    const logTotal = (msg) => {
        enviarLog(msg);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`);
    };

    logTotal(`🚀 Inicializando Bot de ${configPerfil.nome}...`);
    let browser = null;
    const resultados = [];

    try {
        const arquivosPdf = prepararEntradasPdf(caminhosPdf);
        if (arquivosPdf.length === 0) throw new Error('Nenhum PDF informado para processamento.');

        const diretorios = fileUtils.prepararDiretorios(diretorioSaida, configPerfil.nome);
        const config = obterConfig(configPerfil);

        logTotal(`▶️   Lendo ${arquivosPdf.length} arquivo(s) PDF de entrada...`);
        const relatorioExtracao = await extrairCertidoes(arquivosPdf, configPerfil.mapeamento_colunas);
        const consolidado = consolidarCertidoes(relatorioExtracao, arquivosPdf);

        logTotal(`✔️   Extracao concluida: ${consolidado.contagem.negativa} negativa(s), ${consolidado.contagem.positiva} positiva(s).`);
        for (const positiva of consolidado.positivas) {
            logTotal(`⚠️   Positiva: ${positiva.nome || 'Nome nao encontrado'} | ${positiva.cpf_cnpj || 'CPF/CNPJ nao encontrado'} | ${positiva.situacao || 'Situacao nao encontrada'}`);
        }
        logTotal(`📋   ${consolidado.documentos.length} CPF/CNPJ unico(s) sera(o) consultado(s).`);

        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: ['--start-maximized']
        });

        const page = (await browser.pages())[0] || await browser.newPage();
        if (typeof page.setDefaultTimeout === 'function') {
            page.setDefaultTimeout(config.timeout_padrao_ms);
        }

        // DEBUG: intercepta TODAS as requisições da aba principal para ver o que sai
        //await page.setRequestInterception(true);
        //page.on('request', (req) => {
        //    dbg(`REQ | ${req.method()} ${req.url().slice(0, 120)}`);
        //    req.continue();
        //});

        for (let i = 0; i < consolidado.documentos.length; i++) {
            if (controle && controle.abortar) {
                logTotal('Processo interrompido pelo usuario.');
                break;
            }

            const registro = consolidado.documentos[i];
            const numLinha = i + 1;
            const documento = registro.documento_normalizado || normalizarDocumento(registro.cpf_cnpj);

            logTotal(`▶️   [${numLinha}/${consolidado.documentos.length}] Processando ${formatarDocumento(documento)}...`);

            try {
                const resultado = await processarDocumentoCND(page, browser, registro, numLinha, configPerfil, diretorios, logTotal);
                resultados.push(resultado);
            } catch (erro) {
                logTotal(`❌   [${numLinha}] Erro no CPF/CNPJ ${formatarDocumento(documento)}: ${erro.message}`);
                logger.gravarLogSistema(`[BOT-${configPerfil.nome}] STACK: ${erro.stack}`);

                // DEBUG: fecha abas extras mesmo no caminho de erro
                try {
                    const todasAbas = await browser.pages();
                    dbg(`Fechando abas extras apos erro | total=${todasAbas.length}`);
                    for (const aba of todasAbas) {
                        if (aba === page) continue;
                        await aba.close().catch(() => {});
                    }
                } catch (_) {}

                await salvarEvidenciaErro(page, diretorios, documento, numLinha);
                resultados.push({
                    status: 'ERRO',
                    linha: numLinha,
                    dados: criarDadosRelatorio(registro, ''),
                    mensagem: erro.message,
                    numeroOP: ''
                });
            }
        }

        const resumo = await fileUtils.exportarRelatorios(diretorios.planilhas, resultados);
        logTotal('🏁 PROCESSO CONCLUÍDO!');
        logTotal(`   Sucessos: ${resumo.qtdSucesso} | Erros: ${resumo.qtdErro}`);
        logTotal(`   ↳ Arquivos salvos em: ${diretorios.base}`);

        return { sucesso: true, resumo };
    } catch (error) {
        logTotal(`❌   Erro Critico: ${error.message}`);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ERRO CRITICO STACK: ${error.stack}`);
        return { sucesso: false, erro: error.message };
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = {
    executarConsultaCND,
    obterConfig,
    normalizarDocumento,
    formatarDocumento,
    detectarTipoDocumento,
    seletorPorId,
    consolidarCertidoes,
    prepararEntradasPdf,
    preencherFormularioCND,
    processarDocumentoCND,
    aguardarProximoPdf,
    confirmarEmissaoSeNecessario,
    criarDadosRelatorio
};