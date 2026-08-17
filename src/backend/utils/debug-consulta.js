/**
 * =============================================================================
 * MÓDULO DE DEBUG v2 — Investigação de Blob PDF
 * =============================================================================
 * Foca nas três hipóteses restantes após confirmar que o PDF é um Blob:
 *
 *  H1 — Race condition: window.open() dispara antes do listener estar pronto
 *  H2 — window.open() bloqueado como popup pelo Chromium
 *  H3 — O Blob é exibido na aba ORIGINAL via <iframe>/<embed>/<object>,
 *        não em nova aba (explica a blob URL aparecer nas Sources da aba atual)
 *
 * COMO USAR:
 *   Chame `executarDiagnosticoV2(browser, page, CONFIG, SELECTORS, angUtils)`
 *   após o captcha ser resolvido e antes do clique.
 *   O relatório será impresso no console e salvo em debug-v2-report.json.
 * =============================================================================
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ts = () => new Date().toISOString();

function criarLogger(pasta) {
    const entries = [];
    const log = (nivel, msg, dados) => {
        const e = { t: ts(), nivel, msg, ...(dados ? { dados } : {}) };
        entries.push(e);
        const icon = { INFO:'ℹ️', WARN:'⚠️', ERROR:'❌', OK:'✅', DEBUG:'🔍' }[nivel] ?? '•';
        console.log(`[DBG-V2] ${icon} ${msg}`, dados ? JSON.stringify(dados, null, 2) : '');
    };
    const salvar = (nome = 'debug-v2-report.json') => {
        const dest = path.join(pasta, nome);
        fs.writeFileSync(dest, JSON.stringify(entries, null, 2), 'utf-8');
        console.log(`\n[DBG-V2] 📄 Relatório salvo: ${dest}\n`);
    };
    return { log, salvar };
}

// ---------------------------------------------------------------------------
// PROBE A — Injeta interceptadores ANTES de qualquer clique.
//           Monitora: window.open, URL.createObjectURL, criação de iframes,
//           e captura o Blob no exato momento da sua criação.
//
// ⚠️  Deve ser chamada com page.evaluateOnNewDocument() OU logo após
//     navegar para a página, antes do clique.
// ---------------------------------------------------------------------------
async function probeInjetarEspiosBlobEPopup(page, dbg) {
    dbg.log('DEBUG', 'PROBE A — Injetando espião de Blob/window.open/iframe na página');

    await page.evaluate(() => {
        window.__debugBlobCaptures = [];

        // --- Intercepta URL.createObjectURL ---
        const _createObjectURL = URL.createObjectURL.bind(URL);
        URL.createObjectURL = function(obj) {
            const url = _createObjectURL(obj);
            const info = {
                evento: 'createObjectURL',
                blobUrl: url,
                type: obj?.type ?? 'desconhecido',
                size: obj?.size ?? -1,
                ts: new Date().toISOString()
            };
            window.__debugBlobCaptures.push({ ...info, blob: obj }); // guarda referência ao Blob!
            console.warn('[DBG-PROBE-A] createObjectURL', JSON.stringify(info));
            return url;
        };

        // --- Intercepta window.open ---
        const _open = window.open.bind(window);
        window.open = function(url, target, features) {
            console.warn('[DBG-PROBE-A] window.open chamado', JSON.stringify({ url: String(url).slice(0, 200), target, features }));
            return _open(url, target, features);
        };

        // --- Observa inserção dinâmica de iframe/embed/object no DOM ---
        const domObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const tag = node.tagName?.toLowerCase();
                    if (['iframe', 'embed', 'object', 'img'].includes(tag)) {
                        const src = node.src || node.data || node.getAttribute?.('src') || '';
                        console.warn('[DBG-PROBE-A] Elemento inserido no DOM', JSON.stringify({ tag, src: src.slice(0, 200) }));
                    }
                }
            }
        });
        domObserver.observe(document.body, { childList: true, subtree: true });

        console.warn('[DBG-PROBE-A] Espiões instalados com sucesso');
    });

    // Escuta os logs do console da página
    page.on('console', msg => {
        const text = msg.text();
        if (text.startsWith('[DBG-PROBE-A]')) {
            dbg.log('WARN', `[Página] ${text}`);
        }
    });
}

// ---------------------------------------------------------------------------
// PROBE B — Após o clique, lê os Blobs capturados pela PROBE A e
//           os converte diretamente para base64 — sem depender de nova aba.
//           Esta é a técnica de "extração da memória" que contorna o problema
//           de race condition e popup blocker.
// ---------------------------------------------------------------------------
async function probeExtrairBlobDaMemoria(page, dbg, timeoutMs = 15000) {
    dbg.log('DEBUG', 'PROBE B — Aguardando e extraindo Blob(s) capturados da memória...');

    const inicio = Date.now();

    while (Date.now() - inicio < timeoutMs) {
        await new Promise(r => setTimeout(r, 500));

        const capturas = await page.evaluate(() => {
            return (window.__debugBlobCaptures || []).map((c, i) => ({
                indice: i,
                blobUrl: c.blobUrl,
                type: c.type,
                size: c.size,
                temBlob: !!c.blob
            }));
        });

        if (capturas.length > 0) {
            dbg.log('OK', `${capturas.length} Blob(s) capturado(s) na memória da página!`, capturas);

            // Tenta extrair o conteúdo de cada Blob
            const resultados = await page.evaluate(async () => {
                const results = [];
                for (const capture of window.__debugBlobCaptures) {
                    try {
                        const blob = capture.blob;
                        const ab = await blob.arrayBuffer();
                        const bytes = new Uint8Array(ab);
                        let binary = '';
                        for (let i = 0; i < bytes.byteLength; i++) {
                            binary += String.fromCharCode(bytes[i]);
                        }
                        results.push({
                            blobUrl: capture.blobUrl,
                            type: capture.type,
                            size: capture.size,
                            base64: window.btoa(binary),
                            sucesso: true
                        });
                    } catch(e) {
                        results.push({
                            blobUrl: capture.blobUrl,
                            sucesso: false,
                            erro: e.message
                        });
                    }
                }
                return results;
            });

            dbg.log('INFO', 'Resultado da extração dos Blobs', resultados.map(r => ({
                blobUrl: r.blobUrl,
                type: r.type,
                size: r.size,
                sucesso: r.sucesso,
                base64_primeiros_50: r.base64?.slice(0, 50),
                erro: r.erro
            })));

            return resultados;
        }
    }

    dbg.log('WARN', 'PROBE B — Nenhum Blob encontrado na memória dentro do timeout.');
    return [];
}

// ---------------------------------------------------------------------------
// PROBE C — Verifica estado do DOM após o clique:
//           iframes com blob URL, elemento ativo, shadow DOM, etc.
// ---------------------------------------------------------------------------
async function probeInspecionarDomPosClique(page, dbg) {
    dbg.log('DEBUG', 'PROBE C — Inspecionando DOM após o clique');

    const estado = await page.evaluate(() => {
        const resultado = {
            url: window.location.href,
            iframes: [],
            embeds: [],
            objects: [],
            blobUrlsNoDOM: []
        };

        document.querySelectorAll('iframe').forEach(el => {
            resultado.iframes.push({ src: el.src, id: el.id, className: el.className });
        });
        document.querySelectorAll('embed').forEach(el => {
            resultado.embeds.push({ src: el.src, type: el.type });
        });
        document.querySelectorAll('object').forEach(el => {
            resultado.objects.push({ data: el.data, type: el.type });
        });

        // Procura blob: URLs em qualquer atributo do DOM
        document.querySelectorAll('*').forEach(el => {
            ['src', 'href', 'data', 'action'].forEach(attr => {
                const val = el.getAttribute?.(attr);
                if (val?.startsWith('blob:')) {
                    resultado.blobUrlsNoDOM.push({ tag: el.tagName, attr, value: val });
                }
            });
        });

        return resultado;
    });

    dbg.log('INFO', 'Estado do DOM pós-clique', estado);
    return estado;
}

// ---------------------------------------------------------------------------
// PROBE D — Monitora targets com polling (alternativa ao targetcreated),
//           útil quando o evento é perdido por race condition.
// ---------------------------------------------------------------------------
async function probePollingDeTargets(browser, dbg, duracaoMs = 10000) {
    dbg.log('DEBUG', `PROBE D — Polling de targets por ${duracaoMs / 1000}s`);

    const vistos = new Set();
    const novosTargets = [];
    const inicio = Date.now();

    while (Date.now() - inicio < duracaoMs) {
        await new Promise(r => setTimeout(r, 300));

        const targets = browser.targets();
        for (const t of targets) {
            const url = t.url();
            const tipo = t.type();
            const chave = `${tipo}::${url}`;
            if (!vistos.has(chave)) {
                vistos.add(chave);
                if (url) { // ignora targets sem URL (about:blank iniciais)
                    const info = { tipo, url: url.slice(0, 200) };
                    dbg.log('WARN', `PROBE D — Novo target detectado via polling`, info);
                    novosTargets.push(info);
                }
            }
        }
    }

    dbg.log('INFO', `PROBE D — Polling concluído. ${novosTargets.length} novos target(s) detectados.`, { novosTargets });
    return novosTargets;
}

// ---------------------------------------------------------------------------
// Executor principal do diagnóstico v2
// ---------------------------------------------------------------------------
async function executarDiagnosticoV2(browser, page, CONFIG, SELECTORS, angUtils, navUtils, linha, diretorios) {
    const pasta = diretorios?.evidencias ?? '.';
    const dbg = criarLogger(pasta);
    const idDeposito = String(linha['ID_DEPOSITO']).trim();

    dbg.log('INFO', `=== DIAGNÓSTICO V2 — ID: ${idDeposito} ===`);

    // Navega
    await page.goto(CONFIG.url_direta, { waitUntil: 'networkidle2' });

    // PROBE A — instala espiões ANTES do clique
    await probeInjetarEspiosBlobEPopup(page, dbg);

    // Preenche campo
    await page.waitForSelector(SELECTORS.inputId, { visible: true });
    await angUtils.preencherCampoAngular(page, SELECTORS.inputId, idDeposito);

    // Aguarda captcha
    console.log('\n[DBG-V2] ⏳ Aguardando resolução manual do captcha...\n');
    await page.waitForSelector(SELECTORS.btnVisualizar, { visible: true, timeout: CONFIG.timeout_captcha_ms });
    console.log('\n[DBG-V2] ✔️ Captcha resolvido. Clique no botão "Visualizar Comprovante" para continuar.\n');

    // Arma PROBE D (polling de targets) em paralelo — captura mesmo se targetcreated falhar
    const probeTargetsPromise = probePollingDeTargets(browser, dbg, 12000);

    // Clica
    await page.click(SELECTORS.btnVisualizar);
    dbg.log('OK', 'Clique executado');

    // Aguarda 1s e inspeciona o DOM
    await new Promise(r => setTimeout(r, 1000));
    await probeInspecionarDomPosClique(page, dbg);

    // PROBE B — tenta extrair Blob da memória (funciona para H1, H2 e H3)
    const blobs = await probeExtrairBlobDaMemoria(page, dbg, 10000);

    // Aguarda PROBE D terminar
    await probeTargetsPromise;

    // Salva os Blobs encontrados como PDF
    for (const blob of blobs) {
        if (blob.sucesso && blob.base64) {
            const isPdf = blob.base64.startsWith('JVBER'); // base64 de "%PDF"
            const ext   = isPdf ? 'pdf' : 'bin';
            const dest  = path.join(pasta, `blob-capturado-${idDeposito}.${ext}`);
            fs.writeFileSync(dest, Buffer.from(blob.base64, 'base64'));
            dbg.log('OK', `Blob salvo em disco!`, { caminho: dest, isPdf, size: blob.size });
        }
    }

    // Screenshot final
    const ssPath = path.join(pasta, `debug-v2-screenshot-${idDeposito}.png`);
    await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
    dbg.log('INFO', 'Screenshot capturado', { ssPath });

    dbg.salvar(`debug-v2-report-${idDeposito}.json`);

    return { blobs, dbg };
}

module.exports = {
    executarDiagnosticoV2,
    probeInjetarEspiosBlobEPopup,
    probeExtrairBlobDaMemoria,
    probeInspecionarDomPosClique,
    probePollingDeTargets,
    criarLogger,
};