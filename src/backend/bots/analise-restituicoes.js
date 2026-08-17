const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const fileUtils = require('../utils/file-utils.js');
const logger = require('../utils/logger.js');
const restituicaoExporter = require('../utils/restituicao-exporter.js');
const { extrairDadosComIA } = require('../utils/ai-service.js');

function prepararEntradasPdf(caminhosPdf) {
    const arquivos = Array.isArray(caminhosPdf) ? caminhosPdf : [caminhosPdf];
    return arquivos.filter(Boolean);
}

async function executarAnaliseRestituicoes(configPerfil, caminhosPdf, diretorioSaida, enviarLog, controle) {
    const logTotal = (msg) => {
        enviarLog(msg);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`);
    };

    try {
        const arquivosPdf = prepararEntradasPdf(caminhosPdf);
        if (arquivosPdf.length === 0) throw new Error('Nenhum PDF informado para análise de restituições.');

        logTotal(`Iniciando análise de restituições para ${arquivosPdf.length} PDF(s).`);
        const diretorios = fileUtils.prepararDiretorios(diretorioSaida, configPerfil.nome);

        if (controle?.abortar) {
            logTotal('Processo interrompido pelo usuário antes da extração.');
            return { sucesso: false, erro: 'Processo interrompido pelo usuário.' };
        }

        const { response } = await dialog.showMessageBox({
            type: 'warning',
            title: 'Aviso de Validação (IA)',
            message: 'Atenção: Extração por Inteligência Artificial',
            detail: 'A extração por IA é passível de erros e exige validação. É de sua responsabilidade conferir todos os dados com o processo original antes da utilização final. Deseja continuar?',
            buttons: ['Confirmar', 'Cancelar'],
            defaultId: 0,
            cancelId: 1
        });

        if (response === 1) {
            logTotal('⚠️ Processo cancelado pelo usuário no alerta de validação da IA.');
            return { sucesso: false, erro: 'Operação cancelada pelo usuário no alerta de validação de IA.' };
        }

        // 1. Enviar PDFs para extração via n8n/IA
        logTotal('Enviando PDFs para extração e classificação via n8n/IA...');
        const resultadoExtracao = await extrairDadosComIA(arquivosPdf, configPerfil);
        logTotal(`   ✅ Extração concluída. Sucesso: ${resultadoExtracao.sucesso} | Falha: ${resultadoExtracao.falha}`);

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
            const caminhoPdfFalhas = path.join(diretorios.evidencias, `Relatorio_Falhas_Restituicoes_${hora}.pdf`);
            
            if (!fs.existsSync(diretorios.evidencias)) {
                fs.mkdirSync(diretorios.evidencias, { recursive: true });
            }

            const { falhas } = restituicaoExporter.normalizarProcessos(resultadoExtracao);
            const resFalhas = await restituicaoExporter.exportarPdfRelatorio(caminhoPdfFalhas, [], falhas, configPerfil);
            logTotal(`Relatório PDF de falhas gerado: ${resFalhas.caminho}`);

            return {
                sucesso: false,
                erro: 'Todos os arquivos do lote falharam na extração via n8n.',
                resumo: {
                    total: resultadoExtracao.total,
                    sucesso: resultadoExtracao.sucesso,
                    falha: resultadoExtracao.falha,
                    alertas_multiplos_dares: [],
                    xlsm: null,
                    backups_xls: [],
                    relatorios_pdf: [resFalhas.caminho]
                }
            };
        }

        // 2. Resolver caminho do modelo .xlsm
        const caminhoModeloXlsm = configPerfil?.configuracoes_fixas?.template_xlsm
            ? path.isAbsolute(configPerfil.configuracoes_fixas.template_xlsm)
                ? configPerfil.configuracoes_fixas.template_xlsm
                : path.resolve(__dirname, '../../..', configPerfil.configuracoes_fixas.template_xlsm)
            : null;

        if (!caminhoModeloXlsm || !fs.existsSync(caminhoModeloXlsm)) {
            logTotal(`   ⚠️ Modelo .xlsm não configurado ou não encontrado em: ${caminhoModeloXlsm}. Gravação na planilha principal será ignorada.`);
        }

        // 3. Exportar relatórios e planilhas
        logTotal('Gerando planilha .xlsm, backup .xls e relatório PDF...');
        const exportacao = await restituicaoExporter.exportarRelatoriosRestituicoes(
            diretorios,
            resultadoExtracao,
            configPerfil,
            caminhoModeloXlsm
        );

        // 4. Log de resultados
        if (exportacao.xlsm) {
            logTotal(`Planilha .xlsm atualizada: ${exportacao.xlsm.caminho}`);
        }
        if (exportacao.backupsXls && exportacao.backupsXls.length > 0) {
            for (const bk of exportacao.backupsXls) {
                logTotal(`Planilha backup .xls: ${bk.caminho}`);
            }
        }
        if (exportacao.relatoriosPdf && exportacao.relatoriosPdf.length > 0) {
            for (const rp of exportacao.relatoriosPdf) {
                logTotal(`Relatório PDF: ${rp.caminho}`);
            }
        }

        // 5. Alertas de múltiplos DAREs
        if (exportacao.alertasMultiplosDares && exportacao.alertasMultiplosDares.length > 0) {
            logTotal(`   ⚠️ ATENÇÃO: ${exportacao.alertasMultiplosDares.length} processo(s) com MÚLTIPLOS DAREs detectados:`);
            for (const alerta of exportacao.alertasMultiplosDares) {
                logTotal(`      → ${alerta}`);
            }
        }

        logTotal(`Processamento finalizado. Total: ${resultadoExtracao.total} | Sucesso: ${resultadoExtracao.sucesso} | Falha: ${resultadoExtracao.falha}`);

        return {
            sucesso: true,
            resumo: {
                total: resultadoExtracao.total,
                sucesso: resultadoExtracao.sucesso,
                falha: resultadoExtracao.falha,
                alertas_multiplos_dares: exportacao.alertasMultiplosDares || [],
                xlsm: exportacao.xlsm?.caminho || null,
                backups_xls: (exportacao.backupsXls || []).map(b => b.caminho),
                relatorios_pdf: (exportacao.relatoriosPdf || []).map(r => r.caminho)
            }
        };
    } catch (error) {
        logTotal(`Erro crítico na análise de restituições: ${error.message}`);
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ERRO CRÍTICO STACK: ${error.stack}`);
        return { sucesso: false, erro: error.message };
    }
}

module.exports = {
    executarAnaliseRestituicoes,
    prepararEntradasPdf
};
