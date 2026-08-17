const puppeteer = require('puppeteer');
const path = require('path');
const fileUtils = require('../utils/file-utils');
const pptUtils = require('../utils/puppeteer-utils');
const navUtils = require('../utils/navigation-utils');
const logger = require('../utils/logger');
const { dialog } = require('electron');


// Função Principal exportada para o Electron
async function executarCadastroDocumento(configPerfil, caminhoExcel, diretorioSaida, enviarLog, controle) {
    // enviarLog: função callback para mandar mensagens para a tela (frontend)

    // Helper para logar na tela E no arquivo txt ao mesmo tempo
    const logTotal = (msg) => {
        enviarLog(msg);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`);
    };

    logTotal('🚀 Inicializando Bot de Cadastro de Documento...');
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
            const observacao = linha[configPerfil.mapeamento_colunas.OBSERVACAO] || `Linha_${numLinha}`;
            
            logTotal(`▶️  Processando ${numLinha}/${dados.length} - Guia: ${observacao}`);

            try {
                const configfix  = configPerfil.configuracoes_fixas;
                const configmap = configPerfil.mapeamento_colunas;

                 // Navegação Direta
                await page.goto(configPerfil.url_formulario_direto, { waitUntil: 'domcontentloaded' });
 
                // ─────────────────────────────────────────────────────────────
                // FASE 1: Pré-seleção (Consulta do código de barras)
                // Riscos tratados:
                //   • DOCUMENTO_JA_CADASTRADO → pula a linha com aviso
                //   • DIGITO_INVALIDO         → falha a linha com mensagem clara
                //   • Navegação sem dialog    → fluxo normal, segue para Fase 2
                //   • Dialog sem navegação    → detectado e classificado corretamente
                //     (resolve a race condition entre waitForNavigation e dialog)
                // ─────────────────────────────────────────────────────────────
                logTotal(`   [Fase 1] Preenchendo código de barras...`);
                let contexto = await pptUtils.aguardarContextoDoCampo(page, configfix.names.campo_codigo_barras);
                await pptUtils.preencherTexto(contexto, configfix.names.campo_codigo_barras, linha[configmap.CODIGO_BARRA]);
 
                const btnContinuarFase1 = await contexto.$('input[value="Continuar"], input[value="Avancar"]');
                if (!btnContinuarFase1) {
                    throw new Error('Botão "Continuar/Avançar" não encontrado na Fase 1.');
                }
 
                const fase1 = await pptUtils.executarComDialogGuardado(
                    page,
                    () => btnContinuarFase1.click(),
                    { aguardarNavegacao: true, waitUntil: 'domcontentloaded', timeoutNav: 15000, timeoutDialog: 1000 }
                );
 
                if (fase1.mensagemDialog) {
                    logTotal(`   ⚠️  [Fase 1] Dialog: "${fase1.mensagemDialog}" → Categoria: ${fase1.categoriaDialog}`);
                    switch (fase1.categoriaDialog) {
                        case 'DOCUMENTO_JA_CADASTRADO':
                            // Documento duplicado: registra como aviso e pula (não é erro grave)
                            logTotal(`   ⏭️  Linha ${numLinha} IGNORADA: documento já cadastrado no sistema.`);
                            resultados.push({ status: 'IGNORADO', linha: numLinha, dados: linha, mensagem: `Já cadastrado: ${fase1.mensagemDialog}`, numeroOP: '' });
                            continue; // Próxima iteração do loop
                        case 'DIGITO_INVALIDO':
                            throw new Error(`[Fase 1] Código de barras inválido ou com dígito errado: "${fase1.mensagemDialog}"`);
                        default:
                            // Qualquer outro dialog na Fase 1 é tratado como erro de consulta
                            throw new Error(`[Fase 1] Consulta recusada pelo sistema: "${fase1.mensagemDialog}"`);
                    }
                }
 
                if (!fase1.navegou) {
                    // Nenhum dialog e nenhuma navegação: estado inesperado
                    throw new Error('[Fase 1] O sistema não avançou nem exibiu mensagem após o clique em Continuar.');
                }
 
                // ─────────────────────────────────────────────────────────────
                // FASE 2: Preenchimento dos dados do documento
                // Riscos tratados:
                //   • CAMPO_OBRIGATORIO    → falha a linha identificando o problema
                //   • BENEFICIARIO_INVALIDO → falha a linha (complementa a verificação
                //                            do idBenef null que já existia)
                //   • Dialog inesperado    → capturado e classificado antes do clique,
                //                           evitando que o browser fique bloqueado
                // ─────────────────────────────────────────────────────────────
                logTotal(`   [Fase 2] Preenchendo dados do formulário...`);
                contexto = await pptUtils.aguardarContextoDoCampo(page, configfix.names.campo_orgao);
 
                await pptUtils.preencherTexto(contexto, configfix.names.campo_orgao, configfix.orgao_codigo);
                await pptUtils.preencherTexto(contexto, configfix.names.campo_descricao_boleto, observacao);
 
                // Busca ID do beneficiário (aba oculta) — verificação já existente, mantida
                const idBenef = await pptUtils.buscarIdBeneficiario(browser, configPerfil.url_base_sistema, configfix.beneficiario);
                if (!idBenef) {
                    throw new Error(`[Fase 2] Beneficiário com CPF/CNPJ "${configfix.beneficiario}" não encontrado no sistema.`);
                }
 
                // Injeta o ID no campo hidden
                await contexto.evaluate((id) => {      
                    const iId = document.querySelector('input[name="idPessoa"]');
                    if (iId) iId.value = id || '';     
                }, idBenef);
 
                const btnContinuarFase2 = await contexto.$('input[value="Continuar"], input[value="Avancar"]');
                if (!btnContinuarFase2) {
                    throw new Error('[Fase 2] Botão "Continuar/Avançar" não encontrado.');
                }
 
                const fase2 = await pptUtils.executarComDialogGuardado(
                    page,
                    () => btnContinuarFase2.click(),
                    { aguardarNavegacao: true, waitUntil: 'domcontentloaded', timeoutNav: 15000, timeoutDialog: 1000 }
                );
 
                if (fase2.mensagemDialog) {
                    logTotal(`   ⚠️  [Fase 2] Dialog: "${fase2.mensagemDialog}" → Categoria: ${fase2.categoriaDialog}`);
                    switch (fase2.categoriaDialog) {
                        case 'CAMPO_OBRIGATORIO':
                            throw new Error(`[Fase 2] Campo obrigatório não preenchido: "${fase2.mensagemDialog}"`);
                        case 'BENEFICIARIO_INVALIDO':
                            throw new Error(`[Fase 2] Beneficiário rejeitado pelo sistema: "${fase2.mensagemDialog}"`);
                        default:
                            throw new Error(`[Fase 2] Preenchimento recusado pelo sistema: "${fase2.mensagemDialog}"`);
                    }
                }
 
                if (!fase2.navegou) {
                    throw new Error('[Fase 2] O sistema não avançou nem exibiu mensagem após o preenchimento.');
                }
 
                // ─────────────────────────────────────────────────────────────
                // FASE 3: Confirmação e Inclusão
                // Riscos tratados:
                //   • SUCESSO_INCLUSAO  → confirma sucesso de forma explícita (não
                //                         apenas pela ausência de erro)
                //   • ERRO_SISTEMA      → falha a linha com mensagem do servidor
                //   • DESCONHECIDO      → capturado e registrado; não assume sucesso
                //   • Sem dialog e sem  → estado inesperado, falha conservadoramente
                //     navegação
                //   • Enter cego        → substituído por verificação real do resultado
                // ─────────────────────────────────────────────────────────────
                logTotal(`   [Fase 3] Confirmando inclusão...`);
                const botaoIncluir = await contexto.$('input[value="Incluir"]');
                if (!botaoIncluir) {
                    throw new Error('[Fase 3] Botão "Incluir" não encontrado na página de confirmação.');
                }
 
                const fase3 = await pptUtils.executarComDialogGuardado(
                    page,
                    () => botaoIncluir.click(),
                    // timeoutDialog maior: a resposta do servidor pode demorar
                    { aguardarNavegacao: true, waitUntil: 'networkidle2', timeoutNav: 15000, timeoutDialog: 1000 }
                );
 
                if (fase3.mensagemDialog) {
                    logTotal(`   💬 [Fase 3] Resposta do servidor: "${fase3.mensagemDialog}" → Categoria: ${fase3.categoriaDialog}`);
                    switch (fase3.categoriaDialog) {
                        case 'SUCESSO_INCLUSAO':
                            // Confirmação explícita de sucesso pelo sistema — fluxo ideal
                            break;
                        case 'ERRO_SISTEMA':
                            throw new Error(`[Fase 3] Sistema retornou erro na inclusão: "${fase3.mensagemDialog}"`);
                        default:
                            // Dialog com conteúdo desconhecido: não assume sucesso
                            throw new Error(`[Fase 3] Resposta inesperada do servidor: "${fase3.mensagemDialog}"`);
                    }
                } else if (fase3.navegou) {
                    // Alguns sistemas navegam diretamente no sucesso, sem dialog
                    logTotal(`   ℹ️  [Fase 3] Inclusão concluída por navegação (sem dialog de confirmação).`);
                } else {
                    // Nem dialog nem navegação: estado completamente ambíguo
                    throw new Error('[Fase 3] Nenhuma resposta recebida do sistema após clicar em Incluir. Verifique manualmente.');
                }

                const screenshotPath = path.join(diretorios.evidencias, `${observacao}_SUCESSO.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true });
                
                // Registra Sucesso
                resultados.push({ status: 'SUCESSO',  linha: numLinha, dados: linha, mensagem: 'Processado com sucesso', numeroOP: '' });
                logTotal(`   ✅ Sucesso! Linha ${numLinha} - Guia: ${observacao}`);

            } catch (erroLinha) {
                logTotal(`   ❌ Erro na linha: ${erroLinha.message}`);
                
                const screenshotPath = path.join(diretorios.evidencias, `${observacao}_ERRO.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true }).catch(()=>{});

                resultados.push({ status: 'ERRO', linha: numLinha, dados: linha, mensagem: erroLinha.message, numeroOP: '' });
            }
        }

        // 6. Finalização e Relatórios
        logTotal('💾 Gerando relatórios finais...');
        const resumo = await fileUtils.exportarRelatorios(diretorios.planilhas, resultados);
        
        logTotal('🏁 PROCESSO CONCLUÍDO!');
        logTotal(`   Sucessos: ${resumo.qtdSucesso} | Erros: ${resumo.qtdErro} | Ignorados: ${resultados.filter(r => r.status === 'IGNORADO').length}`);
        logTotal(`   Arquivos salvos em: ${diretorios.base}`);

        return { sucesso: true, resumo };

    } catch (error) {
        logTotal(`❌ ERRO FATAL NO BOT: ${error.message}`);
        return { sucesso: false, erro: error.message };
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { executarCadastroDocumento };