const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const fileUtils = require('../utils/file-utils.js');
const logger = require('../utils/logger.js');
const honorariosExporter = require('../utils/honorarios-exporter.js');
const { extrairDadosComIA } = require('../utils/ai-service.js');

function prepararEntradasPdf(caminhosPdf) {
    const arquivos = Array.isArray(caminhosPdf) ? caminhosPdf : [caminhosPdf];
    return arquivos.filter(Boolean);
}

function resolverCaminhoPerfil(configPerfil) {
    const caminhoConfigurado = configPerfil?.configuracoes_fixas?.perfil_prompt_path || 'perfil_honorarios.md';
    return path.isAbsolute(caminhoConfigurado)
        ? caminhoConfigurado
        : path.resolve(__dirname, '../../..', caminhoConfigurado);
}

function lerPerfilHonorarios(configPerfil) {
    const caminhoPerfil = resolverCaminhoPerfil(configPerfil);
    if (!fs.existsSync(caminhoPerfil)) return '';
    return fs.readFileSync(caminhoPerfil, 'utf-8');
}

async function executarAnaliseHonorariosPericiais(configPerfil, caminhosPdf, diretorioSaida, enviarLog, controle) {
    const logTotal = (msg) => {
        enviarLog(msg);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`);
    };

    try {
        const arquivosPdf = prepararEntradasPdf(caminhosPdf);
        if (arquivosPdf.length === 0) throw new Error('Nenhum PDF informado para análise.');

        logTotal(`Iniciando análise de honorários periciais para ${arquivosPdf.length} PDF(s).`);
        const diretorios = fileUtils.prepararDiretorios(diretorioSaida, configPerfil.nome);
        //const perfil = lerPerfilHonorarios(configPerfil);

        if (controle?.abortar) {
            logTotal('Processo interrompido pelo usuário antes da extração.');
            return { sucesso: false, erro: 'Processo interrompido pelo usuário.' };
        }

        const { response } = await dialog.showMessageBox({
            type: 'warning',
            title: 'Aviso de Validação (IA)',
            message: 'Atenção: Extração por Inteligência Artificial',
            detail: 'As informações extraídas dos processos não são 100% precisas e devem ser validadas na origem antes do uso definitivo. Deseja continuar com a automação?',
            buttons: ['Confirmar', 'Cancelar'],
            defaultId: 0,
            cancelId: 1
        });

        if (response === 1) {
            logTotal('⚠️ Processo cancelado pelo usuário no alerta de validação da IA.');
            return { sucesso: false, erro: 'Operação cancelada pelo usuário no alerta de validação de IA.' };
        }

        logTotal('Enviando PDFs para extração via n8n/IA...');
        const resultadoExtracao = await extrairDadosComIA(arquivosPdf, configPerfil);
        logTotal(`   ✅ Extração Concluída. Sucesso: ${resultadoExtracao.sucesso} | Falha: ${resultadoExtracao.falha}`);

        if (resultadoExtracao.falha > 0) {
            for (const [arquivo, item] of Object.entries(resultadoExtracao.resultados)) {
                if (!item.sucesso) {
                    logTotal(`      → Falha no arquivo [${arquivo}]: ${item.erro}`);
                }
            }
        }

        if (controle?.abortar) {
            logTotal('Processo interrompido pelo usuário antes da exportação.');
            return { sucesso: false, erro: 'Processo interrompido pelo usuário.' };
        }

        if (resultadoExtracao.sucesso === 0) {
            logTotal('Nenhum arquivo extraído com sucesso. Geração de planilhas abortada.');
            logTotal('Gerando apenas relatório PDF de falhas para validação...');

            const hora = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
            const caminhoPdf = path.join(diretorios.evidencias, `Relatorio_Honorarios_Periciais_${hora}.pdf`);
            
            if (!fs.existsSync(diretorios.evidencias)) {
                fs.mkdirSync(diretorios.evidencias, { recursive: true });
            }

            const pdf = await honorariosExporter.exportarPdfHonorarios(caminhoPdf, resultadoExtracao);
            logTotal(`Relatório PDF gerado: ${pdf.caminho}`);

            return {
                sucesso: false,
                erro: 'Todos os arquivos do lote falharam na extração via n8n.',
                resumo: {
                    total: resultadoExtracao.total,
                    sucesso: resultadoExtracao.sucesso,
                    falha: resultadoExtracao.falha,
                    linhas: 0,
                    processos: pdf.processos,
                    planilha: null,
                    pdf: pdf.caminho
                }
            };
        }

        logTotal('Gerando planilha e relatório PDF para validação...');
        const exportacao = await honorariosExporter.exportarRelatoriosHonorarios(diretorios, resultadoExtracao, configPerfil);

        logTotal(`Planilha gerada: ${exportacao.planilha.caminho}`);
        logTotal(`Relatório PDF gerado: ${exportacao.pdf.caminho}`);
        logTotal(`Linhas na planilha: ${exportacao.planilha.linhas} | Processos no PDF: ${exportacao.pdf.processos}`);
        if (exportacao.planilha.falhas > 0) {
            logTotal(`   ⚠️ Atenção: ${exportacao.planilha.falhas} arquivo(s) tiveram falha de extração e foram registrados no relatório.`);
        }

        return {
            sucesso: true,
            resumo: {
                total: resultadoExtracao.total,
                sucesso: resultadoExtracao.sucesso,
                falha: resultadoExtracao.falha,
                linhas: exportacao.planilha.linhas,
                processos: exportacao.pdf.processos,
                planilha: exportacao.planilha.caminho,
                pdf: exportacao.pdf.caminho
            }
        };
    } catch (error) {
        logTotal(`Erro crítico na análise de honorários: ${error.message}`);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ERRO CRÍTICO STACK: ${error.stack}`);
        return { sucesso: false, erro: error.message };
    }
}

module.exports = {
    executarAnaliseHonorariosPericiais,
    prepararEntradasPdf,
    resolverCaminhoPerfil,
    lerPerfilHonorarios
};
