//const information = document.getElementById('info')
//information.innerText = `This app is using Chrome (v${window.versions.chrome()}), Node.js (v${window.versions.node()}), and Electron (v${window.versions.electron()})`
/*
document.getElementById('toggle-dark-mode').addEventListener('click', async () => {
  const isDarkMode = await window.darkMode.toggle()
  document.getElementById('theme-source').innerHTML = isDarkMode ? 'Dark' : 'Light'
})

document.getElementById('reset-to-system').addEventListener('click', async () => {
  await window.darkMode.system()
  document.getElementById('theme-source').innerHTML = 'System'
})
*/
//const logger = require('./logger');

async function resultado() {
    await window.api.iniciarBot({ 
    perfilId: 'restituicao-fianca', 
    caminhoArquivo: 'C:/caminho/do/excel.xlsx' 
});}

// Elementos da Interface
const btnArquivo = document.getElementById('btnArquivo');
const labelArquivo = document.getElementById('labelArquivo');
const btnIniciar = document.getElementById('btnIniciar');
const btnParar = document.getElementById('btnParar');
const selectPerfil = document.getElementById('selectPerfil');
const logArea = document.getElementById('logArea');
const statusTexto = document.getElementById('statusTexto');
const btnLimparLog = document.getElementById('btnLimparLog');
const btnContinuar = document.getElementById('btnContinuar');
const labelTipoArquivo = document.getElementById('labelTipoArquivo');

let caminhoArquivoSelecionado = null;

// Função auxiliar para transformar caminhos Windows em links clicáveis
function formatarMensagemComLinks(mensagem) {
    if (typeof mensagem !== 'string') return mensagem;

    // Pattern para caminhos absolutos do Windows (ex: C:\... ou C:/...)
    const regexPath = /([a-zA-Z]:[\\/][^:*?"<>|\r\n\t]+)/g;

    const mensagemEscapada = escaparHTML(mensagem);

    return mensagemEscapada.replace(regexPath, (match) => {
        let caminho = match;
        let pontuacaoFinal = '';

        // Trata pontuação final isolada (ex: Ponto final ao término de frase)
        const matchPontuacao = caminho.match(/([.,;!?:)]+)$/);
        if (matchPontuacao) {
            const extRegex = /\.(pdf|xlsx|xlsm|xls|csv|txt|png|jpg|jpeg|json|log|xml)$/i;
            if (!extRegex.test(caminho)) {
                pontuacaoFinal = matchPontuacao[1];
                caminho = caminho.slice(0, -pontuacaoFinal.length);
            }
        }

        const linkHtml = `<a class="link link-info underline font-semibold cursor-pointer data-path-link hover:text-primary transition-colors" data-path="${caminho}" title="Clique para abrir ${caminho}">${caminho}</a>`;
        return linkHtml + pontuacaoFinal;
    });
}

// Função para adicionar linha ao log visual
function adicionarLog(mensagem) {
    const div = document.createElement('div');
    
    // Estilização baseada no conteúdo da mensagem para facilitar leitura
    if (mensagem.includes('❌') || mensagem.includes('Erro')) {
        div.className = 'text-error font-bold bg-error/10 p-1 rounded';
    } else if (mensagem.includes('✅') || mensagem.includes('Sucesso')) {
        div.className = 'text-success font-bold';
    } else if (mensagem.includes('⚠️')) {
        div.className = 'text-warning';
    } else if (mensagem.includes('▶️')) {
        div.className = 'text-info border-t border-gray-700 pt-2 mt-2';
    } else {
        div.className = 'text-gray-300'; // Padrão
    }

    // Adiciona timestamp e texto com links
    const hora = new Date().toLocaleTimeString();
    const mensagemComLinks = formatarMensagemComLinks(String(mensagem));
    div.innerHTML = `[${hora}] ${mensagemComLinks}`;
    
    logArea.appendChild(div);
    
    // Auto-scroll para o final
    logArea.scrollTop = logArea.scrollHeight;
}

// Escutador de cliques para abrir caminhos de arquivos do terminal no sistema operacional
logArea.addEventListener('click', async (event) => {
    const linkEl = event.target.closest('.data-path-link');
    if (linkEl && linkEl.dataset.path) {
        event.preventDefault();
        const caminho = linkEl.dataset.path;
        const res = await window.api.abrirCaminho(caminho);
        if (!res || !res.sucesso) {
            adicionarLog(`⚠️ Não foi possível abrir o arquivo: ${res?.erro || 'Caminho não encontrado ou inacessível.'}`);
        }
    }
});

function isPerfilEntradaPdf() {
    return selectPerfil.value === 'consultar-cnd' || selectPerfil.value === 'analise-honorarios-periciais' || selectPerfil.value === 'analise-restituicoes';
}

function descreverArquivoSelecionado(caminho) {
    if (Array.isArray(caminho)) {
        return caminho.length === 1 ? caminho[0] : `${caminho.length} PDFs selecionados`;
    }
    return caminho;
}

function atualizarTipoArquivo() {
    caminhoArquivoSelecionado = null;
    btnIniciar.disabled = true;
    btnIniciar.classList.add('btn-disabled');
    labelArquivo.innerText = 'Nenhum arquivo selecionado';
    labelArquivo.classList.remove('text-success');
    labelArquivo.classList.add('text-warning');
    labelTipoArquivo.innerText = isPerfilEntradaPdf()
        ? 'PDFs de entrada (.pdf)'
        : 'Planilha de Dados (.xlsx)';
}

// --- EVENTOS ---

btnArquivo.addEventListener('click', async () => {
    // Chama o backend via preload
    const caminho = await window.api.selecionarArquivo(selectPerfil.value);
    
    if (caminho && (!Array.isArray(caminho) || caminho.length > 0)) {
        caminhoArquivoSelecionado = caminho;
        labelArquivo.innerText = descreverArquivoSelecionado(caminho); // Mostra o caminho na tela
        labelArquivo.classList.remove('text-warning');
        labelArquivo.classList.add('text-success');
        
        // Habilita o botão iniciar
        btnIniciar.disabled = false;
        btnIniciar.classList.remove('btn-disabled');
        
        adicionarLog(`📂 Arquivo selecionado: ${descreverArquivoSelecionado(caminho)}`);
    }
});

selectPerfil.addEventListener('change', atualizarTipoArquivo);

btnIniciar.addEventListener('click', async () => {
    if (!caminhoArquivoSelecionado) return;

    const perfilId = selectPerfil.value;
    
    // Trava a interface para evitar duplo clique
    btnIniciar.disabled = true;
    btnArquivo.disabled = true;
    btnParar.disabled = false; // Habilita o parar
    statusTexto.innerText = "Executando...";
    statusTexto.className = "stat-value text-2xl text-warning animate-pulse";
    
    adicionarLog(`🚀 Solicitando início do bot para perfil: ${perfilId}...`);

    // Chama o Robô no Backend
    const resultado = await window.api.iniciarBot({
        perfilId: perfilId,
        caminhoArquivo: caminhoArquivoSelecionado
    });

    // Quando o robô termina (ou dá erro fatal que encerra o processo)
    if (resultado.sucesso) {
        statusTexto.innerText = "Concluído";
        statusTexto.className = "stat-value text-2xl text-success";
        adicionarLog("🏁 Processo finalizado com sucesso. Verifique a pasta de saída.");
    } else {
        statusTexto.innerText = "Erro";
        statusTexto.className = "stat-value text-2xl text-error";
        adicionarLog(`❌ Ocorreu um erro: ${resultado.erro}`);
    }

    // Destrava a interface
    btnIniciar.disabled = false;
    btnArquivo.disabled = false;
    btnParar.disabled = true; // Desabilita o parar
    btnContinuar.classList.add('hidden');
});

btnParar.addEventListener('click', async () => {
    adicionarLog('⚠️ Enviando sinal de parada...');
    await window.api.pararBot();
    btnParar.disabled = true; // Evita cliques múltiplos
});

btnLimparLog.addEventListener('click', () => {
    logArea.innerHTML = ''; // Limpa visualmente
    adicionarLog('🧹 Terminal limpo pelo usuário.');
});

// --- SISTEMA DE CONFIGURAÇÃO (Modal) ---
const btnConfig = document.getElementById('btnConfig');
const modalConfig = document.getElementById('modalConfig');
const containerForm = document.getElementById('containerFormConfig'); // Novo ID
const btnSalvarConfig = document.getElementById('btnSalvarConfig');
const btnFecharConfig = document.getElementById('btnFecharConfig');

let configAtual = null; // Armazena o JSON original em memória

// LISTA DE CAMPOS QUE O USUÁRIO NÃO PODE EDITAR
const CHAVES_BLOQUEADAS = [];

// Função auxiliar para escapar entidades HTML e caracteres especiais
function escaparHTML(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Função auxiliar para criar inputs HTML
function criarInput(label, valor, caminhoChave, tipo = 'text', bloqueado = false) {
    // Se estiver bloqueado, adiciona estilo visual e atributo disabled
    const disabledAttr = bloqueado ? 'disabled' : '';
    const labelIcon = bloqueado ? '🔒 ' : '';
    const inputClass = bloqueado ? 'input-ghost text-gray-500' : 'input-bordered focus:input-primary';
    const pathArray = Array.isArray(caminhoChave) ? caminhoChave : [caminhoChave];
    const pathJson = JSON.stringify(pathArray);
    const titleText = pathArray.join('.');

    return `
        <div class="form-control w-full min-w-50">
            <label class="label pb-1">
                <span class="label-text font-semibold text-gray-400 text-xs uppercase" title="${escaparHTML(titleText)}">
                    ${labelIcon}${label}
                </span>
            </label>
            <input type="${tipo}" 
                   class="input ${inputClass} input-sm w-full data-config-input" 
                   data-path="${escaparHTML(pathJson)}"
                   value="${valor !== null && valor !== undefined ? escaparHTML(String(valor)) : ''}" 
                   ${disabledAttr} />
        </div>
    `;
}

function renderizarValorRecursivo(chave, valor, caminhoAtual) {
    const pathArray = Array.isArray(caminhoAtual) ? caminhoAtual : [caminhoAtual];
    
    // Se for um Objeto (ex: conta_debito, guia_fianca), cria um Grupo Visual
    if (typeof valor === 'object' && valor !== null && !Array.isArray(valor)) {
        let htmlGrupo = `
            <div class="col-span-full bg-base-300 p-3 rounded-md border border-base-content/10 mt-2">
                <div class="badge badge-neutral mb-2 font-bold">${escaparHTML(chave)}</div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        `;
        
        // Itera sobre os filhos (banco, agencia, conta ou chaves com ponto)
        Object.keys(valor).forEach(subChave => {
            htmlGrupo += renderizarValorRecursivo(subChave, valor[subChave], [...pathArray, subChave]);
        });

        htmlGrupo += `</div></div>`;
        return htmlGrupo;
    } 
    // Se for texto/numero normal, cria o Input
    else {
        const estaBloqueado = CHAVES_BLOQUEADAS.includes(chave);
        return criarInput(chave, valor, pathArray, 'text', estaBloqueado);
    }
}

// 1. GERADOR DE FORMULÁRIO (Renderizador)
function renderizarFormulario(json) {
    let html = '';

    // A. Configurações Globais
    html += `<div class="bg-base-200 p-4 rounded-lg shadow-sm mb-4">
                <h4 class="text-lg font-bold text-secondary mb-2">📂 Caminhos Padrão</h4>
                ${criarInput('Diretório de Saída', json.diretorio_saida_padrao, ['diretorio_saida_padrao'])}
             </div>`;

    // B. Perfis
    if (json.perfis && Array.isArray(json.perfis)) {
        json.perfis.forEach((perfil, index) => {
            const pPath = ['perfis', index];
            
            html += `
            <div class="collapse collapse-arrow bg-base-200 rounded-lg shadow-sm border border-base-300 mb-2">
                <input type="checkbox" /> 
                <div class="collapse-title text-xl font-medium text-accent flex items-center gap-2">
                    🤖 Perfil: ${perfil.nome || 'Sem Nome'}
                </div>
                <div class="collapse-content space-y-4 pt-4">
                    
                    <div class="grid grid-cols-1 gap-4">
                        ${criarInput('URL Portal', perfil.url_portal, [...pPath, 'url_portal'], 'text', true)}
                        ${criarInput('URL Formulário', perfil.url_formulario_direto, [...pPath, 'url_formulario_direto'], 'text', true)}
                    </div>

                    <div class="divider text-xs font-bold text-base-content/50">MAPEAMENTO / EXTRACAO</div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        ${Object.keys(perfil.mapeamento_colunas || {}).map(key => 
                            renderizarValorRecursivo(key, perfil.mapeamento_colunas[key], [...pPath, 'mapeamento_colunas', key])
                        ).join('')}
                    </div>

                    <div class="divider text-xs font-bold text-base-content/50">CONFIGURAÇÕES FIXAS</div>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
                        ${Object.keys(perfil.configuracoes_fixas || {}).map(key => 
                            renderizarValorRecursivo(key, perfil.configuracoes_fixas[key], [...pPath, 'configuracoes_fixas', key])
                        ).join('')}
                    </div>
                </div>
            </div>`;
        });
    }

    containerForm.innerHTML = html;
}

// 2. COLETOR DE DADOS (Parser)
function reconstruirJsonApartirDoForm() {
    // Clona o objeto original para manter a estrutura
    const novoJson = JSON.parse(JSON.stringify(configAtual));
    const inputs = document.querySelectorAll('.data-config-input');

    const obterValorOriginal = (pathArray) => {
        let obj = configAtual;
        for (const part of pathArray) {
            if (obj === null || obj === undefined) return undefined;
            obj = obj[part];
        }
        return obj;
    };

    inputs.forEach(input => {
        let pathArray;
        try {
            pathArray = JSON.parse(input.dataset.path);
        } catch (e) {
            const rawPath = input.dataset.path;
            pathArray = rawPath.replace(/]/g, '').split(/[.[]/);
        }

        const valorOriginal = obterValorOriginal(pathArray);
        let valor = input.value;
        if (Array.isArray(valorOriginal)) {
            valor = valor
                .split(/[;,]/)
                .map(item => item.trim())
                .filter(Boolean);
        } else if (typeof valorOriginal === 'number') {
            if (valor === '') {
                valor = null;
            } else {
                const numero = Number(valor);
                if (isNaN(numero)) {
                    const nomeCampo = Array.isArray(pathArray) ? pathArray.join('.') : pathArray;
                    throw new Error(`O campo "${nomeCampo}" deve conter um número válido.`);
                }
                valor = numero;
            }
        } else if (typeof valorOriginal === 'boolean') {
            if (typeof valor === 'string') {
                valor = valor.trim().toLowerCase() === 'true';
            } else {
                valor = Boolean(valor);
            }
        } else if (typeof valor === 'string' && (valorOriginal === 'true' || valorOriginal === 'false' || pathArray[pathArray.length - 1] === 'habilitar_paginacao')) {
            if (valor.trim().toLowerCase() === 'true') {
                valor = true;
            } else if (valor.trim().toLowerCase() === 'false') {
                valor = false;
            }
        }

        // Função mágica para setar valor em objeto aninhado usando array de chaves
        let obj = novoJson;
        for (let i = 0; i < pathArray.length - 1; i++) {
            obj = obj[pathArray[i]];
        }
        obj[pathArray[pathArray.length - 1]] = valor;
    });

    return novoJson;
}

// --- EVENTOS DO MODAL ---
// Abrir Modal
btnConfig.addEventListener('click', async () => {
    const jsonString = await window.api.lerConfig();
    try {
        configAtual = JSON.parse(jsonString);
        renderizarFormulario(configAtual);
        modalConfig.showModal();
    } catch (e) {
        alert('Erro ao ler configuração: ' + e.message);
    }
});

// Fechar Modal
btnFecharConfig.addEventListener('click', () => {
    modalConfig.close();
});

// Salvar Config
btnSalvarConfig.addEventListener('click', async () => {
    try {
        const novoObjeto = reconstruirJsonApartirDoForm();
        const jsonStringBonita = JSON.stringify(novoObjeto, null, 2); // Formata com indentação
        
        const resultado = await window.api.salvarConfig(jsonStringBonita);
        
        if (resultado.sucesso) {
            // Feedback visual bonito (Toast do DaisyUI se tiver, ou alert)
            const originalText = btnSalvarConfig.innerHTML;
            btnSalvarConfig.innerHTML = '✅ Salvo!';
            btnSalvarConfig.classList.replace('btn-success', 'btn-primary');
            
            setTimeout(() => {
                modalConfig.close();
                btnSalvarConfig.innerHTML = originalText;
                btnSalvarConfig.classList.replace('btn-primary', 'btn-success');
                adicionarLog('⚙️ Configurações atualizadas via interface visual.');
            }, 1000);
        } else {
            alert('Erro ao salvar: ' + resultado.erro);
        }
    } catch (e) {
        alert('Erro ao processar formulário: ' + e.message);
    }
});



btnContinuar.addEventListener('click', () => {
    window.api.continuarExecucao(); // Chama a função nova do preload
    btnContinuar.classList.add('hidden'); // Esconde o botão imediatamente
    adicionarLog('✅ Comando de continuar enviado pelo usuário.');
});

window.api.onLog((msg) => {
    adicionarLog(msg); // Mantém o log visual normal

    // Lógica de Gatilho: Se a mensagem contiver a palavra-chave do robô
    if (msg.includes('Clique em "Continuar"')) {
        btnContinuar.classList.remove('hidden'); // Mostra o botão
        // Opcional: Tocar um som ou focar a janela
    }
});

// --- MODAL DE INSTRUÇÕES ---
const modalInstrucoes = document.getElementById('modalInstrucoesErro');
const btnFecharInstrucoes = document.getElementById('btnFecharInstrucoes');
const btnConfirmarInstrucoes = document.getElementById('btnConfirmarInstrucoes');
const terminalInstructionImage = document.getElementById('terminalInstructionImage');
const TERMINAL_INSTRUCTION_IMAGES = {
    efetivo: {
        src: '../../img/tela_inicial_terminal_efetivo.png',
        alt: 'Tela de exemplo do terminal para usuário efetivo'
    },
    terceirizado: {
        src: '../../img/tela_inicial_terminal_terceirizado.jpeg',
        alt: 'Tela de exemplo do terminal para usuário terceirizado'
    }
};

function resolverTipoUsuarioModal(payload) {
    const tipoUsuario = String(payload?.tipoUsuarioTerminal || 'efetivo').trim().toLowerCase();
    return TERMINAL_INSTRUCTION_IMAGES[tipoUsuario] ? tipoUsuario : 'efetivo';
}

function atualizarImagemModalInstrucoes(payload) {
    if (!terminalInstructionImage) return;

    const tipoUsuario = resolverTipoUsuarioModal(payload);
    const imageConfig = TERMINAL_INSTRUCTION_IMAGES[tipoUsuario];

    terminalInstructionImage.src = imageConfig.src;
    terminalInstructionImage.alt = imageConfig.alt;
}

// Ouvinte para abrir modal de instruções
window.api.onAbrirModalInstrucoes((payload) => {
    atualizarImagemModalInstrucoes(payload);
    modalInstrucoes.showModal();
    adicionarLog('📖 Modal de instruções aberto. Leia atentamente antes de continuar.');
});

// Fechar modal
btnFecharInstrucoes.addEventListener('click', () => {
    modalInstrucoes.close();
    adicionarLog('📖 Modal fechado pelo usuário. Retornando às opções...');
    window.api.continuarExecucao();
});

// Confirmar e continuar
btnConfirmarInstrucoes.addEventListener('click', () => {
    modalInstrucoes.close();
    adicionarLog('✅ Instruções confirmadas. Enviando sinal de continuar...');
    // Enviar sinal para backend continuar
    window.api.continuarExecucao();
});

document.addEventListener('DOMContentLoaded', () => {
    const toggleImageLink = document.getElementById('toggleImage');
    const imageContainer = document.getElementById('imageContainer');

    atualizarTipoArquivo();
    atualizarImagemModalInstrucoes();

    if (toggleImageLink && imageContainer) {
        toggleImageLink.addEventListener('click', (e) => {
            e.preventDefault();
            imageContainer.classList.toggle('hidden');
        });
    }
});
