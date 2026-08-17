const puppeteer = require('puppeteer');
const path = require('path');
const fileUtils = require('../utils/file-utils');
const pptUtils = require('../utils/puppeteer-utils');
const navUtils = require('../utils/navigation-utils');
const logger = require('../utils/logger');
const { dialog } = require('electron');

// Função Principal exportada para o Electron
async function executarCadastroBeneficiario(configPerfil, caminhoExcel, diretorioSaida, enviarLog, controle) {
    // enviarLog: função callback para mandar mensagens para a tela (frontend)

    // Helper para logar na tela E no arquivo txt ao mesmo tempo
    const logTotal = (msg) => {
        enviarLog(msg);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`);
    };

    logTotal('🚀 Inicializando Bot de Cadastro de Beneficiário...');
    let browser = null;
    const resultados = []; // Armazena status de cada linha para o relatório final

    try {
        // 1. Preparar Pastas
        logTotal('📂 Preparando diretórios de evidências...');
        const diretorios = fileUtils.prepararDiretorios(diretorioSaida, configPerfil.nome);
        logTotal(`   ↳ Salvo em: ${diretorios.base}`);

        // 2. Ler Excel (Usando exceljs)
        logTotal(`📊 Lendo planilha: ${caminhoExcel}`);
        const dados = await fileUtils.lerExcelInput(caminhoExcel);
        logTotal(`   ✅ ${dados.length} linhas encontradas.`);

        // 3. Abrir Navegador
        logTotal('🌍 Abrindo navegador...');
        browser = await puppeteer.launch({ 
            headless: false, 
            defaultViewport: null, 
            args: ['--start-maximized'] 
        });
        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();

        // 4. Login Manual (Handshake)
        logTotal('🔐 Acedendo ao portal para Login...');
        await page.goto(configPerfil.url_portal, { waitUntil: 'domcontentloaded' });
        
        logTotal('⚠️  AÇÃO NECESSÁRIA: Faça o Login manualmente no navegador.');
        logTotal('👉 O robô aguarda você estar na tela do SIOFI. ⚠️  Aguardando confirmação do usuário...');

        const respostaUsuario = await dialog.showMessageBox({
            type: 'info',
            title: 'Aguardando Login',
            message: 'Ação Necessária:',
            detail: '1. Faça o login no portal.\n2. Navegue até chegar na tela inicial correta.\n3. Clique em "Iniciar Processamento" abaixo para soltar o robô.',
            buttons: ['Iniciar Processamento', 'Cancelar'],
            defaultId: 0,
            cancelId: 1
        });
        
        // Se o usuário clicar em Cancelar
        if (respostaUsuario.response === 1) {
            throw new Error('Operação cancelada pelo usuário durante o login.');
        }

        logTotal('✅ Confirmação recebida! Iniciando automação...');

        // 5. Loop Stateless
        for (let i = 0; i < dados.length; i++) {
            // --- VERIFICAÇÃO DE PARADA ---
            if (controle && controle.abortar) {
                logTotal('⏹️  Processo interrompido pelo usuário.');
                break; // Sai do loop for
            }

            const linha = dados[i];
            const numLinha = i + 1;
            const idProcesso = linha[configPerfil.mapeamento_colunas.PROCESSO] || `Linha_${numLinha}`;
            
            logTotal(`▶️  Processando ${numLinha}/${dados.length} - Processo: ${idProcesso}`);

            try {
                const { pessoa_juridica, pessoa_fisica, ...configfix } = configPerfil.configuracoes_fixas;
                const tipoBeneficiario = linha[configPerfil.mapeamento_colunas.TIPO_BENEFICIARIO];
                const htmlNames = tipoBeneficiario === "CNPJ" ? pessoa_juridica : tipoBeneficiario === "CPF" ? pessoa_fisica : null;
                if (!htmlNames) throw new Error(`Tipo de beneficiário inválido na linha ${numLinha}: ${tipoBeneficiario}`);

                // A. Navegação Direta
                await page.goto(configPerfil.url_formulario_direto, { waitUntil: 'domcontentloaded' });
                // B. Fase 1: Pré-seleção (Consulta)
                let contexto = await pptUtils.aguardarContextoDoCampo(page, configfix.campo_tipo_pessoa);
                
                await pptUtils.marcarOpcao(contexto, configfix.campo_tipo_pessoa, htmlNames.value);
                await pptUtils.preencherTexto(contexto, configfix.campo_cpf_cnpj, linha[configPerfil.mapeamento_colunas.CPF_CNPJ]);
                //await pptUtils.preencherTexto(contexto, 'nomePessoa', linha[configPerfil.mapeamento_colunas.NOME]); // O importante da busca é o CPF/CNPJ, pois se estiver cadastrado com nome diferente do inserido no campo "Nome da pessoa", o sistema não encontra o cadastro.
                await pptUtils.preencherTexto(contexto, configfix.campo_nome_pessoa, '.'); // É preciso ter valor no campo "Nome da pessoa" para o sistema realizar a busca.
                
                let btnContinuar = await contexto.$('input[value="Continuar"], input[value="Avancar"]');
                if (btnContinuar) {
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                        btnContinuar.click()
                    ]);
                }
                await navUtils.delay(1000); // Pequena pausa para garantir que a próxima página carregue
                // fim da consulta, próximo passo: verificar se encontrou o beneficiário e aplicar um módulo de validação se o cadastro é novo ou existente, e seguir o fluxo correto para cada caso.
                contexto = await pptUtils.aguardarContextoDoCampo(page, configfix.botao_alterar); // confirma que a página de contexto está correta.
                
                // C. Fase 2: se não encontrar o beneficiário, o texto "Nenhuma pessoa jurídica encontrada para estes parâmetros." é exibido.
                if (await pptUtils.existeTextoNaPagina(page, htmlNames.msg_nao_encontrado)) {
                    logTotal("   ⚠️ Beneficiário não encontrado. Iniciando cadastro...");
                    const btnIncluir = await contexto.$(`input[value="${configfix.botao_incluir}"]`);
                    if (btnIncluir) {
                        await Promise.all([
                            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                            btnIncluir.click()
                        ]);
                    } else {
                        throw new Error(`Não foi possível clicar no botão "${configfix.botao_incluir}".`);
                    }

                    contexto = await pptUtils.aguardarContextoDoCampo(page, htmlNames.campo_nome_cadastro);

                    await pptUtils.preencherTexto(contexto, htmlNames.campo_nome_cadastro, linha[configPerfil.mapeamento_colunas.NOME]);
                    
                    const seletorBotaoConfirmar = 'input[value="Confirmar"]';
                    const mensagemDoServidor = await pptUtils.submeterFormularioComValidacao(page, contexto, seletorBotaoConfirmar);

                    if (mensagemDoServidor.toLowerCase().includes('sucesso')) {
                        logTotal(`   ✅ Cadastro realizado com sucesso para ${tipoBeneficiario}: ${linha[configPerfil.mapeamento_colunas.CPF_CNPJ]}`);
                        await navUtils.delay(2000);
                    } else {
                        throw new Error(`Rejeição do servidor: ${mensagemDoServidor}`);
                    }


                } else {
                    logTotal("   ✅ Beneficiário já cadastrado.");
                    // Adicionar validações adicionais para verificar se os dados estão corretos ou se precisam ser atualizados.
                }

                logTotal(`✅ Sucesso Linha ${numLinha} - Nome: ${linha[configPerfil.mapeamento_colunas.NOME] || "Desconhecido"} | CPF/CNPJ: ${linha[configPerfil.mapeamento_colunas.CPF_CNPJ]}`);
                await navUtils.delay(1000);
                

                const screenshotPath = path.join(diretorios.evidencias, `${idProcesso}_SUCESSO.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true });
                
                // Registra Sucesso
                resultados.push({ status: 'SUCESSO',  linha: numLinha, dados: linha, mensagem: 'Processado com sucesso', numeroOP: '' });
                logTotal(`   ✅ Sucesso!`);

            } catch (erroLinha) {
                logTotal(`   ❌ Erro na linha: ${erroLinha.message}`);
                
                const screenshotPath = path.join(diretorios.evidencias, `${idProcesso}_ERRO.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true }).catch(()=>{});

                resultados.push({ status: 'ERRO', linha: numLinha, dados: linha, mensagem: erroLinha.message, numeroOP: '' });
            }
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

module.exports = { executarCadastroBeneficiario };