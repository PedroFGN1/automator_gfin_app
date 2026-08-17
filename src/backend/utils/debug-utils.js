const fs = require('fs');
const path = require('path');

const MARCADOR_CORS = '[Acesso Restrito CORS]';
const ATRIBUTO_DESTAQUE = 'data-debug-utils-highlighted';
const ID_BANNER_PAUSA = 'debug-utils-pause-banner';
const TEMPO_PADRAO_PAUSA_MS = 5 * 60 * 1000;
const CAPTURAS_CONSOLE = new WeakMap();
const MONITORES_JSF = new WeakMap();

function normalizarTexto(valor) {
    return String(valor || '').replace(/\s+/g, ' ').trim();
}

function validarContextoAvaliado(contexto, nome = 'contexto') {
    if (!contexto || typeof contexto.evaluate !== 'function') {
        throw new Error(`O ${nome} informado nao e um contexto valido do Puppeteer.`);
    }
}

function validarPaginaComEventos(page, nome = 'page') {
    validarContextoAvaliado(page, nome);

    if (typeof page.on !== 'function') {
        throw new Error(`A ${nome} informada nao suporta listeners de eventos.`);
    }
}

function removerListenerSeguro(alvo, evento, listener) {
    if (!alvo || typeof listener !== 'function') {
        return;
    }

    if (typeof alvo.off === 'function') {
        alvo.off(evento, listener);
        return;
    }

    if (typeof alvo.removeListener === 'function') {
        alvo.removeListener(evento, listener);
    }
}

function extrairValor(funcaoOuValor, valorPadrao = null) {
    try {
        if (typeof funcaoOuValor === 'function') {
            return funcaoOuValor();
        }

        if (funcaoOuValor !== undefined) {
            return funcaoOuValor;
        }
    } catch (erro) {}

    return valorPadrao;
}

function limitarTexto(texto, limite = 400) {
    const textoNormalizado = normalizarTexto(texto);

    if (textoNormalizado.length <= limite) {
        return textoNormalizado;
    }

    return `${textoNormalizado.slice(0, limite)}...`;
}

function compactarHtmlSnapshot(html) {
    const texto = String(html || '').replace(/\r\n/g, '\n');

    return texto
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+</g, '\n<')
        .replace(/\n[ \t]+\n/g, '\n\n')
        .replace(/>\s+\n\s+</g, '>\n<')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .concat('\n');
}

function detectarTrafegoJSF({ url, headers, postData, responseHeaders, statusText }) {
    const conteudo = [
        url,
        postData,
        statusText,
        JSON.stringify(headers || {}),
        JSON.stringify(responseHeaders || {})
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return [
        'javax.faces.viewstate',
        'javax.faces.partial.ajax',
        'faces-request',
        'primefaces',
        'partial-response'
    ].some((sinal) => conteudo.includes(sinal));
}

function mapearMetodoLog(tipo) {
    if (tipo === 'warning' || tipo === 'warn') {
        return 'warn';
    }

    if (tipo === 'error') {
        return 'error';
    }

    return 'log';
}

async function extrairElementosInterativos(page, frame = null) {
    const contexto = frame || page;
    validarContextoAvaliado(contexto, 'page/frame');

    return contexto.evaluate(() => {
        const normalizar = (valor) => String(valor || '').replace(/\s+/g, ' ').trim();

        return Array.from(document.querySelectorAll('input, button, a, select')).map((elemento) => {
            const tag = elemento.tagName.toLowerCase();
            const type = normalizar(elemento.getAttribute('type'));
            const texto =
                tag === 'input'
                    ? normalizar(elemento.value || elemento.getAttribute('value'))
                    : tag === 'select'
                        ? normalizar(
                            elemento.options[elemento.selectedIndex]?.text ||
                            elemento.textContent
                        )
                        : normalizar(elemento.innerText || elemento.textContent);

            return {
                tag,
                type: type || null,
                id: normalizar(elemento.id) || null,
                name: normalizar(elemento.getAttribute('name')) || null,
                className: normalizar(elemento.className) || null,
                texto: texto || null,
                placeholder: normalizar(elemento.getAttribute('placeholder')) || null,
                value: normalizar(elemento.value) || null,
                disabled: Boolean(elemento.disabled),
                href: tag === 'a' ? elemento.href || null : null
            };
        });
    });
}

async function listarArvoreDeFrames(page) {
    if (!page || typeof page.mainFrame !== 'function') {
        throw new Error('A page informada nao possui uma arvore de frames acessivel.');
    }

    async function montarNo(frame, raiz = false) {
        const no = {
            name: null,
            id: null,
            url: extrairValor(() => frame.url(), null),
            src: raiz ? null : null,
            children: [],
            accessRestricted: false
        };

        const nomeFrame = extrairValor(() => frame.name(), null);
        if (nomeFrame) {
            no.name = nomeFrame;
        }

        if (!raiz && typeof frame.frameElement === 'function') {
            try {
                const frameElement = await frame.frameElement();

                if (frameElement && typeof frameElement.evaluate === 'function') {
                    const metadados = await frameElement.evaluate((elemento) => ({
                        id: elemento.id || null,
                        name: elemento.getAttribute('name') || null,
                        src: elemento.getAttribute('src') || null
                    }));

                    no.id = metadados.id || null;
                    no.name = no.name || metadados.name || null;
                    no.src = metadados.src || null;
                }
            } catch (erro) {
                no.accessRestricted = true;
                no.id = MARCADOR_CORS;
                no.name = no.name || MARCADOR_CORS;
                no.src = MARCADOR_CORS;
            }
        }

        const filhos = typeof frame.childFrames === 'function' ? frame.childFrames() : [];
        for (const filho of filhos) {
            no.children.push(await montarNo(filho, false));
        }

        return no;
    }

    return montarNo(page.mainFrame(), true);
}

async function salvarSnapshotDOM(contexto, caminhoArquivo) {
    validarContextoAvaliado(contexto);

    const caminhoNormalizado = String(caminhoArquivo || '').trim();
    if (!caminhoNormalizado) {
        throw new Error('Informe um caminho de arquivo valido para salvar o snapshot do DOM.');
    }

    const caminhoAbsoluto = path.isAbsolute(caminhoNormalizado)
        ? caminhoNormalizado
        : path.resolve(caminhoNormalizado);

    const html = await contexto.evaluate(() => {
        const clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach((elemento) => elemento.remove());
        return `<!DOCTYPE html>\n${clone.outerHTML}`;
    });

    const htmlCompactado = compactarHtmlSnapshot(html);

    await fs.promises.mkdir(path.dirname(caminhoAbsoluto), { recursive: true });
    await fs.promises.writeFile(caminhoAbsoluto, htmlCompactado, 'utf8');

    return {
        caminhoArquivo: caminhoAbsoluto,
        bytes: Buffer.byteLength(htmlCompactado, 'utf8'),
        linhas: htmlCompactado.split('\n').length,
        html: htmlCompactado
    };
}

async function destacarElemento(page, seletor) {
    validarContextoAvaliado(page, 'page');

    const seletorNormalizado = String(seletor || '').trim();
    if (!seletorNormalizado) {
        throw new Error('Informe um seletor valido para destacar um elemento.');
    }

    const resultado = await page.evaluate((selector, atributoDestaque) => {
        const anterior = document.querySelector(`[${atributoDestaque}="true"]`);

        if (anterior) {
            anterior.style.outline = anterior.dataset.debugUtilsPrevOutline || '';
            anterior.style.backgroundColor = anterior.dataset.debugUtilsPrevBackgroundColor || '';
            anterior.style.transition = anterior.dataset.debugUtilsPrevTransition || '';
            anterior.removeAttribute(atributoDestaque);
            delete anterior.dataset.debugUtilsPrevOutline;
            delete anterior.dataset.debugUtilsPrevBackgroundColor;
            delete anterior.dataset.debugUtilsPrevTransition;
        }

        const elemento = document.querySelector(selector);
        if (!elemento) {
            return { encontrado: false };
        }

        elemento.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        elemento.dataset.debugUtilsPrevOutline = elemento.style.outline || '';
        elemento.dataset.debugUtilsPrevBackgroundColor = elemento.style.backgroundColor || '';
        elemento.dataset.debugUtilsPrevTransition = elemento.style.transition || '';
        elemento.setAttribute(atributoDestaque, 'true');
        elemento.style.transition = 'outline 0.2s ease, background-color 0.2s ease';
        elemento.style.outline = '4px solid red';
        elemento.style.backgroundColor = 'yellow';

        return {
            encontrado: true,
            tag: elemento.tagName.toLowerCase()
        };
    }, seletorNormalizado, ATRIBUTO_DESTAQUE);

    if (!resultado || !resultado.encontrado) {
        throw new Error(`Nenhum elemento encontrado para o seletor "${seletorNormalizado}".`);
    }

    return resultado;
}

async function pausarExecucao(page, mensagem = 'Pausado para Debug', opcoes = {}) {
    validarContextoAvaliado(page, 'page');

    if (process.env.NODE_ENV === 'production') {
        console.warn('[debug-utils] Pausa de execucao ignorada em ambiente de producao.');
        return { ignorado: true, motivo: 'production' };
    }

    const timeoutMs = Number.isFinite(opcoes.timeoutMs) && opcoes.timeoutMs > 0
        ? opcoes.timeoutMs
        : TEMPO_PADRAO_PAUSA_MS;

    await page.evaluate((texto, bannerId) => {
        const removerPausa = () => {
            const bannerAtual = document.getElementById(bannerId);
            if (bannerAtual) {
                bannerAtual.remove();
            }

            delete window.continuarBot;
            delete window.__debugUtilsPauseState;
        };

        removerPausa();

        const banner = document.createElement('div');
        banner.id = bannerId;
        banner.textContent = texto;
        banner.style.position = 'fixed';
        banner.style.top = '0';
        banner.style.left = '0';
        banner.style.right = '0';
        banner.style.zIndex = '2147483647';
        banner.style.padding = '16px 24px';
        banner.style.backgroundColor = '#b91c1c';
        banner.style.color = '#ffffff';
        banner.style.fontSize = '20px';
        banner.style.fontWeight = '700';
        banner.style.textAlign = 'center';
        banner.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
        banner.style.fontFamily = 'Arial, sans-serif';

        const alvo = document.body || document.documentElement;
        alvo.appendChild(banner);

        window.__debugUtilsPauseState = { resumed: false };
        window.continuarBot = () => {
            if (window.__debugUtilsPauseState) {
                window.__debugUtilsPauseState.resumed = true;
            }

            removerPausa();
        };
    }, mensagem, ID_BANNER_PAUSA);

    try {
        await page.waitForFunction(
            () => Boolean(window.__debugUtilsPauseState && window.__debugUtilsPauseState.resumed),
            { timeout: timeoutMs }
        );

        return { retomado: true };
    } catch (erro) {
        const mensagemErro = String(erro && erro.message ? erro.message : erro);
        if (mensagemErro.toLowerCase().includes('timeout')) {
            throw new Error(`Tempo esgotado ao aguardar a retomada do debug apos ${timeoutMs}ms.`);
        }

        throw erro;
    } finally {
        try {
            await page.evaluate((bannerId) => {
                const banner = document.getElementById(bannerId);
                if (banner) {
                    banner.remove();
                }

                delete window.continuarBot;
                delete window.__debugUtilsPauseState;
            }, ID_BANNER_PAUSA);
        } catch (erro) {}
    }
}

function monitorarTrafegoJSF(page, duracaoMs = 5000, opcoes = {}) {
    validarPaginaComEventos(page, 'page');

    const monitorExistente = MONITORES_JSF.get(page);
    if (monitorExistente && typeof monitorExistente.cleanup === 'function') {
        monitorExistente.cleanup('reiniciado');
    }

    const duracaoValida = Number.isFinite(duracaoMs) && duracaoMs > 0 ? duracaoMs : 5000;
    const eventos = [];
    const somenteJSF = Boolean(opcoes.somenteJSF);
    const prefixo = opcoes.prefixoLog || '[debug-utils][JSF]';

    let timer = null;
    let finalizado = false;
    let resolverResultado;

    const promise = new Promise((resolve) => {
        resolverResultado = resolve;
    });

    const requestListener = (request) => {
        const resourceType = extrairValor(() => request.resourceType(), extrairValor(request.resourceType, ''));
        if (resourceType !== 'xhr' && resourceType !== 'fetch') {
            return;
        }

        const headers = extrairValor(() => request.headers(), {});
        const postData = extrairValor(() => request.postData(), '');
        const evento = {
            direcao: 'request',
            timestamp: new Date().toISOString(),
            url: extrairValor(() => request.url(), ''),
            metodo: extrairValor(() => request.method(), ''),
            resourceType,
            jsf: detectarTrafegoJSF({
                url: extrairValor(() => request.url(), ''),
                headers,
                postData
            }),
            headers,
            postData: limitarTexto(postData)
        };

        if (somenteJSF && !evento.jsf) {
            return;
        }

        eventos.push(evento);
        console.log(
            `${prefixo}[request] ${evento.metodo || 'GET'} ${evento.url} ` +
            `(tipo=${evento.resourceType}, jsf=${evento.jsf ? 'sim' : 'nao'})`
        );
    };

    const responseListener = (response) => {
        const request = typeof response.request === 'function' ? response.request() : null;
        const resourceType = request
            ? extrairValor(() => request.resourceType(), extrairValor(request.resourceType, ''))
            : '';

        if (resourceType !== 'xhr' && resourceType !== 'fetch') {
            return;
        }

        const url = extrairValor(() => response.url(), request ? extrairValor(() => request.url(), '') : '');
        const headers = request ? extrairValor(() => request.headers(), {}) : {};
        const postData = request ? extrairValor(() => request.postData(), '') : '';
        const responseHeaders = extrairValor(() => response.headers(), {});
        const evento = {
            direcao: 'response',
            timestamp: new Date().toISOString(),
            url,
            metodo: request ? extrairValor(() => request.method(), '') : '',
            resourceType,
            status: extrairValor(() => response.status(), null),
            statusText: extrairValor(() => response.statusText(), ''),
            jsf: detectarTrafegoJSF({
                url,
                headers,
                postData,
                responseHeaders,
                statusText: extrairValor(() => response.statusText(), '')
            }),
            headers: responseHeaders
        };

        if (somenteJSF && !evento.jsf) {
            return;
        }

        eventos.push(evento);
        console.log(
            `${prefixo}[response] ${evento.status || 'sem-status'} ${evento.metodo || 'GET'} ` +
            `${evento.url} (tipo=${evento.resourceType}, jsf=${evento.jsf ? 'sim' : 'nao'})`
        );
    };

    const encerrarMonitor = (motivoEncerramento = 'manual') => {
        if (finalizado) {
            return promise;
        }

        finalizado = true;

        if (timer) {
            clearTimeout(timer);
            timer = null;
        }

        removerListenerSeguro(page, 'request', requestListener);
        removerListenerSeguro(page, 'response', responseListener);
        removerListenerSeguro(page, 'close', closeListener);
        removerListenerSeguro(page, 'error', errorListener);

        if (MONITORES_JSF.get(page) === controleMonitor) {
            MONITORES_JSF.delete(page);
        }

        resolverResultado({
            eventos: eventos.slice(),
            motivoEncerramento,
            cleanup: encerrarMonitor
        });

        return promise;
    };

    const closeListener = () => {
        encerrarMonitor('page-closed');
    };

    const errorListener = (erro) => {
        console.error(`${prefixo}[error] ${erro && erro.message ? erro.message : erro}`);
        encerrarMonitor('page-error');
    };

    const controleMonitor = {
        cleanup: encerrarMonitor,
        eventos
    };

    page.on('request', requestListener);
    page.on('response', responseListener);
    page.on('close', closeListener);
    page.on('error', errorListener);

    timer = setTimeout(() => {
        encerrarMonitor('timeout');
    }, duracaoValida);

    MONITORES_JSF.set(page, controleMonitor);

    promise.eventos = eventos;
    promise.cleanup = encerrarMonitor;
    promise.ativo = () => !finalizado;

    return promise;
}

function capturarLogsConsoleNavegador(page) {
    validarPaginaComEventos(page, 'page');

    const capturaExistente = CAPTURAS_CONSOLE.get(page);
    if (capturaExistente) {
        return capturaExistente.cleanup;
    }

    const consoleListener = (mensagem) => {
        const tipo = extrairValor(() => mensagem.type(), 'log');
        const texto = extrairValor(() => mensagem.text(), String(mensagem));
        const metodo = mapearMetodoLog(tipo);
        console[metodo](`[debug-utils][browser:${tipo}] ${texto}`);
    };

    const pageErrorListener = (erro) => {
        const mensagem = erro && erro.message ? erro.message : String(erro);
        console.error(`[debug-utils][browser:pageerror] ${mensagem}`);
    };

    const cleanup = () => {
        removerListenerSeguro(page, 'console', consoleListener);
        removerListenerSeguro(page, 'pageerror', pageErrorListener);

        if (CAPTURAS_CONSOLE.get(page)?.cleanup === cleanup) {
            CAPTURAS_CONSOLE.delete(page);
        }
    };

    page.on('console', consoleListener);
    page.on('pageerror', pageErrorListener);

    CAPTURAS_CONSOLE.set(page, { cleanup });

    return cleanup;
}

module.exports = {
    extrairElementosInterativos,
    listarArvoreDeFrames,
    salvarSnapshotDOM,
    destacarElemento,
    pausarExecucao,
    monitorarTrafegoJSF,
    capturarLogsConsoleNavegador
};
