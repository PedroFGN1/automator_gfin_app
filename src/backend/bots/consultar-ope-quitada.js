const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
const fileUtils = require("../utils/file-utils");
const pptUtils = require("../utils/puppeteer-utils");
const navUtils = require("../utils/navigation-utils");
const logger = require("../utils/logger");
const { dialog } = require("electron");

/**
 * Bot para Consulta de OPE Quitada e download do comprovante Dueof.
 */
async function executarConsultaOPEQuitada(configPerfil, caminhoExcel, diretorioSaida, enviarLog, controle) {
    const logTotal = (msg) => {
        enviarLog(msg);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`);
    };

    logTotal("🚀 Inicializando Bot de Consulta OPE Quitada...");
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

        // Configurações extraídas do JSON
        const configNomes = configPerfil.configuracoes_fixas.names;
        const orgaoCodigo = configPerfil.configuracoes_fixas.orgao_codigo;
        const colOP = configPerfil.mapeamento_colunas.OP;

        for (let i = 0; i < dados.length; i++) {
            if (controle && controle.abortar) {
                logTotal("⏹️  Processo interrompido pelo usuário.");
                break;
            }

            const linha = dados[i];
            const numLinha = i + 1;
            const opCompleta = linha[colOP]; 
            
            logTotal(`▶️  Processando ${numLinha}/${dados.length} - OP: ${opCompleta}`);

            try {
                if (!opCompleta) throw new Error("Número da OP não encontrado na planilha.");

                // Extrai os últimos 4 dígitos da OP (Ex: "2026.9995.2867" -> "2867")
                const partesOP = String(opCompleta).split('.');
                const seqOP = partesOP[partesOP.length - 1];

                // 1. Acessa o formulário de consulta diretamente para garantir um estado limpo (Stateless)
                await page.goto(configPerfil.url_formulario_direto, { waitUntil: "domcontentloaded" });
                
                // 2. Aguarda o frame (contexto) que contém o formulário
                let contexto = await pptUtils.aguardarContextoDoCampo(page, configNomes.campo_orgao);

                // 3. Preenche os dados de pesquisa
                await pptUtils.preencherTexto(contexto, configNomes.campo_orgao, orgaoCodigo);
                await pptUtils.preencherTexto(contexto, configNomes.campo_sequencial_op, seqOP);

                // 4. Clica em Consultar
                const btnConsultar = await contexto.$('input[value="Consultar"]');
                if (!btnConsultar) throw new Error("Botão 'Consultar' não encontrado na tela.");
                
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                    btnConsultar.click()
                ]);

                await navUtils.delay(1500); // Pausa para estabilização do DOM

                // 5. Novo contexto após o recarregamento da consulta
                contexto = await pptUtils.aguardarContextoDoCampo(page, configNomes.botao_dueof);

                // 6. Verifica se o botão do PDF Dueof existe. Se não existir, a OP pode não estar quitada.
                const btnDueof = await contexto.$(`input[value="${configNomes.botao_dueof}"]`);
                if (!btnDueof) {
                    throw new Error("Botão 'Dueof' não encontrado. Verifique se a OP está quitada.");
                }

                logTotal("   📥 OP localizada. Baixando comprovante Dueof (PDF)...");

                // 7. Extrai a URL contida no onclick do botão para burlar o visualizador de PDF
                const onclickAttr = await contexto.evaluate((btn) => btn.getAttribute('onclick'), btnDueof);
                const matchUrl = onclickAttr.match(/window\.location\s*=\s*['"]([^'"]+)['"]/);
                
                if (!matchUrl) throw new Error("Não foi possível extrair a URL de download do botão Dueof.");
                
                // Limpa entidades HTML (&amp; -> &) e monta URL relativa
                const pdfUrlRelativa = matchUrl[1].replace(/&amp;/g, '&');

                // 8. Baixa o PDF usando o fetch do próprio navegador para manter os cookies da sessão
                const base64Pdf = await contexto.evaluate(async (urlFetch) => {
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
                const pdfPath = path.join(diretorios.evidencias, `${opCompleta}.pdf`);
                fs.writeFileSync(pdfPath, bufferPdf);

                resultados.push({ status: "SUCESSO",  linha: numLinha, dados: linha, mensagem: "PDF Dueof baixado com sucesso.", numeroOP: opCompleta });
                logTotal(`   ✅ Sucesso! PDF salvo em evidencias/${opCompleta}.pdf`);

            } catch (erroLinha) {
                logTotal(`   ❌ Erro na linha ${numLinha}: ${erroLinha.message}`);
                const screenshotPath = path.join(diretorios.evidencias, `ERRO_LINHA_${numLinha}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true }).catch(()=>{});
                resultados.push({ status: "ERRO", linha: numLinha, dados: linha, mensagem: erroLinha.message, numeroOP: opCompleta || "" });
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

module.exports = { executarConsultaOPEQuitada };