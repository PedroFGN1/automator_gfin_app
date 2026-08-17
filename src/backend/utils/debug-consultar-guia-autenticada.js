/**
 * =============================================================================
 * MÓDULO DE DEBUG — consultar-guia-autenticada.js
 * =============================================================================
 * Como usar:
 *   1. Substitua temporariamente a chamada a `processarLinhaConsulta` por
 *      `processarLinhaConsultaDebug` no seu executor principal.
 *   2. Execute normalmente. Um arquivo `debug-report.json` será gerado na
 *      pasta de saída com todas as informações coletadas.
 *   3. Compartilhe o relatório para análise da causa-raiz.
 * =============================================================================
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Utilitários internos de log
// ---------------------------------------------------------------------------
const ts = () => new Date().toISOString();

function criarLogger(pastaDestino) {
    const linhas = [];
    const log = (nivel, msg, dados) => {
        const entrada = { t: ts(), nivel, msg, ...(dados ? { dados } : {}) };
        linhas.push(entrada);
        const icone = { INFO: 'ℹ️', WARN: '⚠️', ERROR: '❌', OK: '✅', DEBUG: '🔍' }[nivel] ?? '•';
        console.log(`[DEBUG] ${icone} ${msg}`, dados ? JSON.stringify(dados) : '');
    };
    const salvar = (nomeArquivo = 'debug-report.json') => {
        const dest = path.join(pastaDestino, nomeArquivo);
        fs.writeFileSync(dest, JSON.stringify(linhas, null, 2), 'utf-8');
        console.log(`\n[DEBUG] 📄 Relatório salvo em: ${dest}\n`);
    };
    return { log, salvar, linhas };
}

// ---------------------------------------------------------------------------
// PROBE 1 — Inspeciona o botão antes do clique
// ---------------------------------------------------------------------------
async function probeInspecionarBotao(page, selectorBotao, logger) {
    logger.log('DEBUG', 'PROBE 1 — Inspecionando atributos do botão alvo');

    try {
        const attrs = await page.evaluate((sel) => {
            // Tenta ::-p-text e fallback para querySelector normal
            const candidates = [...document.querySelectorAll('button')];
            const btn = candidates.find(b => b.textContent.trim().includes('Visualizar Comprovante'));
            if (!btn) return null;
            const result = {};
            for (const attr of btn.attributes) {
                result[attr.name] = attr.value;
            }
            result.__textContent = btn.textContent.trim();
            result.__tagName     = btn.tagName;
            result.__outerHTML   = btn.outerHTML.slice(0, 500); // truncado
            result.__listeners   = typeof getEventListeners !== 'undefined'
                ? Object.keys(getEventListeners(btn))
                : '(getEventListeners indisponível fora do DevTools)';
            return result;
        }, selectorBotao);

        if (!attrs) {
            logger.log('WARN', 'Botão "Visualizar Comprovante" NÃO encontrado no DOM via querySelectorAll');
        } else {
            logger.log('OK', 'Botão encontrado', attrs);

            // Aviso específico sobre target
            if (attrs.target) {
                logger.log('WARN', `Botão possui target="${attrs.target}" — pode abrir nova aba`);
            } else {
                logger.log('INFO', 'Atributo target ausente ou removido com sucesso');
            }

            // Aviso sobre href (âncora disfarçada de botão)
            if (attrs.href) {
                logger.log('WARN', `Botão possui href="${attrs.href}" — comporta-se como link`);
            }
        }
    } catch (err) {
        logger.log('ERROR', 'Falha na PROBE 1', { mensagem: err.message });
    }
}

// ---------------------------------------------------------------------------
// PROBE 2 — Monitora abertura de nova aba via targetcreated
// ---------------------------------------------------------------------------
function probeMonitorarNovaAba(browser, logger) {
    logger.log('DEBUG', 'PROBE 2 — Registrando listener de nova aba (targetcreated)');

    browser.on('targetcreated', async (target) => {
        const tipo = target.type();
        const url  = target.url();
        logger.log('WARN', `Nova aba/target criado pelo browser!`, { tipo, url });

        if (tipo === 'page') {
            try {
                const novaPage = await target.page();
                if (novaPage) {
                    // Captura a URL final após possíveis redirecionamentos
                    await novaPage.waitForNavigation({ timeout: 8000, waitUntil: 'domcontentloaded' }).catch(() => {});
                    const urlFinal = novaPage.url();
                    logger.log('WARN', 'URL final da nova aba', { urlFinal });

                    // Verifica Content-Type real da resposta
                    const response = await novaPage.evaluate(() => {
                        return {
                            href: window.location.href,
                            title: document.title,
                            bodySnippet: document.body?.innerText?.slice(0, 200) ?? ''
                        };
                    }).catch(() => ({}));
                    logger.log('DEBUG', 'Conteúdo da nova aba', response);
                }
            } catch (e) {
                logger.log('ERROR', 'Erro ao inspecionar nova aba', { mensagem: e.message });
            }
        }
    });
}

// ---------------------------------------------------------------------------
// PROBE 3 — Intercepta TODAS as requisições após o clique
// ---------------------------------------------------------------------------
async function probeInterceptarTodasRequisicoes(page, logger, duracaoMs = 10000) {
    logger.log('DEBUG', `PROBE 3 — Monitorando todas as requisições por ${duracaoMs / 1000}s após o clique`);

    const requisicoes = [];
    const listener = (req) => {
        const info = {
            url: req.url().slice(0, 300),
            method: req.method(),
            resourceType: req.resourceType(),
            isNavigation: req.isNavigationRequest(),
            postData: req.postData()?.slice(0, 200) ?? null,
        };
        requisicoes.push(info);

        // Destaca requisições suspeitas de PDF
        const url = req.url().toLowerCase();
        if (url.includes('pdf') || url.includes('comprovante') || url.includes('download') || url.includes('blob')) {
            logger.log('WARN', '🎯 Requisição candidata a PDF detectada!', info);
        }

        req.continue().catch(() => {});
    };

    await page.setRequestInterception(true);
    page.on('request', listener);

    // Aguarda a janela de monitoramento
    await new Promise(r => setTimeout(r, duracaoMs));

    page.off('request', listener);
    await page.setRequestInterception(false).catch(() => {});

    logger.log('INFO', `PROBE 3 — Total de requisições capturadas: ${requisicoes.length}`, { requisicoes });
    return requisicoes;
}

// ---------------------------------------------------------------------------
// PROBE 4 — Intercepta window.open e monitorar blob URLs
// ---------------------------------------------------------------------------
async function probeInterceptarWindowOpen(page, logger) {
    logger.log('DEBUG', 'PROBE 4 — Sobrescrevendo window.open para capturar chamadas');

    await page.evaluateOnNewDocument(() => {
        const _open = window.open.bind(window);
        window.open = function (url, target, features) {
            console.warn('[DEBUG_PROBE4] window.open chamado!', JSON.stringify({ url, target, features }));
            // Chama o original normalmente
            return _open(url, target, features);
        };

        // Monitora criação de Blob URLs (PDF em memória)
        const _createObjectURL = URL.createObjectURL.bind(URL);
        URL.createObjectURL = function (obj) {
            const result = _createObjectURL(obj);
            console.warn('[DEBUG_PROBE4] URL.createObjectURL chamado!', JSON.stringify({
                type: obj?.type ?? 'desconhecido',
                size: obj?.size ?? 'desconhecido',
                blobUrl: result
            }));
            return result;
        };
    });

    // Escuta os logs do console da página para capturar os avisos acima
    page.on('console', msg => {
        const text = msg.text();
        if (text.startsWith('[DEBUG_PROBE4]')) {
            logger.log('WARN', `window.open ou createObjectURL interceptado`, { consoleMsg: text });
        }
    });

    logger.log('DEBUG', 'PROBE 4 — Listeners registrados');
}

// ---------------------------------------------------------------------------
// PROBE 5 — Testa fetch direto para a URL do PDF (confirma acessibilidade)
// ---------------------------------------------------------------------------
async function probeFetchDiretoUrl(page, url, logger) {
    logger.log('DEBUG', 'PROBE 5 — Testando fetch direto para URL do PDF', { url });

    try {
        const resultado = await page.evaluate(async (fetchUrl) => {
            try {
                const res = await fetch(fetchUrl, { method: 'GET', credentials: 'include' });
                const ct  = res.headers.get('content-type') ?? '';
                const cl  = res.headers.get('content-length') ?? '';
                const cd  = res.headers.get('content-disposition') ?? '';
                return {
                    status: res.status,
                    ok: res.ok,
                    contentType: ct,
                    contentLength: cl,
                    contentDisposition: cd,
                    isPdf: ct.includes('pdf')
                };
            } catch (e) {
                return { erro: e.message };
            }
        }, url);
        logger.log(resultado.isPdf ? 'OK' : 'WARN', 'Resultado do fetch direto', resultado);
        return resultado;
    } catch (err) {
        logger.log('ERROR', 'PROBE 5 falhou', { mensagem: err.message });
    }
}

// ---------------------------------------------------------------------------
// VERSÃO COMPLETA DE DEBUG de processarLinhaConsulta
// ---------------------------------------------------------------------------
async function processarLinhaConsultaDebug(browser, page, linha, numLinha, diretorios, logTotal, CONFIG, SELECTORS, angUtils, navUtils) {
    const pastaDestino = diretorios.evidencias;
    if (!fs.existsSync(pastaDestino)) fs.mkdirSync(pastaDestino, { recursive: true });

    const dbg = criarLogger(pastaDestino);
    const idDeposito = String(linha['ID_DEPOSITO']).trim();

    dbg.log('INFO', `Iniciando debug para ID: ${idDeposito}`);
    logTotal(`🔍 [DEBUG] Processando ID: ${idDeposito}`);

    // PROBE 2 — registra antes de qualquer ação
    probeMonitorarNovaAba(browser, dbg);

    // 1. Navega para a página
    dbg.log('INFO', 'Navegando para URL direta', { url: CONFIG.url_direta });
    await page.goto(CONFIG.url_direta, { waitUntil: 'networkidle2' });
    dbg.log('OK', 'Navegação concluída');

    // PROBE 4 — injeta antes de qualquer clique
    await probeInterceptarWindowOpen(page, dbg);

    // 2. Preenche o campo
    await page.waitForSelector(SELECTORS.inputId, { visible: true });
    await angUtils.preencherCampoAngular(page, SELECTORS.inputId, idDeposito);
    dbg.log('OK', 'Campo ID preenchido');

    // 3. Aguarda botão Visualizar (captcha humano)
    logTotal('⚠️ [DEBUG] Aguardando resolução do Captcha...');
    dbg.log('INFO', 'Aguardando botão Visualizar', { timeout: CONFIG.timeout_captcha_ms });

    const btnHandle = await page.waitForSelector(SELECTORS.btnVisualizar, {
        visible: true,
        timeout: CONFIG.timeout_captcha_ms
    });
    dbg.log('OK', 'Botão Visualizar encontrado no DOM');

    // PROBE 1 — inspeciona botão antes de qualquer manipulação
    await probeInspecionarBotao(page, SELECTORS.btnVisualizar, dbg);

    // Remove target
    await page.evaluate((btnElement) => {
        if (btnElement) {
            btnElement.removeAttribute('target');
            // Também remove do elemento pai caso seja um <a> wrapper
            if (btnElement.parentElement?.tagName === 'A') {
                btnElement.parentElement.removeAttribute('target');
            }
        }
    }, btnHandle);
    dbg.log('INFO', 'Remoção de target executada');

    // PROBE 1 novamente — confirma remoção
    await probeInspecionarBotao(page, SELECTORS.btnVisualizar, dbg);

    // 4. Ativa PROBE 3 — inicia monitoramento de requisições em paralelo com o clique
    dbg.log('INFO', 'Ativando PROBE 3 e clicando no botão simultaneamente');

    // Arma a interceptação de requisições (não bloqueia — apenas observa)
    const probeReqPromise = probeInterceptarTodasRequisicoes(page, dbg, 12000);

    // Aguarda brevemente para o interceptor estar ativo, depois clica
    await new Promise(r => setTimeout(r, 300));
    logTotal('🖱️ [DEBUG] Clicando no botão Visualizar...');
    await page.click(SELECTORS.btnVisualizar);
    dbg.log('OK', 'Clique executado');

    // Aguarda o monitoramento de 12s terminar
    const todasReqs = await probeReqPromise;

    // 5. Analisa candidatos a PDF nas requisições capturadas
    const candidatosPdf = todasReqs.filter(r => {
        const u = r.url.toLowerCase();
        return u.includes('pdf') || u.includes('comprovante') ||
               u.includes('download') || r.resourceType === 'document';
    });

    if (candidatosPdf.length > 0) {
        dbg.log('WARN', `${candidatosPdf.length} candidato(s) a PDF encontrado(s)`, { candidatosPdf });

        // PROBE 5 — testa acesso direto ao primeiro candidato
        await probeFetchDiretoUrl(page, candidatosPdf[0].url, dbg);
    } else {
        dbg.log('WARN', 'Nenhum candidato a PDF encontrado nas requisições. Verifique PROBE 2 e PROBE 4 nos logs.');
    }

    // 6. Captura screenshot do estado final da página
    const screenshotPath = path.join(pastaDestino, `debug-screenshot-${idDeposito}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(e => {
        dbg.log('ERROR', 'Falha ao tirar screenshot', { mensagem: e.message });
    });
    dbg.log('INFO', 'Screenshot capturado', { caminho: screenshotPath });

    // 7. Salva relatório
    dbg.salvar(`debug-report-${idDeposito}.json`);

    return { status: 'DEBUG_CONCLUIDO', idDeposito, totalRequisicoes: todasReqs.length, candidatosPdf };
}

// ---------------------------------------------------------------------------
// Exporta
// ---------------------------------------------------------------------------
module.exports = {
    processarLinhaConsultaDebug,
    probeInspecionarBotao,
    probeMonitorarNovaAba,
    probeInterceptarTodasRequisicoes,
    probeInterceptarWindowOpen,
    probeFetchDiretoUrl,
    criarLogger,
};