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

// Retiramos o 'async' da assinatura pois ela vai retornar a Promessa diretamente
function prepararCapturaDeBoletoPeloConsole(page, pastaDownload, opcoes = {}) {
    const timeoutMs = opcoes.timeoutMs || 30000;
    console.log("Ativando captura do console ANTES de clicar...");

    // Garante que a pasta destino existe
    if (!fs.existsSync(pastaDownload)){
        fs.mkdirSync(pastaDownload, { recursive: true });
    }

    // Retorna a promessa imediatamente. Ela ficará pendente até o PDF aparecer.
    return new Promise((resolve, reject) => {
        let encerrado = false;

        const limpar = () => {
            clearTimeout(timer);
            if (typeof page.off === 'function') {
                page.off('console', capturarConsole);
            } else if (typeof page.removeListener === 'function') {
                page.removeListener('console', capturarConsole);
            }
        };

        const resolverUmaVez = (resultado) => {
            if (encerrado) return;
            encerrado = true;
            limpar();
            resolve(resultado);
        };

        const rejeitarUmaVez = (erro) => {
            if (encerrado) return;
            encerrado = true;
            limpar();
            reject(erro);
        };

        const timer = setTimeout(() => {
            rejeitarUmaVez(new Error("Boleto: PDF não apareceu no console dentro do timeout."));
        }, timeoutMs);

        const capturarConsole = async (msg) => {
            const argumentos = msg.args(); 
            console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);

            for (const arg of argumentos) {
                try {
                    const objetoLogado = await arg.jsonValue();

                    if (objetoLogado && typeof objetoLogado === 'object') {
                        const base64Data = objetoLogado.boleto || objetoLogado.pdf || encontrarBase64(objetoLogado);
                        const idDeposito = objetoLogado.id || '';
                        const codigoBarra = objetoLogado.linhaDigitavel || '';
                        if (!base64Data || typeof base64Data !== 'string') continue;

                        console.log("PDF localizado no console. Salvando arquivo...");
                        const nomeArquivo = opcoes.nomeArquivo || objetoLogado.filename || `boleto_${Date.now()}.pdf`;
                        const caminhoCompleto = resolverNomeArquivoPdfUnico(pastaDownload, nomeArquivo);

                        const pdfBuffer = Buffer.from(base64Data, 'base64');
                        fs.writeFileSync(caminhoCompleto, pdfBuffer);

                        console.log(`PDF salvo em: ${caminhoCompleto}`);
                        resolverUmaVez({
                            sucesso: true,
                            caminho: caminhoCompleto,
                            idDeposito,
                            codigoBarra
                        });
                        return;
                    }
                } catch (e) {
                    // Ignora erros silenciosamente caso arg.jsonValue() falhe em objetos normais do site
                    console.log('Arg não serializável para JSON, ignorando...', e.message);
                }
            }
        };

        page.on('console', capturarConsole);
    });
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
    try {
        // Usa um timeout curto para não travar o robô esperando à toa
        await page.waitForSelector(seletor, { visible: true , timeout: 500 });
        console.log(`[${descricao}] Campo editável encontrado. Preenchendo...`);
        await page.type(seletor, valor);
        await page.keyboard.press('Tab');
        return true;
    } catch (e) {
        console.log(`[${descricao}] Campo de input não encontrado. Assumindo que já está preenchido como label.`);
        return false;
    }
}

/**
 * Tenta selecionar uma opção. Se o select não existir, assume que é um label preenchido e segue.
 */
async function selecionarOuIgnorar(page, seletor, valor, descricao, isTexto = false) {
    try {
        await page.waitForSelector(seletor, { visible: true, timeout: 500 });
    } catch (e) {
        console.log(`[${descricao}] Select não encontrado. Assumindo que já está preenchido como label.`);
        return false;
    }

    console.log(`[${descricao}] Select encontrado. Selecionando...`);

    try {
        if (isTexto) {
            // Usa a sua função customizada que busca por texto
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
 * * @param {object} page - A instância da página do Puppeteer.
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
    await page.waitForSelector(seletorSelect, { visible: true });

    // 2. Injeta um código no navegador para descobrir o 'value' verdadeiro baseado no texto
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

    // 3. Validação: interrompe e avisa se o texto não existir lá dentro
    if (!valorRealDaOpcao) {
        throw new Error(`A opção "${textoProcurado}" não foi encontrada dentro de "${seletorSelect}".`);
    }

    // 4. Executa a ação final de seleção usando o valor nativo mapeado
    await page.select(seletorSelect, valorRealDaOpcao);
    
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
        await btnContinuar.click();

        //await helper.waitForAngularReady({ debug: true });
        await navUtils.delay(2000); // Pequena pausa para garantir que a transição ocorreu

        console.log("Marcando a checkbox de aceitação de termos...");
        const checkboxLidoConcordado = await page.waitForSelector('#lido-concordado', { visible: true, timeout: 15000 });
        if (!checkboxLidoConcordado) throw new Error("Checkbox 'lido-concordado' não encontrada.");
        await checkboxLidoConcordado.click();

        console.log("Clicando no botão 'Confirmar'...");
        const btnConfirmar = await page.waitForSelector('button.btn-primary::-p-text(Confirmar)', { visible: true, timeout: 15000 });
        if (!btnConfirmar) throw new Error("Botão 'Confirmar' não encontrado.");
        await btnConfirmar.click();

        //await helper.waitForAngularReady({ debug: true });
        await navUtils.delay(2000); // Pequena pausa para garantir que a transição ocorreu

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

        //await helper.waitForAngularReady({ debug: true });
        //await navUtils.delay(500);

        console.log("Clicando no botão Continuar...");
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
