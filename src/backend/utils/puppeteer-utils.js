// Funções genéricas de interação com o navegador

/**
 * Espera inteligente por um campo em uma página ou frame.
 * @param {Page|Frame} page - A página ou frame do Puppeteer onde procurar o campo.
 * @param {string} nomeCampo - O nome do campo (atributo name) a ser procurado.
 * @param {number} [tempoEspera=15000] - Tempo máximo de espera em milissegundos.
 * @returns {Promise<Page|Frame>} O contexto (página ou frame) onde o campo foi encontrado.
 * @throws {Error} Se o campo não for encontrado após o tempo de espera.
 */
async function aguardarContextoDoCampo(page, nomeCampo, tempoEspera = 15000) {
    const seletor = `input[name="${nomeCampo}"], select[name="${nomeCampo}"], textarea[name="${nomeCampo}"], input[value="${nomeCampo}"]`;
    try {
        await page.waitForSelector(seletor, { timeout: tempoEspera });
        return page; // Está na página principal
    } catch (erro) {
        // Procura nos frames
        for (const frame of page.frames()) {
            try {
                await frame.waitForSelector(seletor, { timeout: 1000 });
                return frame; // Está neste frame
            } catch (e) {}
        }
        throw new Error(`Campo "${nomeCampo}" não encontrado após ${tempoEspera}ms.`);
    }
}

/**
 * Preenche um campo de texto (input ou textarea) com um valor.
 * @param {Page|Frame} contexto - O contexto (página ou frame) onde o campo está localizado.
 * @param {string} nomeCampo - O nome do campo (atributo name).
 * @param {string|number} valor - O valor a ser preenchido no campo.
 */
// 2. Preencher Texto (Input ou Textarea)
async function preencherTexto(contexto, nomeCampo, valor) {
    const valorStr = valor ? String(valor).trim() : '';
    if (!valorStr) return;

    const seletor = `input[name="${nomeCampo}"], textarea[name="${nomeCampo}"]`;
    try {
        await contexto.click(seletor, { clickCount: 3 });
        await contexto.type(seletor, valorStr);
    } catch (e) {
        // Ignora erro se for opcional, ou lança se for crítico (ajustaremos no bot)
        console.log(`Aviso: Não consegui escrever em ${nomeCampo}`);
    }
}

/**
 * Seleciona uma opção em um dropdown pelo texto visível.
 * @param {Page|Frame} contexto - O contexto (página ou frame) onde o select está localizado.
 * @param {string} nomeSelect - O nome do select (atributo name).
 * @param {string} textoAlvo - O texto da opção a ser selecionada.
 * @returns {Promise<boolean>} Retorna true se a seleção foi bem-sucedida, false caso contrário.
 */
// 3. Selecionar em Dropdown pelo Texto visível
async function selecionarOpcaoPorTexto(contexto, nomeSelect, textoAlvo) {
    // log de diagnóstico
    console.log(`🔍 selecionarOpcaoPorTexto: procurando select "${nomeSelect}" com texto "${textoAlvo}"`);
    const sucesso = await contexto.evaluate((nome, texto) => {
        const select = document.querySelector(`select[name="${nome}"]`);
        if (!select) {
            console.warn(`   ⚠️ select[name=\"${nome}\"] não encontrado`);
            return false;
        }
        const opcao = Array.from(select.options).find(opt => opt.text.includes(texto));
        if (!opcao) {
            console.warn(`   ⚠️ opção contendo texto "${texto}" não encontrada no select`);
            return false;
        }
        select.value = opcao.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }, nomeSelect, textoAlvo);
    if (sucesso) {
        console.log(`   ✅ seleção realizada para "${nomeSelect}" = "${textoAlvo}"`);
    } else {
        console.log(`   ❌ falha na seleção para "${nomeSelect}" = "${textoAlvo}"`);
    }
}

/**
 * Injeta valores em campos bloqueados ou especiais, removendo atributos de bloqueio.
 * @param {Page|Frame} contexto - O contexto (página ou frame) onde os campos estão localizados.
 * @param {Object} seletores - Objeto com os nomes dos campos como chaves e os seletores como valores.
 * @param {Object} valores - Objeto com os nomes dos campos como chaves e os valores a serem injetados como valores.
 * @throws {Error} Se ocorrer um erro durante a injeção.
 */
// 4. Injeção de Valor em campos bloqueados/especiais
async function injetarValor(contexto, seletores, valores) {
    // seletores: { nome: 'txtNome', cpf: 'txtCPF' }
    // valores: { nome: 'João', cpf: '123' }
    try{
        await contexto.evaluate((sels, vals) => {
            // Exemplo genérico de injeção
            Object.keys(sels).forEach(chave => {
                const el = document.querySelector(`input[name="${sels[chave]}"]`);
                if (el) {
                    el.removeAttribute('readonly');
                    el.removeAttribute('disabled');
                    el.removeAttribute('onchange');
                    el.classList.remove('disabled');
                    el.value = vals[chave];
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            });
        }, seletores, valores);
    } catch (e) {
        console.error('Erro na injeção de valores:', e);
        throw e; // Para o script se for crucial
    }
}

/**
 * Busca o ID de um beneficiário usando um navegador auxiliar.
 * @param {Browser} browser - Instância do navegador Puppeteer.
 * @param {string} urlBase - URL base do site para consulta.
 * @param {string|number} docCru - Documento (CPF ou CNPJ) cru para busca.
 * @returns {Promise<string|null>} O ID do beneficiário encontrado ou null se não encontrado.
 */
// 5. Busca de ID em Aba Oculta (Browser Auxiliar)
async function buscarIdBeneficiario(browser, urlBase, docCru) {
    const docLimpo = String(docCru).replace(/\D/g, '');
    const tipo = docLimpo.length > 11 ? 'J' : 'F';
    // Formatação básica para a URL (Ajustar conforme o site)
    let docFormatado = docLimpo; 
    if(tipo === 'J') docFormatado = docLimpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    else docFormatado = docLimpo.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");

    const url = `${urlBase}/servlet/control?cmd=gov.goias.controle.corporativo.SelecionarPessoa&tPes=2&tipoPessoa=${tipo}&cpfCNPJ=${encodeURIComponent(docFormatado)}&nomePessoa=&op=Consultar`;
    
    const pageBusca = await browser.newPage();
    let id = null;
    try {
        await pageBusca.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        id = await pageBusca.evaluate(() => {
            const el = document.querySelector('input[name="idPessoa_1"]');
            return el ? el.value : null;
        });
    } catch (e) {
        console.error('Erro na busca background:', e);
    } finally {
        await pageBusca.close();
    }
    return id;
}

/**
 * Marca uma opção em radio button ou checkbox por valor.
 * @param {Frame} frame - O frame onde o campo está localizado.
 * @param {string} nomeCampo - O nome do campo (atributo name).
 * @param {string} valorAlvo - O valor da opção a ser marcada.
 * @throws {Error} Se a opção não for encontrada ou ocorrer erro ao marcar.
 */
// 6. Marcar opção (Radio ou Checkbox) por valor
async function marcarOpcao(frame, nomeCampo, valorAlvo) {
    // Seletor CSS preciso: Procura input com ESTE nome E ESTE valor
    const seletor = `input[name="${nomeCampo}"][value="${valorAlvo}"]`;
    try {
        // Verifica se o elemento existe
        const elemento = await frame.$(seletor);
        if (!elemento) {
            throw new Error(`Opção com valor "${valorAlvo}" não encontrada para o campo "${nomeCampo}".`);
        }
        // Verifica se já está marcado (checked)
        const isChecked = await frame.$eval(seletor, el => el.checked);
        if (!isChecked) { await elemento.click();} else {}
    } catch (error) {
        console.error(`      ❌ Erro ao marcar opção: ${error.message}`);
        throw error; // Para o script se for crucial
    }
}

/**
 * Força o preenchimento de um campo bloqueado, removendo atributos de bloqueio.
 * @param {Page|Frame} contexto - O contexto (página ou frame) onde o campo está localizado.
 * @param {string} nomeCampo - O nome do campo (atributo name).
 * @param {string|number} valor - O valor a ser preenchido no campo.
 */
async function forcarPreenchimentoBloqueado(contexto, nomeCampo, valor) {
    const valorStr = valor ? String(valor).trim() : '';
    if (!valorStr) return;

    try {
        await contexto.evaluate((nome, val) => {
            const el = document.querySelector(`input[name="${nome}"], textarea[name="${nome}"]`);
            if (el) {
                el.removeAttribute('readonly'); 
                el.removeAttribute('disabled'); 
                el.removeAttribute('onchange'); // Remove armadilhas de script
                el.classList.remove('disabled'); // Remove estilo visual
                
                // Injeta o valor
                el.value = val;
                
                // Acorda o sistema para validar o campo
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
            }
        }, nomeCampo, valorStr);
    } catch (e) {
        console.warn(`Aviso: Falha ao forçar campo ${nomeCampo}.`);
    }
}

/**
 * Verifica se um texto existe no conteúdo textual da página principal ou de frames.
 * @param {Page|Frame} contexto - O contexto (página ou frame) onde a busca será iniciada.
 * @param {string} textoAlvo - Texto exato ou parcial a ser localizado.
 * @returns {Promise<boolean>} Retorna true se o texto for encontrado; caso contrário, false.
 */
async function existeTextoNaPagina(contexto, textoAlvo) {
    const textoBusca = textoAlvo ? String(textoAlvo).trim() : '';
    if (!textoBusca) return false;

    const contextoContemTexto = async (alvo) => {
        return alvo.evaluate((texto) => {
            const conteudo = document.body?.innerText || document.body?.textContent || '';
            return conteudo.includes(texto);
        }, textoBusca);
    };

    try {
        if (await contextoContemTexto(contexto)) {
            return true;
        }
    } catch (e) {}

    if (typeof contexto.frames !== 'function') {
        return false;
    }

    for (const frame of contexto.frames()) {
        try {
            if (await contextoContemTexto(frame)) {
                return true;
            }
        } catch (e) {}
    }

    return false;
}

/**
 * Submete o formulário, faz o bypass das validações e captura a resposta do servidor via alerta.
 * @param {object} page - Instância da página principal (para escutar o Dialog).
 * @param {object} contexto - Instância do frame/contexto onde o formulário está renderizado.
 * @param {string} seletorBotao - Seletor do botão de confirmação.
 * @param {number} [timeout=15000] - Tempo máximo de espera pelo alerta em milissegundos.
 * @returns {Promise<string>} Mensagem retornada pelo servidor.
 */
async function submeterFormularioComValidacao(page, contexto, seletorBotao, timeout = 15000) {
    const capturaAlerta = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Tempo esgotado aguardando resposta do servidor (Alert).")), timeout);
        
        // Mantém escutando na 'page' principal
        page.once("dialog", async (dialog) => {
            clearTimeout(timer);
            const mensagem = dialog.message();
            await dialog.accept();
            resolve(mensagem);
        });
    });

    // Usa o 'contexto' (Frame) para injetar o Javascript
    await contexto.evaluate(() => {
        if (typeof window.verificarCampos === "function") {
            window.verificarCampos = () => true;
        }
        if (document.Navegacao && document.Navegacao.op) {
            document.Navegacao.op.value = "IncluirRegistro";
        }
    });

    // Usa o 'contexto' (Frame) para realizar o clique
    await contexto.click(seletorBotao);

    return await capturaAlerta;
}


// =============================================================================
// NOVO: Utilitários de Dialog Robusto
// =============================================================================
 
/**
 * Palavras-chave usadas para classificar semanticamente a mensagem de um dialog.
 * Ajuste as listas conforme o vocabulário real do seu sistema.
 */
const CLASSIFICACAO_DIALOG = {
    // Erros conhecidos da Fase 1 - Consulta
    DOCUMENTO_JA_CADASTRADO:  ['já está cadastrado no sistema', 'já cadastrado', 'já existe', 'duplicado', 'cadastrado anteriormente'],
    DIGITO_INVALIDO:          ['dígito', 'código de barras inválido', 'inválido', 'incorreto', 'não reconhecido', 'segundo digito informado'],
    // Erros conhecidos da Fase 2 - Preenchimento
    CAMPO_OBRIGATORIO:        ['obrigatório', 'preencha', 'informe', 'campo vazio', 'não informado'],
    BENEFICIARIO_INVALIDO:    ['beneficiário', 'pessoa não encontrada', 'cpf não encontrado', 'cnpj não encontrado'],
    // Respostas da Fase 3 - Confirmação
    SUCESSO_INCLUSAO:         ['sucesso', 'incluído', 'gravado', 'registrado', 'com sucesso', 'cadastrado com sucesso'],
    ERRO_SISTEMA:             ['erro', 'falha', 'não foi possível', 'tente novamente', 'sistema indisponível'],
};
 
/**
 * Classifica a mensagem de um dialog com base nas palavras-chave mapeadas.
 * @param {string} mensagem - Texto do dialog.
 * @returns {string} Categoria da mensagem (chave de CLASSIFICACAO_DIALOG) ou 'DESCONHECIDO'.
 */
function classificarMensagemDialog(mensagem) {
    const msgLower = (mensagem || '').toLowerCase();
    for (const [categoria, palavras] of Object.entries(CLASSIFICACAO_DIALOG)) {
        if (palavras.some(p => msgLower.includes(p))) {
            return categoria;
        }
    }
    return 'DESCONHECIDO';
}
 
/**
 * Executa uma ação que pode disparar um dialog (alert/confirm), aguardando-o de forma
 * segura e retornando a mensagem capturada.
 *
 * Resolve a race condition entre waitForNavigation e dialog: usa Promise.race para
 * aceitar o que vier primeiro — navegação ou dialog. Garante que o listener seja sempre
 * removido, mesmo em caso de erro.
 *
 * @param {Page} page          - Instância da página Puppeteer (onde o dialog dispara).
 * @param {Function} acao      - Função async que executa o clique ou submit.
 * @param {object}  [opcoes]
 * @param {boolean} [opcoes.aguardarNavegacao=true]  - Se true, também aguarda navegação.
 * @param {string}  [opcoes.waitUntil='domcontentloaded'] - Evento de navegação aguardado.
 * @param {number}  [opcoes.timeoutDialog=8000]  - Janela de tempo para capturar um dialog (ms).
 * @param {number}  [opcoes.timeoutNav=15000]    - Timeout da navegação (ms).
 * @returns {Promise<{navegou: boolean, mensagemDialog: string|null, categoriaDialog: string|null}>}
 */
async function executarComDialogGuardado(page, acao, opcoes = {}) {
    const {
        aguardarNavegacao   = true,
        waitUntil           = 'domcontentloaded',
        timeoutDialog       = 8000,
        timeoutNav          = 15000,
    } = opcoes;
 
    let mensagemDialog = null;
    let categoriaDialog = null;
    let navegou = false;
    let resolverDialog;
 
    // Promessa que resolve quando (e se) um dialog aparecer
    const promessaDialog = new Promise(resolve => { resolverDialog = resolve; });
 
    const listenerDialog = async (dlg) => {
        const msg = dlg.message();
        console.log(`      💬 Dialog capturado: "${msg}"`);
        await dlg.accept(); // Sempre aceita para destravar o browser
        resolverDialog(msg);
    };
 
    // Registra o listener UMA vez antes da ação
    page.on('dialog', listenerDialog);
 
    try {
        // Executa o clique/ação fornecida
        await acao();
 
        if (aguardarNavegacao) {
            // Race: o que vier primeiro — navegação ou dialog
            const promessaNav = page.waitForNavigation({ waitUntil, timeout: timeoutNav })
                .then(() => 'NAVEGOU')
                .catch(() => 'TIMEOUT_NAV');
 
            const promessaDialogComTimeout = Promise.race([
                promessaDialog.then(msg => ({ tipo: 'DIALOG', msg })),
                new Promise(resolve => setTimeout(() => resolve({ tipo: 'TIMEOUT_DIALOG' }), timeoutDialog)),
            ]);
 
            // Aguarda ambas as promessas simultaneamente
            const [resultadoNav, resultadoDialog] = await Promise.all([
                promessaNav,
                promessaDialogComTimeout,
            ]);
 
            navegou = resultadoNav === 'NAVEGOU';
 
            if (resultadoDialog.tipo === 'DIALOG') {
                mensagemDialog = resultadoDialog.msg;
                categoriaDialog = classificarMensagemDialog(mensagemDialog);
            }
        } else {
            // Sem navegação esperada: aguarda apenas o dialog por um curto período
            const resultado = await Promise.race([
                promessaDialog.then(msg => ({ tipo: 'DIALOG', msg })),
                new Promise(resolve => setTimeout(() => resolve({ tipo: 'TIMEOUT_DIALOG' }), timeoutDialog)),
            ]);
 
            if (resultado.tipo === 'DIALOG') {
                mensagemDialog = resultado.msg;
                categoriaDialog = classificarMensagemDialog(mensagemDialog);
            }
        }
    } finally {
        // Garante remoção do listener em qualquer cenário
        page.off('dialog', listenerDialog);
    }
 
    if (mensagemDialog) {
        console.log(`      🏷️  Categoria do dialog: ${categoriaDialog} | Mensagem: "${mensagemDialog}"`);
    }
 
    return { navegou, mensagemDialog, categoriaDialog };
}


module.exports = { 
    aguardarContextoDoCampo, 
    preencherTexto, 
    selecionarOpcaoPorTexto, 
    injetarValor,
    buscarIdBeneficiario,
    marcarOpcao,
    forcarPreenchimentoBloqueado,
    existeTextoNaPagina,
    submeterFormularioComValidacao,
    executarComDialogGuardado,
    classificarMensagemDialog
};
