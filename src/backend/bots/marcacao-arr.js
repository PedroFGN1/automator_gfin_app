const puppeteer = require('puppeteer');
const path = require('path');
const fileUtils = require('../utils/file-utils');
const navUtils = require('../utils/navigation-utils');
const arrUtils = require('../utils/arr-utils');
const logger = require('../utils/logger');
const { dialog } = require('electron');

// Função Principal exportada para o Electron
async function executarMarcacaoARR(configPerfil, caminhoExcel, diretorioSaida, enviarLog, controle) {
    // enviarLog: função callback para mandar mensagens para a tela (frontend)

    // Helper para logar na tela E no arquivo txt ao mesmo tempo
    const logTotal = (msg) => {
        enviarLog(msg);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`);
    };

    logTotal('🚀 Inicializando Bot de Restituição de Fiança...');
    let browser = null;
    const resultados = []; // Armazena status de cada linha para o relatório final

    try {
        // 1. Preparar Pastas
        logTotal('📂 Preparando diretórios de evidências...');
        const diretorios = fileUtils.prepararDiretorios(diretorioSaida, configPerfil.nome);
        logTotal(`   ↳ Salvo em: ${diretorios.base}`);

        // 2. Ler Excel (Usando exceljs)
        logTotal(`📊 Lendo planilha: ${caminhoExcel}`);
        let dados = await fileUtils.lerExcelInput(caminhoExcel);
        logTotal(`  ⚠️ ${dados.length} linhas encontradas.`);
        const colunaMultiplo = configPerfil.mapeamento_colunas.MULTIPLO;
        
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
        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();

        logTotal('🔐 Acedendo ao portal para Login...');
        await page.goto(configPerfil.url_portal, { waitUntil: 'domcontentloaded' });
        
        logTotal('⚠️  AÇÃO NECESSÁRIA: Faça o Login manualmente no navegador.');
        logTotal('👉 O robô aguarda você estar na tela do SIOFI. ⚠️  Aguardando confirmação do usuário...');

        const respostaUsuario = await dialog.showMessageBox({
            type: 'info',
            title: 'Aguardando Login',
            message: 'Ação Necessária:',
            detail: '1. Faça o login no portal.\n2. Clique em "Iniciar Processamento" abaixo para soltar o robô.',
            buttons: ['Iniciar Processamento', 'Cancelar'],
            defaultId: 0,
            cancelId: 1
        });
        
        // Se o usuário clicar em Cancelar
        if (respostaUsuario.response === 1) {
            throw new Error('Operação cancelada pelo usuário durante o login.');
        }

        logTotal('✅ Confirmação recebida! Iniciando automação...');

        for (let i = 0; i < dados.length; i++) {
            // --- VERIFICAÇÃO DE PARADA ---
            if (controle && controle.abortar) {
                logTotal('⏹️  Processo interrompido pelo usuário.');
                break; // Sai do loop for
            }

            const linha = dados[i];
            const numLinha = i + 1;
            const numeroDare = linha[configPerfil.mapeamento_colunas.DARE]
            const processoSEI = linha[configPerfil.mapeamento_colunas.PROCESSO]

            logTotal(`👉 Processando item ${numLinha}/${dados.length}: DARE ${linha[configPerfil.mapeamento_colunas.DARE]}`);

            try {
                await page.goto(configPerfil.url_formulario_direto, { waitUntil: 'domcontentloaded' });
                
                await arrUtils.garantirPaginaCarregada(page, configPerfil);

                logTotal('   ✍️  Preenchendo formulário...');
                await arrUtils.preencherFormularioConsulta(page, configPerfil, linha);

                logTotal('   🔍 Pesquisando...');
                await arrUtils.clicarPesquisar(page, configPerfil);

                const resultadoTabela = await arrUtils.processarTabelaResultados(page, numeroDare, configPerfil, logTotal);
                
                if (resultadoTabela) {
                    const modalPreenchido = await arrUtils.preencherModalRestituicao(page, configPerfil, linha);
                    
                    if (modalPreenchido) {
                        try {
                            const screenshotPath = path.join(diretorios.evidencias, `${processoSEI}_SUCESSO_${numeroDare}.png`);
                            await page.screenshot({ path: screenshotPath, fullPage: true });

                            await new Promise(r => setTimeout(r, 1000));
                            if (linha[configPerfil.mapeamento_colunas.TIPO] === "DARE") {
                                await arrUtils.extrairComprovanteNativo(browser, diretorios.evidencias, numeroDare, processoSEI, configPerfil);
                            } else if (linha[configPerfil.mapeamento_colunas.TIPO] === "GNRE") {
                                logTotal(`   ⚠️  PDF para GNRE não disponível no ARR. Salvando print da tela atual como evidência.`);
                            } else {
                                logTotal(`   ⚠️  Tipo desconhecido (${linha[configPerfil.mapeamento_colunas.TIPO]}). Salvando print da tela atual como evidência.`);
                            }
                        } catch (e) {
                            logTotal(`Erro no print ${e}`)
                        }
                    } else {
                        logTotal('   ⚠️ Modal de restituição não preenchido ou ação não realizada.');
                        throw new Error('Modal de restituição não preenchido ou ação não realizada.');
                    }

                    logTotal(`✅ Sucesso Linha ${numLinha} - SEI: ${processoSEI} - ${linha[configPerfil.mapeamento_colunas.TIPO]}: ${numeroDare}`);
                } else {
                    logTotal(`   ⚠️ ${linha[configPerfil.mapeamento_colunas.TIPO]} não encontrado ou ação não realizada.`);
                    throw new Error(`${linha[configPerfil.mapeamento_colunas.TIPO]} não encontrado ou ação não realizada.`);
                }

                // Registra Sucesso
                resultados.push({ status: 'SUCESSO',  linha: numLinha, dados: linha, mensagem: 'Processado com sucesso', numeroOP: '' });
                logTotal(`   ✅ Sucesso!`);

            } catch (erroLinha) {
                logTotal(`   ❌ Erro na linha ${numLinha} - SEI: ${processoSEI} - ${linha[configPerfil.mapeamento_colunas.TIPO]}: ${numeroDare}: ${erroLinha.message}`);
                
                const screenshotPath = path.join(diretorios.evidencias, `${processoSEI}_ERRO_${numeroDare}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true }).catch(()=>{});

                resultados.push({ status: 'ERRO', linha: numLinha, dados: linha, mensagem: erroLinha.message, numeroOP: '' });
            
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        // 6. Finalização e Relatórios
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

module.exports = { executarMarcacaoARR };
