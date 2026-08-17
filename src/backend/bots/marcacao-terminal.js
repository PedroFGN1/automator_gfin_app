const puppeteer = require('puppeteer');
const path = require('path');
const { dialog } = require('electron');

// Importação dos utilitários existentes
const fileUtils = require('../utils/file-utils');
const terminalUtils = require('../utils/terminal-utils');
const navUtils = require('../utils/navigation-utils');
const logger = require('../utils/logger');

// --- FUNÇÃO HELPER PARA DIALOG ---
async function exibirDialogContinuacao(mainWindow, params) {
    const { tipoMensagem, numLinha, idProcesso, ultimoErro, tentativaAtual, maxTentativas, tipoUsuarioTerminal } = params;

    // Restaura e foca a janela se estiver minimizada
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.focus();

    let message = '';
    let buttons = [];
    let defaultId = 0;

    if (tipoMensagem === 'primeira_tentativa') {
        message = `Pronto para processar linha ${numLinha} (Processo: ${idProcesso}).\n\nClique para seguir a próxima linha.`;
        buttons = ['Continuar'];
    } else if (tipoMensagem === 'erro') {
        message = `❌ Erro na linha ${numLinha} (Processo: ${idProcesso})\nTentativa ${tentativaAtual}/${maxTentativas}\n\nErro: ${ultimoErro}\n\nO que deseja fazer?`;
        buttons = ['Ver Instruções', 'Repetir linha', 'Pular para Próxima', 'Abortar Tudo'];
        defaultId = 0;
    }

    const resposta = await dialog.showMessageBox(mainWindow, {
        type: tipoMensagem === 'erro' ? 'error' : 'info',
        title: 'Automator GFIN - Confirmação Necessária',
        message: message,
        buttons: buttons,
        defaultId: defaultId,
        cancelId: 3 // Último botão (Abortar) é cancel
    });

    // Mapeia resposta para ação
    let acao = '';
    if (tipoMensagem === 'primeira_tentativa') {
        acao = 'continuar';
    } else {
        switch (resposta.response) {
            case 0: 
                acao = 'ver_instruções';
                // Envia evento para frontend abrir modal
                mainWindow.webContents.send('abrir-modal-instrucoes', { tipoUsuarioTerminal });
                break;
            case 1: acao = 'continuar'; break;
            case 2: acao = 'proxima'; break;
            case 3: acao = 'abortar'; break;
        }
    }

    return { acao, responseIndex: resposta.response };
}

// --- FUNÇÕES AUXILIARES DE TRATAMENTO ---

// Retorna data de hoje em formato DDMMAAAA (ex: 05102023)
const getDataHojeFormatada = () => {
    const hoje = new Date();
    const dia = String(hoje.getDate()).padStart(2, '0');
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const ano = hoje.getFullYear();
    return `${dia}${mes}${ano}`;
};

// Remove caracteres não numéricos (para valores e datas vindos do Excel)
const apenasNumeros = (valor) => {
    if (!valor) return '';
    return String(valor).replace(/\D/g, ''); // Remove tudo que não é dígito
};

// NOVA FUNÇÃO ESPECÍFICA PARA DATAS DO EXCEL
const tratarDataExcel = (valor) => {
    if (!valor) return '';

    // Cenário 1: O ExcelJS entregou um objeto Date real
    if (valor instanceof Date) {
        // CORREÇÃO: Usar getUTC... para evitar cair no dia anterior devido ao fuso (UTC-3)
        const dia = String(valor.getUTCDate()).padStart(2, '0');
        const mes = String(valor.getUTCMonth() + 1).padStart(2, '0');
        const ano = valor.getUTCFullYear();
        return `${dia}${mes}${ano}`;
    }

    // Cenário 2: Veio como Texto ou Número (ex: "01/01/2023 12:00")
    let apenasDigitos = String(valor).replace(/\D/g, '');
    
    // Se tiver mais de 8 dígitos (lixo de hora/minuto), corta para pegar só DDMMAAAA
    if (apenasDigitos.length > 8) {
        return apenasDigitos.slice(0, 8);
    }
    
    return apenasDigitos;
};

const TIPOS_USUARIO_TERMINAL_VALIDOS = ['efetivo', 'terceirizado'];

const resolverTipoUsuarioTerminal = (configPerfil, registrarAviso = null) => {
    const valorConfigurado = configPerfil?.configuracoes_fixas?.tipo_usuario_terminal;
    const tipoUsuario = String(valorConfigurado || 'efetivo').trim().toLowerCase();

    if (TIPOS_USUARIO_TERMINAL_VALIDOS.includes(tipoUsuario)) {
        return tipoUsuario;
    }

    if (typeof registrarAviso === 'function') {
        registrarAviso(`   ⚠️ tipo_usuario_terminal inválido (${valorConfigurado}). Assumindo "efetivo".`);
    }

    return 'efetivo';
};

const montarFluxoDinamico = (linha, configPerfil, tipoUsuarioTerminal = resolverTipoUsuarioTerminal(configPerfil)) => {
    const map = configPerfil.mapeamento_colunas;

    // 1. Tratamento e Extração de Dados
    const rawDataPag = linha[map.DATA_PAGAMENTO];
    const dataPagamento = tratarDataExcel(rawDataPag); // Remove as barras

    const rawValor = navUtils.formatarMoeda(linha[map.VALOR_RESTITUIDO]); // Formata de "1234,5" para "1.234,50"
    const valorRestituido = apenasNumeros(rawValor); // Remove pontos e vírgulas (1.200,50 -> 120050)

    const processo = linha[map.PROCESSO] || '';
    const processo_ano = navUtils.safeSlice(processo, 0, 4);
    const processo_final = navUtils.safeSlice(processo, -8); // Pega os últimos 8

    const data_deferimento = getDataHojeFormatada(); // Data atual DDMMAAAA

    const endnum = linha[map.END] || ''; // Endereço/Código
    const end = apenasNumeros(endnum)
    const seq = linha[map.SEQ] || ''; 
    const seqStr = String(seq);
    // Garante que tenha zeros à esquerda se vier como número do Excel (ex: 480 -> 00480)
    const seqPad = seqStr.padStart(5, '0'); 
    const seq1 = navUtils.safeSlice(seqPad, 0, 3);
    const seq2 = navUtils.safeSlice(seqPad, 3, 5);

    const f1 =  [
        'RECEITA',                  
        'SISTEMA DE ARRECADACAO',   
        'CORRECAO DE DOCUMENTOS',   
        'MARCA DOCUMENTO', // Etapa não existe para Terceirizados, o fluxo pula essa ação. TODO: Podemos colocar no configPerfil uma flag "usuario": {"efetivo": true, "terceirizado": false} para controle, será preciso definir como regra de configuração que apenas um deles pode ser true.

        { 
            acao: 'focado', 
            rotulo_menu: 'FRAUDE/RESTIT./CH. SEM FUNDO'
        },
        { acao: 'teclar', tecla: 'Enter' }, 

        { 
            acao: 'data', 
            rotulo: 'DATA DE PAGAMENTO:', 
            valor: dataPagamento // Vindo da Planilha
        },

        { acao:'menu', menu: 'RESTITUICAO', rotulo:'INDIQUE A CORRECAO', direcao:'direita'},

        { acao: 'teclar', tecla: 'Enter' },
        
        // --- PREENCHIMENTO POR ID (DADOS VARIÁVEIS) ---
        { 
            acao: 'escrever_id', 
            id: 'POS1003',
            valor: end
        },
        { 
            acao: 'escrever_id',
            id: 'POS1023', 
            valor: seq1
        },
        { 
            acao: 'escrever_id',
            id: 'POS1027', 
            valor: seq2
        },
        { acao:'teclar', tecla:'Enter'}
    ]

    if (tipoUsuarioTerminal === 'terceirizado') {
        f1.splice(3, 1);
    }

    const f2 = [
        { 
            acao: 'escrever_id', // CONFIRMAÇÃO 1
            id: 'POS390',
            valor: 'S'
        },

        { acao:'teclar', tecla:'Enter'},
    ]

    const f3 = [
        { 
            acao: 'escrever_id', // CONFIRMAÇÃO 2
            id: 'POS868',
            valor: 'S'
        },

        { acao:'teclar', tecla:'Enter'}
    ];

    const f4 = [
        { acao:'menu', menu: 'RESTITUICAO', rotulo:'SELECIONE O MOTIVO DA ALTERACAO', direcao:'direita'},
        { acao:'teclar', tecla:'Enter'},
        { 
            acao: 'escrever_id', // PRIMEIROS 4 DÍGITOS DO SEI
            id: 'POS924', 
            valor: processo_ano
        },
        { 
            acao: 'escrever_id', // ÚLTIMOS DÍGITOS DO SEI
            id: 'POS1084',
            valor: processo_final
        },
        { acao:'teclar', tecla:'Enter'},
        { 
            acao: 'escrever_id', // VALOR DA RESTITUIÇÃO SEM PONTO E NEM VÍRGULA (EX: 7.533,34 -> 753334)
            id:  linha[map.TIPO] === 'DARE' ? 'POS1168' 
                : linha[map.TIPO] === 'GNRE' ? 'POS928' // Para GNRE é POS928
                : 'POS1168', 
            valor: valorRestituido
        }, // 7-ATUALIZACAO MONETAR.:,
        { acao:'teclar', tecla:'Enter'},
        { 
            acao: 'escrever_id', // CONFIRMAÇÃO 
            id: 'POS1432',
            valor: 'S'
        },
        { acao:'teclar', tecla:'Enter'},
        { 
            acao: 'escrever_id', // DATA DO DEFERIMENTO, VALOR SEM '/' (EX: 06/02/2026 -> 06022026) 
            id: 'POS1592',
            valor: data_deferimento
        },
        { acao:'teclar', tecla:'Enter'},
        { 
            acao: 'escrever_id', // OPÇÃO DE RESTITUIÇÃO, EM GERAL SERÁ "ESPECIE" (2) 
            id: 'POS1249',
            valor: '2'
        }
    ];

    const f5 = [
        { acao:'teclar', tecla:'Enter'}, // CONFIRMAÇÃO FINAL
        { acao:'teclar', tecla:'Enter'}, // CONFIRMAÇÃO EXTRA 1
        { acao:'teclar', tecla:'Enter'}, // CONFIRMAÇÃO EXTRA 2
        { acao:'teclar', tecla:'F6'}   // RETORNAR AO MENU PRINCIPAL PARA SEGUIR NA PRIMERIA OPÇÃO DO LOOP
    ]
    return { f1: f1, f2: f2, f3: f3, f4: f4, f5: f5 };
};

const Iniciar = [
    { acao: 'teclar', tecla: 'Enter' },
    { acao: 'teclar', tecla: 'Enter' },
    { acao: 'teclar', tecla: 'Enter' }
];

// Função Principal exportada
async function executarMarcacaoTerminal(configPerfil, caminhoExcel, diretorioSaida, enviarLog, controle, mainWindow, sharedState) {
    
    // Helper para log duplo (Interface + Arquivo)
    const logTotal = (msg) => {
        enviarLog(msg); // Envia para o frontend
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`); // Salva no txt
    };

    logTotal('🚀 Inicializando Bot de Marcação Terminal...');
    let browser = null;
    const resultados = []; // Armazena o relatório final

    try {
        // 1. Preparar Pastas (Reutilizando file-utils)
        logTotal('📂 Preparando diretórios...');
        const diretorios = fileUtils.prepararDiretorios(diretorioSaida, configPerfil.nome);
        logTotal(`   ↳ Salvo em: ${diretorios.base}`);

        // 2. Ler Excel (Reutilizando file-utils com ExcelJS)
        logTotal(`📊 Lendo planilha: ${caminhoExcel}`);
        let dados = await fileUtils.lerExcelInput(caminhoExcel);
        logTotal(`  ⚠️ ${dados.length} linhas encontradas.`);
        const colunaMultiplo = configPerfil.mapeamento_colunas.MULTIPLO;

        // Verifica se a coluna existe no mapeamento e se há pelo menos uma linha com essa chave
        if (colunaMultiplo && dados.length > 0 && dados[0].hasOwnProperty(colunaMultiplo)) {
            // Filtramos os dados reescrevendo o array original
            dados = dados.filter(linha => {
                const isMultiplo = (linha[colunaMultiplo] || '').toString().trim().toUpperCase() === 'SIM';

                // Aplicamos a regra de descarte
                // Se isMultiplo for true (é 'SIM'), a exclamação (!) inverte para false, descartando a linha.
                // Se isMultiplo for false (não é 'SIM'), a exclamação (!) inverte para true, mantendo a linha.
                return !isMultiplo; 
            });
            logTotal(`   ✅ ${dados.length} linhas após a filtragem dos Múltiplos DAREs.`);
        }


        // Verifica e preenche a coluna TIPO com 'DARE' se não existir ou estiver vazia
        const colunaTipo = configPerfil.mapeamento_colunas.TIPO || 'Tipo';
        configPerfil.mapeamento_colunas.TIPO = colunaTipo; // Garante uma chave válida no mapeamento

        let adicionouTipoPadrao = false;
        dados.forEach(linha => {
            if (!linha[colunaTipo] || linha[colunaTipo].toString().trim() === '') {
                linha[colunaTipo] = 'DARE';
                adicionouTipoPadrao = true;
            }
        });

        if (adicionouTipoPadrao) {
            logTotal(`   ℹ️ Coluna '${colunaTipo}' (Tipo) ausente ou vazia. Assumindo 'DARE' como padrão.`);
        }

        // 3. Abrir Navegador
        logTotal('🌍 Abrindo navegador...');
        browser = await puppeteer.launch({ 
            headless: false, 
            defaultViewport: null, 
            args: ['--start-maximized'] 
        });
        const page = await browser.newPage();

        // 4. Login Manual (Padrão do projeto)
        logTotal('🔐 Acede ao portal para Login...');
        await page.goto(configPerfil.url_portal, { waitUntil: 'domcontentloaded' });
        
        const respostaUsuario = await dialog.showMessageBox({
            type: 'info',
            title: 'Aguardando Login',
            message: 'Faça o login e navegue até à tela do terminal.',
            detail: 'Quando estiver pronto para iniciar, clique abaixo.',
            buttons: ['Iniciar Processamento', 'Cancelar'],
            cancelId: 1
        });

        if (respostaUsuario.response === 1) throw new Error('Operação cancelada pelo utilizador.');

        logTotal('✅ Login confirmado. Iniciando ciclo...');

        const promessaNovaAba = terminalUtils.trocarParaNovaAba(browser, configPerfil.url_formulario_direto);
        const pageTerminal = await promessaNovaAba;
        console.log("Procurando frame do terminal na nova aba...");

        const tipoUsuarioTerminal = resolverTipoUsuarioTerminal(configPerfil, logTotal);
        logTotal(`ℹ️ Fluxo de usuário do terminal: ${tipoUsuarioTerminal}.`);

        await pageTerminal.waitForFunction(() => window.frames.length > 0);

        await terminalUtils.navegarNoTerminal(pageTerminal, Iniciar);

        // 5. Loop de Processamento
        for (let i = 0; i < dados.length; i++) {
            
            // --- VERIFICAÇÃO DE CANCELAMENTO ---
            if (controle && controle.abortar) {
                logTotal('⏹️ Processo abortado pelo utilizador.');
                break;
            }

            const linha = dados[i];
            const numLinha = i + 1;
            const idProcesso = linha[configPerfil.mapeamento_colunas.PROCESSO] || `Linha_${numLinha}`;
            const numeroDare = linha[configPerfil.mapeamento_colunas.DARE] || `Dare_${numLinha}`;
            
            // Estado de processamento para retry
            let estadoProcessamento = {
                linhaAtual: i,
                tentativaAtual: 1,
                ultimoErro: null,
                maxTentativas: configPerfil.configuracoes_fixas.tentativas_maximas || 3
            };
            
            let linhaProcessadaComSucesso = false;
            
            // Loop de retry para esta linha
            while (!linhaProcessadaComSucesso && estadoProcessamento.tentativaAtual <= estadoProcessamento.maxTentativas) {
                
                logTotal(`________________________________________`);
                logTotal(`⏯️  Preparando Linha ${numLinha}/${dados.length} - ID: ${idProcesso} (Tentativa ${estadoProcessamento.tentativaAtual}/${estadoProcessamento.maxTentativas})`);

                try {
                    // --- LÓGICA DE PAUSA ---
                    const tipoMensagem = estadoProcessamento.tentativaAtual === 1 ? 'primeira_tentativa' : 'erro';
                    
                    if (tipoMensagem === 'primeira_tentativa') {
                        logTotal('⏳ AGUARDANDO CONFIRMAÇÃO DO UTILIZADOR...');
                        logTotal('👉 Confirme na janela de diálogo para processar esta linha.');
                    } else {
                        logTotal(`⏳ ERRO ANTERIOR: ${estadoProcessamento.ultimoErro}`);
                        logTotal('👉 Escolha uma ação no dialog que apareceu.');
                    }
                    
                    // Chama dialog via função helper
                    const respostaDialog = await exibirDialogContinuacao(mainWindow, {
                        tipoMensagem: tipoMensagem,
                        numLinha: numLinha,
                        idProcesso: idProcesso,
                        ultimoErro: estadoProcessamento.ultimoErro,
                        tentativaAtual: estadoProcessamento.tentativaAtual,
                        maxTentativas: estadoProcessamento.maxTentativas,
                        tipoUsuarioTerminal
                    });
                    
                    if (respostaDialog.acao === 'abortar') {
                        logTotal('⏹️ Processo abortado pelo utilizador.');
                        logTotal('💾 Gerando relatórios parciais...');
                        await fileUtils.exportarRelatorios(diretorios.planilhas, resultados);
                        return { sucesso: false, erro: 'Abortado pelo usuário' }; // Precisamos sair do for e do while, mas continuar no try para gerar relatório final
                        
                    }
                    
                    if (respostaDialog.acao === 'proxima') {
                        logTotal(`⏭️ Pulando linha ${numLinha} por decisão do usuário.`);
                        break; // Sai do loop de retry, vai para próxima linha
                    }
                    
                    if (respostaDialog.acao === 'ver_instruções') {
                        // Aguardar confirmação do modal
                        logTotal('📖 Instruções solicitadas. Aguardando confirmação do usuário...');
                        sharedState.continuarSignal = false; // Reset
                        while (!sharedState.continuarSignal) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                            if (controle && controle.abortar) break;
                        }
                        if (controle && controle.abortar) break;
                        logTotal('✅ Instruções confirmadas. Continuando processamento...');
                        continue; // Volta ao início para mostrar dialog novamente
                    }

                    // Verifica novamente se não foi abortado durante a espera
                    if (controle && controle.abortar) break;

                    // =================================================================
                    // AQUI INICIA A AUTOMAÇÃO DA LINHA
                    // =================================================================
                    const fluxos = montarFluxoDinamico(linha, configPerfil, tipoUsuarioTerminal);
                    
                    // --- EXECUÇÃO ETAPA 1 ---
                    logTotal('   🔹 Executando Parte 1...');
                    await terminalUtils.navegarNoTerminal(pageTerminal, fluxos.f1);
                    
                    // --- EXECUÇÃO ETAPA 2 ---
                    logTotal('   🔹 Executando Parte 2...');
                    await terminalUtils.navegarNoTerminal(pageTerminal, fluxos.f2);

                    // --- EXECUÇÃO ETAPA 3 (COM RETRY INTELIGENTE) ---
                    logTotal('   🔹 Executando Parte 3...');
                    try {
                        await terminalUtils.navegarNoTerminal(pageTerminal, fluxos.f3);
                    } catch (erroF3) {
                        logTotal(`   ❌ ERRO CAPTURADO EM F3 (tentativa 1): ${erroF3.message}`);
                        logTotal('   ⏳ Tentando correção...');
                        
                        try {
                            logTotal('   🐛 [DEBUG] Enviando Enter de correção...');
                            await terminalUtils.navegarNoTerminal(pageTerminal, [{ acao: 'teclar', tecla: 'Enter' }]);
                            await navUtils.delay(1000);
                            
                            logTotal('   🐛 [DEBUG] Iniciando f3 (tentativa 2)...');
                            await terminalUtils.navegarNoTerminal(pageTerminal, fluxos.f3);
                            logTotal('   ✅ Correção bem sucedida!');
                        } catch (erroCorrecao) {
                            logTotal(`   ❌ Falha também na correção: ${erroCorrecao.message}`);
                            logTotal(`   📍 Stack: ${erroCorrecao.stack}`);
                            throw erroCorrecao;
                        }
                    }

                    // --- EXECUÇÃO ETAPA 4 ---
                    logTotal('   🔹 Executando Parte 4...');
                    await terminalUtils.navegarNoTerminal(pageTerminal, fluxos.f4);

                    const screenshotPath = path.join(diretorios.evidencias, `${idProcesso}_SUCESSO_${numeroDare}.png`);
                    await pageTerminal.screenshot({ path: screenshotPath, fullPage: true });

                    logTotal('   🔹 Executando Parte 5 (Final)...');
                    await terminalUtils.navegarNoTerminal(pageTerminal, fluxos.f5);

                    // =================================================================
                    // FIM DA AUTOMAÇÃO DA LINHA
                    // =================================================================

                    // Registo de Sucesso
                    logTotal(`   ✅ Sucesso Linha ${numLinha}`);
                    resultados.push({ 
                        status: 'SUCESSO', 
                        linha: numLinha, 
                        dados: linha, 
                        mensagem: 'Processado OK',
                        tentativas: estadoProcessamento.tentativaAtual
                    });
                    
                    linhaProcessadaComSucesso = true;

                } catch (erro) {
                    estadoProcessamento.ultimoErro = erro.message;
                    
                    logTotal(`   ❌ Erro na linha ${numLinha} (Tentativa ${estadoProcessamento.tentativaAtual}): ${erro.message}`);
                    
                    const screenshotPath = path.join(diretorios.evidencias, `${idProcesso}_ERRO_${numeroDare}_T${estadoProcessamento.tentativaAtual}.png`);
                    await pageTerminal.screenshot({ path: screenshotPath, fullPage: true }).catch(()=>{});
                    
                    estadoProcessamento.tentativaAtual++;
                    
                    // Se atingiu limite máximo, pula para próxima linha
                    if (estadoProcessamento.tentativaAtual > estadoProcessamento.maxTentativas) {
                        logTotal(`   ⏭️ Máximo de tentativas (${estadoProcessamento.maxTentativas}) atingido. Pulando para próxima linha.`);
                        resultados.push({ 
                            status: 'ERRO', 
                            linha: numLinha, 
                            dados: linha, 
                            mensagem: `Erro após ${estadoProcessamento.maxTentativas} tentativas: ${estadoProcessamento.ultimoErro}`,
                            tentativas: estadoProcessamento.maxTentativas
                        });
                        break; // Sai do loop de retry
                    }
                    
                    // Se não atingiu limite, continua no loop para nova tentativa
                }
            }
        }

        // 6. Gerar Relatórios Finais (ExcelJS)
        logTotal('💾 Gerando relatórios finais...');
        const resumo = await fileUtils.exportarRelatorios(diretorios.planilhas, resultados);

        logTotal('🏁 PROCESSO CONCLUÍDO!');
        logTotal(`   Sucessos: ${resumo.qtdSucesso} | Erros: ${resumo.qtdErro}`);
        logTotal(`   Arquivos salvos em: ${diretorios.base}`);

        return { sucesso: true, resumo };

    } catch (error) {
        logTotal(`❌ ERRO FATAL: ${error.message}`);
        return { sucesso: false, erro: error.message };
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = {
    executarMarcacaoTerminal,
    montarFluxoDinamico,
    resolverTipoUsuarioTerminal,
    exibirDialogContinuacao
};
