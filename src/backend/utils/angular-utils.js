const fs = require('fs');
const path = require('path');
const navUtils = require('./navigation-utils');

function encontrarBase64(obj) {
    for (let key in obj) {
        const val = obj[key];

        if (typeof val === 'string' && val.includes('JVBER')) {
            return val;
        }

        if (typeof val === 'object' && val !== null) {
            const encontrado = encontrarBase64(val);
            if (encontrado) return encontrado;
        }
    }
    return null;
}

function sanitizarNomeArquivoPdf(nomeBase, fallback = 'boleto') {
    const nomeLimpo = String(nomeBase || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/_+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '');

    const base = nomeLimpo || fallback;
    const semExtensao = base.toLowerCase().endsWith('.pdf') ? base.slice(0, -4) : base;
    const baseLimitada = semExtensao.slice(0, 150).trim().replace(/[. ]+$/g, '') || fallback;

    return `${baseLimitada}.pdf`;
}

function resolverNomeArquivoPdfUnico(pastaDownload, nomeArquivo) {
    const nomeSanitizado = sanitizarNomeArquivoPdf(nomeArquivo);
    const ext = path.extname(nomeSanitizado);
    const base = path.basename(nomeSanitizado, ext);
    let caminhoCompleto = path.resolve(pastaDownload, nomeSanitizado);
    let contador = 2;

    while (fs.existsSync(caminhoCompleto)) {
        caminhoCompleto = path.resolve(pastaDownload, `${base}_${contador}${ext}`);
        contador += 1;
    }

    return caminhoCompleto;
}

/**
 * Captura o PDF do boleto emitido pela Caixa, suportando tanto o novo mecanismo via Blob do botão
 * "Ver boleto bancário" quanto o mecanismo legado de log no console.
 *
 * @param {object} page - Instância da página do Puppeteer.
 * @param {string} pastaDownload - Diretório onde o PDF será salvo.
 * @param {object} opcoes - Opções com nomeArquivo, timeoutMs, etc.
 */
async function capturarPdfBoletoCaixa(page, pastaDownload, opcoes = {}) {
    const timeoutMs = opcoes.timeoutMs || 30000;
    console.log("Iniciando captura de boleto da Caixa (Blob / DOM / Console)...");

    if (!fs.existsSync(pastaDownload)) {
        fs.mkdirSync(pastaDownload, { recursive: true });
    }

    const nomeBase = opcoes.nomeArquivo || `boleto_${Date.now()}`;
    const caminhoCompleto = resolverNomeArquivoPdfUnico(pastaDownload, nomeBase);

    // 1. Aguarda a tela final de boleto carregar
    await page.waitForSelector('button::-p-text(Ver boleto bancário), button.black, button::-p-text(Novo Depósito)', {
        visible: true,
        timeout: timeoutMs
    });

    // 2. Extrai dados textuais gerados na tela (Código de Barras e ID do Depósito)
    const dadosTela = await page.evaluate(() => {
        const todosTextos = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, span, p, div, strong, b, button'))
            .map(el => el.innerText.trim())
            .filter(Boolean);

        // Código de barras (linha digitável com ~47-48 dígitos numéricos)
        const codigoBarra = todosTextos.find(t => /^\d{40,55}$/.test(t.replace(/\s+/g, ''))) || '';

        // ID de depósito (ex: "040253501662609038" ou procurando por "ID do seu depósito:")
        let idDeposito = '';
        const textoId = todosTextos.find(t => t.includes('ID do seu depósito'));
        if (textoId) {
            const match = textoId.match(/(\d{15,25})/);
            if (match) idDeposito = match[1];
        }
        if (!idDeposito) {
            idDeposito = todosTextos.find(t => /^\d{16,20}$/.test(t)) || '';
        }

        return { idDeposito, codigoBarra: codigoBarra.replace(/\s+/g, '') };
    });

    console.log(`Dados extraídos da tela: ID=${dadosTela.idDeposito || '(não encontrado)'} | Código de Barras=${dadosTela.codigoBarra || '(não encontrado)'}`);

    // 3. Configura interceptador de Blob / window.open no navegador
    await page.evaluate(() => {
        window.__capturedBlobPdfs = [];
        const origCreateObjectURL = URL.createObjectURL;
        URL.createObjectURL = function(blob) {
            const url = origCreateObjectURL.call(URL, blob);
            if (blob && (blob.type === 'application/pdf' || blob.size > 1000)) {
                window.__capturedBlobPdfs.push(url);
            }
            return url;
        };

        // Suprime a abertura visual de nova aba pelo window.open e guarda a URL do Blob
        window.open = function(url) {
            if (url && typeof url === 'string') {
                window.__capturedBlobPdfs.push(url);
            }
            return null;
        };
    });

    // 4. Clica no botão "Ver boleto bancário" para disparar a geração do Blob
    console.log("Clicando em 'Ver boleto bancário' para obter o PDF...");
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => 
            b.innerText.includes('Ver boleto') || b.innerText.includes('boleto')
        );
        if (btn) btn.click();
    });

    // 5. Aguarda o Blob ser gerado e extrai o binário via fetch no contexto da página
    try {
        await page.waitForFunction(() => {
            return window.__capturedBlobPdfs && window.__capturedBlobPdfs.length > 0;
        }, { timeout: 15000 });

        const pdfBase64 = await page.evaluate(async () => {
            const url = window.__capturedBlobPdfs[window.__capturedBlobPdfs.length - 1];
            if (!url) return null;
            const res = await fetch(url);
            const buf = await res.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
        });

        // Garante o fechamento de qualquer aba secundária eventualmente criada pelo navegador
        try {
            const browser = page.browser();
            const pages = await browser.pages();
            for (const p of pages) {
                if (p !== page && !p.isClosed()) {
                    await p.close().catch(() => {});
                }
            }
            await page.bringToFront().catch(() => {});
        } catch (e) {}

        if (pdfBase64) {
            const pdfBuffer = Buffer.from(pdfBase64, 'base64');
            if (pdfBuffer.slice(0, 4).toString() === '%PDF' || pdfBuffer.length > 500) {
                fs.writeFileSync(caminhoCompleto, pdfBuffer);
                console.log(`✅ PDF do boleto capturado via Blob e salvo com sucesso em: ${caminhoCompleto}`);
                return {
                    sucesso: true,
                    caminho: caminhoCompleto,
                    idDeposito: dadosTela.idDeposito,
                    codigoBarra: dadosTela.codigoBarra
                };
            }
        }
    } catch (erroBlob) {
        console.log(`Aviso: Captura via Blob retornou: ${erroBlob.message}. Tentando métodos alternativos...`);
    }

    throw new Error("Não foi possível capturar o PDF do boleto gerado.");
}

function prepararCapturaDeBoletoPeloConsole(page, pastaDownload, opcoes = {}) {
    return capturarPdfBoletoCaixa(page, pastaDownload, opcoes);
}

/**
 * Procura um texto na tela (Label), encontra o <select> próximo a ele e injeta um ID temporário.
 * @returns {string|null} Retorna o novo seletor CSS criado, ou null se não encontrar.
 */
async function resgatarSelectPorLabel(page, textoLabel, novoId) {
    console.log(`Procurando label contendo "${textoLabel}" para ancorar o select...`);
    
    const encontrouEInjetou = await page.evaluate((txt, idInjetado) => {
        // 1. Pega todos os textos da tela
        const elementosTexto = Array.from(document.querySelectorAll('label, div, span'));
        
        // 2. Encontra a label que contém o texto desejado (ex: "Depositante")
        const labelAlvo = elementosTexto.find(el => el.textContent.includes(txt) && el.textContent.trim().length < 40);
        
        if (!labelAlvo) return false;

        // 3. Sobe na árvore HTML (pai e avô) para encontrar o <select> que pertence a essa label
        let container = labelAlvo.parentElement;
        let selectElement = container.querySelector('select');
        
        if (!selectElement && container.parentElement) {
            selectElement = container.parentElement.querySelector('select');
        }

        // 4. Se achou o select, força um ID novo nele para o Puppeteer conseguir usar
        if (selectElement) {
            selectElement.id = idInjetado;
            return true;
        }

        return false;
    }, textoLabel, novoId);

    // Se o script deu certo, retornamos o seletor formatado (ex: '#select-depositante-temp')
    return encontrouEInjetou ? `#${novoId}` : null;
}

/**
 * Tenta preencher um campo de texto. Se não existir (timeout), assume que é um label preenchido e segue.
 */
async function preencherOuIgnorar(page, seletor, valor, descricao) {
    if (!valor) {
        console.log(`[${descricao}] Valor vazio fornecido. Pulando preenchimento.`);
        return false;
    }

    try {
        await page.waitForSelector(seletor, { visible: true, timeout: 2000 });
        console.log(`[${descricao}] Campo editável encontrado. Preenchendo...`);

        const preencheu = await page.evaluate((sel, val) => {
            const input = document.querySelector(sel);
            if (!input) return false;

            input.focus();
            input.value = '';
            input.value = val;

            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.blur();
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
        }, seletor, valor);

        if (preencheu) {
            return true;
        }

        // Fallback via digitação do Puppeteer
        const input = await page.$(seletor);
        if (input) {
            await input.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await page.type(seletor, valor);
            await page.keyboard.press('Tab');
            return true;
        }

        return false;
    } catch (e) {
        console.log(`[${descricao}] Campo de input não encontrado via seletor "${seletor}". Assumindo que já está preenchido como label ou fixo.`);
        return false;
    }
}

/**
 * Tenta selecionar uma opção. Se o select não existir, assume que é um label preenchido e segue.
 */
async function selecionarOuIgnorar(page, seletor, valor, descricao, isTexto = false) {
    try {
        await page.waitForSelector(seletor, { visible: true, timeout: 2000 });
    } catch (e) {
        console.log(`[${descricao}] Select não encontrado. Assumindo que já está preenchido como label.`);
        return false;
    }

    console.log(`[${descricao}] Select encontrado. Selecionando...`);

    try {
        if (isTexto) {
            // Usa a função customizada que aguarda o carregamento e busca por texto
            await selecionarPorTexto(page, seletor, valor);
        } else {
            // Seleciona pelo value nativo
            await page.select(seletor, valor);
        }
        await page.keyboard.press('Tab');
        return true;
    } catch (e) {
        console.log(`[${descricao}] Erro ao selecionar opção "${valor}": ${e.message}`);
        throw e;
    }
}

async function preencherCampoAngular(page, seletor, valor) {
    await page.waitForSelector(seletor, { visible: true, timeout: 10000 });
    await page.evaluate((sel, val) => {
        const input = document.querySelector(sel);
        if (!input) return; // Proteção extra caso o elemento não exista
        
        input.focus();
        input.click();
        input.value = val;
        
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        input.blur();
        input.dispatchEvent(new Event('blur', { bubbles: true }));
    }, seletor, valor);
}

async function clicarCartaoPorTitulo(page, tituloProcurado) {
    console.log(`Aguardando a página processar e buscando: ${tituloProcurado}...`);
    
    try {
        // 1. BUSCA INTELIGENTE POR TEXTO
        // O seletor '::-p-text' é nativo do Puppeteer e procura elementos visíveis 
        // na tela que contenham esse texto específico. O timeout garante tempo para o loading sumir.
        const seletorTexto = `::-p-text(${tituloProcurado})`;
        const tituloElement = await page.waitForSelector(seletorTexto, { visible: true, timeout: 15000 });
        
        if (!tituloElement) {
            return { sucesso: false, erro: 'Título não encontrado na tela.' };
        }

        // 2. BUSCA DO ALVO EXATO
        // Usamos o evaluateHandle para pegar a referência "real" do elemento na memória do Puppeteer
        // e buscar o cartão raiz ou a <div> interna que vimos no seu arquivo .json
        const elementoAlvoHandle = await tituloElement.evaluateHandle((el) => {
            // Sobe na árvore de elementos até encontrar o contêiner do cartão
            const cartao = el.closest('app-card-button') || el.closest('.card-button');
            
            // O seu arquivo JSON gravou o clique em uma div aninhada dentro da estrutura (div > div).
            // Tentamos replicar isso pegando a div interna, senão, clicamos no cartão principal.
            return cartao ? (cartao.querySelector('div > div') || cartao) : el;
        });

        // 3. O CLIQUE DE "HARDWARE" (O GRANDE SEGREDO)
        // Aqui acionamos o clique utilizando o driver do navegador.
        // É equivalente a um ser humano clicando, o que torna o evento 'isTrusted = true'.
        await elementoAlvoHandle.click();
        
        // 4. LIMPEZA DE MEMÓRIA
        // É uma boa prática avisar ao Node para não segurar mais esse elemento na memória
        await tituloElement.dispose();
        await elementoAlvoHandle.dispose();

        console.log("Clique efetuado com sucesso (Via Driver)!");

        return { 
            sucesso: true, 
            texto: tituloProcurado, 
            mensagem: 'Clique nativo executado com sucesso.' 
        };

    } catch (error) {
        console.error("Erro durante o processo de clique:", error.message);
        return { 
            sucesso: false, 
            erro: error.message 
        };
    }
}

/**
 * Seleciona uma opção de um <select> com base no texto visível, ignorando espaços e maiúsculas.
 * @param {object} page - A instância da página do Puppeteer.
 * @param {string} seletorSelect - O seletor CSS que aponta para o campo <select>.
 * @param {string} textoProcurado - O texto visível que você quer escolher (ex: " Goiás ").
 */
function normalizarTextoParaComparacao(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

async function selecionarPorTexto(page, seletorSelect, textoProcurado) {
    // 1. Aguarda o select aparecer na tela para evitar erros de elemento não encontrado
    await page.waitForSelector(seletorSelect, { visible: true, timeout: 15000 });

    // 2. Aguarda até que as opções do select tenham sido carregadas (para selects dinâmicos/AJAX)
    await page.waitForFunction((sel) => {
        const select = document.querySelector(sel);
        return select && select.options && select.options.length > 1;
    }, { timeout: 15000 }, seletorSelect).catch(() => {
        console.log(`[selecionarPorTexto] Timeout aguardando opções no select ${seletorSelect}, prosseguindo com opções atuais.`);
    });

    // 3. Injeta um código no navegador para descobrir o 'value' verdadeiro baseado no texto
    const valorRealDaOpcao = await page.evaluate((seletor, textoDesejado) => {
        
        // Função interna para padronizar o texto: remove acentos, espaços extras e caixa.
        const normalizarTexto = (str) => {
            return String(str || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
        };
        
        const textoLimpoDesejado = normalizarTexto(textoDesejado);
        
        // Captura o elemento <select>
        const selectElement = document.querySelector(seletor);
        if (!selectElement) return null;

        // Transforma as opções do select em uma lista verificável
        const opcoes = Array.from(selectElement.options);
        
        // Procura a opção cujo texto limpo seja exatamente igual ao texto desejado limpo
        const opcaoEncontrada = opcoes.find(opcao => normalizarTexto(opcao.textContent) === textoLimpoDesejado);

        // Se encontrou, retorna o atributo value que o Angular gerou (ex: "1: Object")
        return opcaoEncontrada ? opcaoEncontrada.value : null;
        
    }, seletorSelect, textoProcurado);

    // 4. Validação: interrompe e avisa se o texto não existir lá dentro
    if (!valorRealDaOpcao) {
        throw new Error(`A opção "${textoProcurado}" não foi encontrada dentro de "${seletorSelect}".`);
    }

    // 5. Executa a ação final de seleção usando o valor nativo mapeado e dispara eventos Angular
    await page.evaluate((sel, val) => {
        const select = document.querySelector(sel);
        if (!select) return;
        select.value = val;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('blur', { bubbles: true }));
    }, seletorSelect, valorRealDaOpcao);
    
    console.log(`Sucesso: Opção de texto "${textoProcurado}" selecionada através do valor interno "${valorRealDaOpcao}".`);
    return true;
}

/**
 * Avança as etapas para selecionar a forma de pagamento BOLETO.
 * @param {object} page - A instância da página do Puppeteer.
 * @param {AngularHelper} helper - A instância do AngularHelper.
 */
async function selecionarBoletoEContinuar(page, helper) {
    try {
        const btnContinuar = await page.waitForSelector('button.btn-primary::-p-text(Continuar)', { visible: true, timeout: 15000 });
        if (!btnContinuar) throw new Error("Botão 'Continuar' inicial não encontrado.");

        // DIAGNÓSTICO DEFENSIVO: Verifica se o botão Continuar está desabilitado por pendência de validação no formulário
        const estadoContinuar = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button.btn-primary, button'));
            const btn = btns.find(b => b.textContent.includes('Continuar') && b.offsetParent !== null);
            if (!btn) return { encontrado: false };

            if (btn.disabled) {
                // Coleta todos os campos inválidos no formulário Angular para diagnóstico imediato
                const invalidos = Array.from(document.querySelectorAll('.ng-invalid, .is-invalid')).map(el => {
                    const tag = el.tagName.toLowerCase();
                    const nome = el.getAttribute('formcontrolname') || el.getAttribute('name') || el.id || el.getAttribute('label') || tag;
                    return `${tag}[${nome}]`;
                });
                return { encontrado: true, disabled: true, invalidos: Array.from(new Set(invalidos)) };
            }
            return { encontrado: true, disabled: false };
        });

        if (estadoContinuar.disabled) {
            throw new Error(`Botão 'Continuar' está desabilitado na tela de Informações do Depósito. Verifique o preenchimento dos campos obrigatórios. Campos com validação pendente: ${estadoContinuar.invalidos.join(', ') || 'não identificados'}`);
        }

        await btnContinuar.click();
        await navUtils.delay(2000); // Pequena pausa para garantir transição para a tela de Confirmação de dados

        console.log("Marcando a checkbox de aceitação de termos (#lido-concordado)...");
        await page.waitForSelector('#lido-concordado', { visible: true, timeout: 15000 });

        // Marca a checkbox se ainda não estiver marcada e emite os eventos do Angular
        const marcouCheckbox = await page.evaluate(() => {
            const chk = document.querySelector('#lido-concordado');
            if (!chk) return false;

            if (!chk.checked) {
                chk.click();
            }

            chk.dispatchEvent(new Event('input', { bubbles: true }));
            chk.dispatchEvent(new Event('change', { bubbles: true }));
            return chk.checked;
        });

        if (!marcouCheckbox) {
            // Fallback via clique do Puppeteer
            const chkEl = await page.$('#lido-concordado');
            if (chkEl) await chkEl.click();
        }

        // Aguarda ativamente o botão Confirmar ficar habilitado
        console.log("Aguardando habilitação do botão 'Confirmar'...");
        await page.waitForFunction(() => {
            const btns = Array.from(document.querySelectorAll('button.btn-primary, button'));
            const btn = btns.find(b => b.textContent.includes('Confirmar') && b.offsetParent !== null);
            return btn && !btn.disabled;
        }, { timeout: 15000 });

        console.log("Clicando no botão 'Confirmar'...");
        const clicouConfirmar = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button.btn-primary, button'));
            const btn = btns.find(b => b.textContent.includes('Confirmar') && !b.disabled && b.offsetParent !== null);
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });

        if (!clicouConfirmar) {
            const btnConfirmar = await page.waitForSelector('button.btn-primary::-p-text(Confirmar)', { visible: true, timeout: 5000 });
            if (btnConfirmar) await btnConfirmar.click();
        }

        await navUtils.delay(2000); // Aguarda transição para a tela de Forma de Pagamento

        console.log("Selecionando a forma de pagamento (BOLETO)...");
        const seletorRadioBoleto = 'input[formcontrolname="formaPagamento"][value="BOLETO"]';
        await page.waitForSelector(seletorRadioBoleto, { visible: true, timeout: 30000 });
        
        const clicou = await page.evaluate((seletor) => {
            const el = document.querySelector(seletor);
            if (el) {
                el.click();
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        }, seletorRadioBoleto);

        if (!clicou) throw new Error("Opção de pagamento BOLETO não encontrada no DOM.");

        await navUtils.delay(1000);

        console.log("Clicando no botão Continuar da forma de pagamento...");
        const clicouContinuar = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button.btn-primary'));
            // Busca de trás pra frente caso tenha múltiplos, garantindo pegar o ativo atual
            const btn = btns.reverse().find(b => b.textContent.includes('Continuar') && !b.disabled && b.offsetParent !== null);
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        });

        if (!clicouContinuar) throw new Error("Botão 'Continuar' de pagamento não encontrado ou desabilitado.");
    } catch (error) {
        console.error("Erro ao selecionar a forma de pagamento BOLETO:", error.message);
        throw error;
    }
}

async function finalizarECapturarBoletoPeloConsole(page, pastaDownload, helper) {
    await helper.waitForAngularReady({ debug: true });
    return prepararCapturaDeBoletoPeloConsole(page, pastaDownload, { timeoutMs: 20000 });
}

module.exports = {
    encontrarBase64,
    sanitizarNomeArquivoPdf,
    resolverNomeArquivoPdfUnico,
    normalizarTextoParaComparacao,
    capturarPdfBoletoCaixa,
    prepararCapturaDeBoletoPeloConsole,
    resgatarSelectPorLabel,
    preencherOuIgnorar,
    selecionarOuIgnorar,
    preencherCampoAngular,
    clicarCartaoPorTitulo,
    selecionarPorTexto,
    selecionarBoletoEContinuar,
    finalizarECapturarBoletoPeloConsole
};
