/*
 * Bot: Consultar OP Quitada
 * Descrição: Consulta Ordens de Pagamento (OP), desmembra o número da OP em 5 campos,
 * verifica a quitação e realiza o download nativo do PDF (Dueof) via Fetch.
 */
const pptUtils = require('../utils/puppeteer-utils');
const navUtils = require('../utils/navigation-utils');
const fileUtils = require('../utils/file-utils');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');
const puppeteer = require("puppeteer");
const { dialog } = require("electron");

async function executarConsultaOPQuitada(configPerfil, caminhoExcel, diretorioSaida, enviarLog, controle) {
    const logTotal = (msg) => {
        enviarLog(msg);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`);
    };

    logTotal("🚀 Inicializando Bot de Consulta OP Quitada...");
    let browser = null;
    const resultados = [];
    
    try {
        logTotal("📂 Preparando diretórios de evidências e PDFs...");
        const diretorios = fileUtils.prepararDiretorios(diretorioSaida, configPerfil.nome);
        logTotal(`   ↳ Salvo em: ${diretorios.base}`);

        logTotal(`📊 Lendo planilha: ${caminhoExcel}`);
        const dados = await fileUtils.lerExcelInput(caminhoExcel);
        logTotal(`   ✅ ${dados.length} linhas encontradas.`);

        logTotal("🌍 Abrindo navegador...");
        browser = await puppeteer.launch({ 
            headless: false, 
            defaultViewport: null, 
            args: ["--start-maximized"] 
        });
        const page = (await browser.pages())[0] || await browser.newPage();

        logTotal("🔐 Acessando ao portal para Login...");
        await page.goto(configPerfil.url_portal, { waitUntil: "domcontentloaded" });
        
        const { response } = await dialog.showMessageBox({
            type: "info",
            title: "Aguardando Login",
            message: "Ação Necessária:",
            detail: "1. Faça o login no portal.\n2. Clique em \"Iniciar Processamento\" abaixo para soltar o robô.",
            buttons: ["Iniciar Processamento", "Cancelar"],
            defaultId: 0,
            cancelId: 1
        });
        
        if (response === 1) throw new Error("Operação cancelada pelo usuário durante o login.");

        logTotal("✅ Confirmação recebida! Iniciando automação...");
        
        for (let i = 0; i < dados.length; i++) {
            const linha = dados[i];
            let status = 'ERRO';
            let mensagemDetalhada = '';
            const numeroOPCompleto = linha[configPerfil.mapeamento_colunas.OP]; 

            try {
                // 1. Verificação de abortagem
                if (controle && controle.abortar) {
                    logTotal('Processamento abortado pelo usuário.');
                    break;
                }
                logTotal(`[Linha ${i + 1}] Processando OP: ${numeroOPCompleto}`);

                if (!numeroOPCompleto) throw new Error("Número da OP não encontrado na planilha.");

                // 2. Navegação Stateless - Recarrega a página de formulário limpa para cada OP
                await page.goto(configPerfil.url_formulario_direto, { waitUntil: "domcontentloaded" });

                // 3. Tratamento e Desmembramento do Número da OP
                if (!numeroOPCompleto || !numeroOPCompleto.includes('.')) {
                    throw new Error("Formato de OP inválido. Esperado separação por pontos (ex: 2022.1702.063.00001.001)");
                }

                const partesOP = numeroOPCompleto.split('.');
                if (partesOP.length !== 5) {
                    throw new Error(`A OP possui ${partesOP.length} partes em vez de 5.`);
                }

                // 4. Preenchimento dos 5 campos da OP
                const camposOP = configPerfil.configuracoes_fixas.campos_op; // Array com 5 seletores no profiles.json
                // Aguarda o frame/contexto baseando-se no primeiro campo do formulário
                let contextoPage = await pptUtils.aguardarContextoDoCampo(page, camposOP.campo_exercicio);

                // Injeta cada parte da OP exatamente no seu input correspondente
                await pptUtils.preencherTexto(contextoPage, camposOP.campo_exercicio, partesOP[0]);
                await pptUtils.preencherTexto(contextoPage, camposOP.campo_orgao, partesOP[1]);
                await pptUtils.preencherTexto(contextoPage, camposOP.campo_sequencial_dotacao, partesOP[2]);
                await pptUtils.preencherTexto(contextoPage, camposOP.campo_empenho, partesOP[3]);
                await pptUtils.preencherTexto(contextoPage, camposOP.campo_sequencial_op, partesOP[4]);

                // 5. Submissão da Consulta
                await Promise.all([
                    contextoPage.click('input[value="Consultar"]'),
                    page.waitForNavigation({ waitUntil: 'domcontentloaded' })
                ]);

                contextoPage = await pptUtils.aguardarContextoDoCampo(page, configPerfil.configuracoes_fixas.botao_dueof);
                // 6. Verificação de Quitação e Localização do Botão Dueof
                const btnDueof = await contextoPage.$(`input[value="${configPerfil.configuracoes_fixas.botao_dueof}"]`);
                if (!btnDueof) {
                    throw new Error("OP não localizada, não quitada ou botão Dueof ausente.");
                }

                // 7. Extrai a URL contida no onclick do botão para burlar o visualizador de PDF
                const onclickAttr = await contextoPage.evaluate((btn) => btn.getAttribute('onclick'), btnDueof);
                const matchUrl = onclickAttr.match(/window\.location\s*=\s*['"]([^'"]+)['"]/);

                if (!matchUrl) throw new Error("Não foi possível extrair a URL de download do botão Dueof.");

                // Limpa entidades HTML (&amp; -> &) e monta URL relativa
                const pdfUrlRelativa = matchUrl[1].replace(/&amp;/g, '&');

                // 8. Baixa o PDF usando o fetch do próprio navegador para manter os cookies da sessão
                const base64Pdf = await contextoPage.evaluate(async (urlFetch) => {
                    const response = await fetch(urlFetch);
                    if (!response.ok) throw new Error(`Erro HTTP no download: ${response.status}`);
                    
                    const blob = await response.blob();
                    
                    // Converte o Blob para Base64 para trafegar facilmente do navegador para o Node.js
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result.split(',')[1]);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                }, pdfUrlRelativa);

                // 9. Salva o arquivo fisicamente no disco com o nome exato da OP
                const bufferPdf = Buffer.from(base64Pdf, 'base64');
                const nomeArquivo = `${numeroOPCompleto}.pdf`;
                const caminhoArquivo = path.join(diretorios.evidencias, nomeArquivo);
                fs.writeFileSync(caminhoArquivo, bufferPdf);
                
                status = 'SUCESSO';
                mensagemDetalhada = `PDF salvo com sucesso em: ${caminhoArquivo}`;
                logTotal(`[Linha ${i + 1}] Sucesso!`);

            } catch (error) {
                status = 'ERRO';
                logTotal(`   ❌ Erro na linha ${i + 1}: ${error.message}`);
                mensagemDetalhada = error.message;
                logTotal(`[Linha ${i + 1}] Erro: ${error.message}`);
                
                // Captura de tela para evidência de erro
                const nomePrint = `ERRO_${numeroOPCompleto}.png`;
                await page.screenshot({ path: path.join(diretorios.evidencias, nomePrint), fullPage: true });
            } finally {
                // Atualiza barra de progresso da UI e salva relatório
                resultados.push({ status: status, linha: i + 1, dados: linha, mensagem: mensagemDetalhada, OP: numeroOPCompleto });
                //if (atualizarProgresso) atualizarProgresso(i + 1, dados.length);
            }
        }

        logTotal("💾 Gerando relatórios finais...");
        const resumo = await fileUtils.exportarRelatorios(diretorios.planilhas, resultados);
        
        logTotal("🏁 PROCESSO CONCLUÍDO!");
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

module.exports = { executarConsultaOPQuitada };