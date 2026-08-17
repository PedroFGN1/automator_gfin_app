const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const AngularHelper = require('../utils/angularHelper.js');
const fileUtils = require('../utils/file-utils.js');
const angUtils = require('../utils/angular-utils.js');
const navUtils = require('../utils/navigation-utils.js');
const logger = require('../utils/logger.js');

puppeteer.use(StealthPlugin());

const DEFAULT_SELECTORS = {
    processo: '#in-processo',
    proximaTela: 'div.cardrow > div:nth-of-type(1) h4',
    autor: 'app-validar-documento[nome="Autor"] input[formcontrolname="inscricao"]',
    reu: 'app-validar-documento[nome="Réu"] input[formcontrolname="inscricao"]',
    depositanteSelect: 'select#selectDepositante',
    depositanteDocumento: 'app-validar-documento[label="Identifique o Depositante *"] input[formcontrolname="inscricao"]',
    telefone: '#in-telefone',
    estado: 'select[formcontrolname="estado"]',
    municipio: 'select[id="in-municipios"]',
    dataVencimento: 'input[id="in-vencimento"]',
    valor: 'input[formcontrolname="valor"]',
    observacao: "textarea[id='in-observacao']"
};

const DEFAULT_CONFIG = {
    texto_cartao_justica: 'Justiça Estadual',
    estado_value: '1: Object',
    timeout_padrao_ms: 15000,
    timeout_captcha_ms: 0,
    timeout_pdf_ms: 30000,
    pasta_pdf: 'Guias',
    seletores: DEFAULT_SELECTORS
};

function obterConfig(configPerfil) {
    const fixas = configPerfil.configuracoes_fixas || {};
    return {
        ...DEFAULT_CONFIG,
        ...fixas,
        fixas,
        seletores: {
            ...DEFAULT_SELECTORS,
            ...(fixas.seletores || {})
        }
    };
}

function valorDaLinha(linha, mapa, chave) {
    return linha[mapa[chave]];
}

function valorFixo(config, chave) {
    return normalizarTexto(config.fixas?.[chave]);
}

function normalizarTexto(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor).trim();
}

function normalizarDataVencimento(valor) {
    if (!valor) return '';
    if (valor instanceof Date || typeof valor === 'number') {
        return navUtils.formatarData(navUtils.tratarData(valor));
    }
    return String(valor).trim();
}

function validarCamposObrigatoriosDaPlanilha(linha, configPerfil) {
    const mapa = configPerfil.mapeamento_colunas;
    const obrigatorios = [
        'PROCESSO',
        'CPF_CNPJ_AUTOR',
        'CPF_CNPJ_REU',
        'MUNICIPIO',
        'VALOR',
        'DATA_VENCIMENTO',
        'OBSERVACAO',
    ];

    const ausentes = obrigatorios.filter((chave) => !normalizarTexto(valorDaLinha(linha, mapa, chave)));
    if (ausentes.length > 0) {
        throw new Error(`Dados da planilha: campos obrigatórios ausentes (${ausentes.join(', ')}).`);
    }
}

function validarConfiguracoesFixas(config) {
    const obrigatorios = ['TELEFONE', 'CPF_CNPJ_DEPOSITANTE'];
    const ausentes = obrigatorios.filter((chave) => !valorFixo(config, chave));

    if (ausentes.length > 0) {
        throw new Error(`Configurações fixas: ${ausentes.join(', ')} ausente${ausentes.length > 1 ? 's' : ''}.`);
    }
}

function validarCamposObrigatorios(linha, configPerfil) {
    validarCamposObrigatoriosDaPlanilha(linha, configPerfil);
    validarConfiguracoesFixas(obterConfig(configPerfil));
}

async function executarEtapa(nomeEtapa, acao) {
    try {
        return await acao();
    } catch (erro) {
        throw new Error(`${nomeEtapa}: ${erro.message}`);
    }
}

async function abrirPortalCaixa(page, configPerfil, logTotal) {
    logTotal('🌍 Acessando portal da Caixa...');
    await page.goto(configPerfil.url_portal, { waitUntil: 'networkidle2' });
}

async function consultarProcesso(page, config, numeroProcesso, logTotal) {
    logTotal(`🔎 Consultando processo: ${numeroProcesso}`);
    await page.waitForSelector(config.seletores.processo, { visible: true });
    await angUtils.preencherCampoAngular(page, config.seletores.processo, numeroProcesso);
}

async function aguardarCaptchaOuProcesso(page, config, logTotal) {
    const captchaDetectado = typeof page.waitForFunction === 'function'
        ? await page.waitForFunction((seletorCaptcha) => {
            const elementoVisivel = (elemento) => {
                const estilo = window.getComputedStyle(elemento);
                const retangulo = elemento.getBoundingClientRect();
                return estilo.display !== 'none'
                    && estilo.visibility !== 'hidden'
                    && retangulo.width > 0
                    && retangulo.height > 0;
            };

            return Array.from(document.querySelectorAll(seletorCaptcha)).some(elementoVisivel);
        }, { timeout: config.timeout_deteccao_captcha_ms || 1200 }, [
            'iframe[src*="captcha" i]',
            'iframe[title*="captcha" i]',
            '[id*="captcha" i]',
            '[class*="captcha" i]',
            '[data-sitekey]',
            '.g-recaptcha',
            '.h-captcha',
            'app-captcha'
        ].join(',')).catch(() => null)
        : true;
    const captchaSolicitado = Boolean(captchaDetectado);

    if (!captchaSolicitado) {
        logTotal('✅ Captcha não solicitado. Consultando processo automaticamente...');
        const botaoConsultar = await page.waitForSelector('button::-p-text(Consultar Processo)', { visible: true, timeout: 1500 })
            .catch(() => null);

        if (!botaoConsultar) {
            throw new Error('Botão "Consultar Processo" não encontrado para consulta automática.');
        }

        await botaoConsultar.click();
    } else {
        logTotal('⚠️ Ação necessária: resolva o Captcha, clique em "Consultar Processo" e aguarde o robô continuar.');
    }

    await page.waitForSelector(config.seletores.proximaTela, { timeout: config.timeout_captcha_ms });
    logTotal('✅ Consulta confirmada. Próxima tela carregada.');
}

async function selecionarJusticaEstadual(page, config, logTotal) {
    logTotal(`🧭 Selecionando cartão "${config.texto_cartao_justica}"...`);
    await navUtils.delay(2000);

    const resultadoClique = await angUtils.clicarCartaoPorTitulo(page, config.texto_cartao_justica);
    if (!resultadoClique.sucesso) {
        throw new Error(resultadoClique.erro || `Cartão "${config.texto_cartao_justica}" não encontrado.`);
    }

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: config.timeout_padrao_ms })
        .catch(() => logTotal('   ↳ Transição sem nova URL detectada; seguindo como SPA.'));
    await navUtils.delay(2000);
}

async function selecionarDepositante(page, config) {
    let seletorDepositanteFinal = config.seletores.depositanteSelect;
    const selectOriginalExiste = await page.$(seletorDepositanteFinal).catch(() => null);

    if (!selectOriginalExiste) {
        seletorDepositanteFinal = await angUtils.resgatarSelectPorLabel(
            page,
            'Depositante',
            'select-depositante-automator-gfin'
        );
    }

    if (!seletorDepositanteFinal) {
        throw new Error('select não encontrado.');
    }

    await page.waitForSelector(seletorDepositanteFinal, { visible: true, timeout: 1000 });
    await page.select(seletorDepositanteFinal, 'Outros');
    await navUtils.delay(1000);
}

async function preencherDadosPartes(page, linha, configPerfil, config, logTotal) {
    const mapa = configPerfil.mapeamento_colunas;
    logTotal('👥 Preenchendo dados das partes...');
    const autorPreenchido = await angUtils.preencherOuIgnorar(
        page,
        config.seletores.autor,
        normalizarTexto(valorDaLinha(linha, mapa, 'CPF_CNPJ_AUTOR')),
        'CPF/CNPJ Autor'
    );
    if (autorPreenchido) await navUtils.delay(1000);

    const reuPreenchido = await angUtils.preencherOuIgnorar(
        page,
        config.seletores.reu,
        normalizarTexto(valorDaLinha(linha, mapa, 'CPF_CNPJ_REU')),
        'CPF/CNPJ Réu'
    );
    if (reuPreenchido) await navUtils.delay(1000);

    logTotal('🏦 Selecionando depositante como "Outros"...');
    await selecionarDepositante(page, config);

    await angUtils.preencherOuIgnorar(
        page,
        config.seletores.depositanteDocumento,
        valorFixo(config, 'CPF_CNPJ_DEPOSITANTE'),
        'CPF/CNPJ Depositante'
    );
    await navUtils.delay(1000);
}

async function preencherInputComMascara(page, seletor, valor) {
    await page.waitForSelector(seletor, { visible: true });
    const input = await page.$(seletor);
    if (!input) throw new Error(`Campo não encontrado: ${seletor}`);
    await input.click();
    await input.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(seletor, valor);
}

async function preencherDadosDeposito(page, linha, configPerfil, config, logTotal) {
    const mapa = configPerfil.mapeamento_colunas;
    const municipio = normalizarTexto(valorDaLinha(linha, mapa, 'MUNICIPIO'));
    const valor = valorDaLinha(linha, mapa, 'VALOR');
    const dataVencimento = normalizarDataVencimento(valorDaLinha(linha, mapa, 'DATA_VENCIMENTO'));
    const observacao = normalizarTexto(valorDaLinha(linha, mapa, 'OBSERVACAO'));

    logTotal('📝 Preenchendo dados do depósito...');
    await angUtils.preencherCampoAngular(page, config.seletores.telefone, valorFixo(config, 'TELEFONE'));

    const estadoSelecionado = await angUtils.selecionarOuIgnorar(
        page,
        config.seletores.estado,
        config.estado_value,
        'Estado'
    );
    if (estadoSelecionado) await navUtils.delay(1000);

    try {
        const municipioSelecionado = await angUtils.selecionarOuIgnorar(
            page,
            config.seletores.municipio,
            municipio,
            'Município',
            true
        );
        if (municipioSelecionado) await navUtils.delay(1000);
    } catch (erro) {
        throw new Error(`Município: opção "${municipio}" não encontrada. ${erro.message}`);
    }

    await preencherInputComMascara(page, config.seletores.dataVencimento, dataVencimento);
    await preencherInputComMascara(page, config.seletores.valor, navUtils.formatarMoeda(valor));

    await page.waitForSelector(config.seletores.observacao, { visible: true });
    await angUtils.preencherCampoAngular(page, config.seletores.observacao, observacao);
    await navUtils.delay(1000);
}

async function gerarBoleto(page, helper, config, diretorios, logTotal, observacao) {
    const pastaPdf = config.pasta_pdf
        ? path.join(diretorios.evidencias, config.pasta_pdf)
        : diretorios.evidencias;
    logTotal('📄 Gerando boleto e aguardando PDF...');

    const promessaDoBoleto = angUtils.prepararCapturaDeBoletoPeloConsole(page, pastaPdf, {
        timeoutMs: config.timeout_pdf_ms,
        nomeArquivo: observacao
    });

    await angUtils.selecionarBoletoEContinuar(page, helper);
    const resultado = await promessaDoBoleto;

    if (!resultado || !resultado.sucesso) {
        throw new Error(resultado?.erro || 'PDF não capturado.');
    }

    await navUtils.delay(2000);

    const btnNovoDeposito = await page.waitForSelector('button.btn-primary::-p-text(Novo Depósito)', { visible: true, timeout: 15000 });
    if (!btnNovoDeposito) throw new Error("Botão 'Novo Depósito' não encontrado.");
    await btnNovoDeposito.click();

    return resultado;
}

async function salvarEvidenciaErro(page, diretorios, idProcesso, numLinha) {
    const nomeSeguro = normalizarTexto(idProcesso).replace(/[\\/:*?"<>|]/g, '_') || `Linha_${numLinha}`;
    const screenshotPath = path.join(diretorios.evidencias, `${nomeSeguro}_ERRO.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    return screenshotPath;
}

async function processarLinha(page, helper, linha, numLinha, configPerfil, diretorios, logTotal) {
    const config = obterConfig(configPerfil);
    const mapa = configPerfil.mapeamento_colunas;
    const numeroProcesso = normalizarTexto(valorDaLinha(linha, mapa, 'PROCESSO'));
    const observacao = normalizarTexto(valorDaLinha(linha, mapa, 'OBSERVACAO'));

    validarCamposObrigatorios(linha, configPerfil);

    await executarEtapa('Portal Caixa', () => abrirPortalCaixa(page, configPerfil, logTotal));
    await executarEtapa('Consulta do processo', () => consultarProcesso(page, config, numeroProcesso, logTotal));
    await executarEtapa('Captcha/consulta', () => aguardarCaptchaOuProcesso(page, config, logTotal));
    await executarEtapa('Navegação Justiça Estadual', () => selecionarJusticaEstadual(page, config, logTotal));
    await executarEtapa('Dados das partes', () => preencherDadosPartes(page, linha, configPerfil, config, logTotal));
    await executarEtapa('Dados do depósito', () => preencherDadosDeposito(page, linha, configPerfil, config, logTotal));

    const boleto = await executarEtapa('Boleto', () => gerarBoleto(page, helper, config, diretorios, logTotal, observacao));

    return {
        status: 'SUCESSO',
        linha: numLinha,
        dados: {
            ...linha,
            ID_DEPOSITO: boleto.idDeposito || '',
            CODIGO_BARRA: boleto.codigoBarra || ''
        },
        mensagem: `Guia emitida com sucesso. PDF: ${boleto.caminho}`,
        numeroOP: boleto.caminho
    };
}

async function executarEmissaoGuiaDeposito(configPerfil, caminhoExcel, diretorioSaida, enviarLog, controle) {
    const logTotal = (msg) => {
        enviarLog(msg);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`);
    };

    logTotal('🚀 Inicializando Bot de Emissão de Guia de Depósito Judicial...');
    let browser = null;
    const resultados = [];

    try {
        logTotal('📂 Preparando diretórios de evidências e PDFs...');
        const diretorios = fileUtils.prepararDiretorios(diretorioSaida, configPerfil.nome);
        logTotal(`   ↳ Salvo em: ${diretorios.base}`);

        logTotal(`📊 Lendo planilha: ${caminhoExcel}`);
        const dados = await fileUtils.lerExcelInput(caminhoExcel);
        logTotal(`   ✅ ${dados.length} linhas encontradas.`);

        const config = obterConfig(configPerfil);
        logTotal('🌍 Abrindo navegador...');
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: ['--start-maximized']
        });

        const page = (await browser.pages())[0] || await browser.newPage();
        const helper = new AngularHelper(page);
        page.setDefaultTimeout(config.timeout_padrao_ms);

        for (let i = 0; i < dados.length; i++) {
            if (controle && controle.abortar) {
                logTotal('⏹️ Processo interrompido pelo usuário.');
                break;
            }

            const linha = dados[i];
            const numLinha = i + 1;
            const idProcesso = normalizarTexto(valorDaLinha(linha, configPerfil.mapeamento_colunas, 'PROCESSO')) || `Linha_${numLinha}`;

            logTotal(`▶️ Processando ${numLinha}/${dados.length} - Processo: ${idProcesso}`);

            try {
                const resultadoLinha = await processarLinha(page, helper, linha, numLinha, configPerfil, diretorios, logTotal);
                resultados.push(resultadoLinha);
                logTotal(`   ✅ Sucesso na linha ${numLinha}. PDF salvo em: ${resultadoLinha.numeroOP}`);
                
            } catch (erroLinha) {
                logTotal(`   ❌ Erro na linha ${numLinha}: ${erroLinha.message}`);
                await salvarEvidenciaErro(page, diretorios, idProcesso, numLinha);
                resultados.push({
                    status: 'ERRO',
                    linha: numLinha,
                    dados: linha,
                    mensagem: erroLinha.message,
                    numeroOP: ''
                });
            }
        }

        logTotal('💾 Gerando relatórios finais...');
        const resumo = await fileUtils.exportarRelatorios(diretorios.planilhas, resultados);

        logTotal('🏁 PROCESSO CONCLUÍDO!');
        logTotal(`   Sucessos: ${resumo.qtdSucesso} | Erros: ${resumo.qtdErro}`);
        logTotal(`   Arquivos salvos em: ${diretorios.base}`);

        return { sucesso: true, resumo };
    } catch (error) {
        logTotal(`❌ ERRO FATAL NO BOT: ${error.message}`);
        return { sucesso: false, erro: error.message };
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = {
    executarEmissaoGuiaDeposito,
    abrirPortalCaixa,
    consultarProcesso,
    aguardarCaptchaOuProcesso,
    selecionarJusticaEstadual,
    preencherDadosPartes,
    preencherDadosDeposito,
    gerarBoleto,
    salvarEvidenciaErro,
    obterConfig,
    valorFixo,
    validarCamposObrigatoriosDaPlanilha,
    validarConfiguracoesFixas,
    validarCamposObrigatorios,
    processarLinha
};
