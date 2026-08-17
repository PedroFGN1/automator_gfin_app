const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const puppeteer = require('puppeteer');
const navUtils = require('./navigation-utils.js');

const MAPA_CHAVE_PADRAO = {
    processo_sei: { stdKey: 'PROCESSO_SEI', defaultHeader: 'Processo SEI', width: 22 },
    processo_judicial: { stdKey: 'PROCESSO', defaultHeader: 'Proc. Judicial', width: 28 },
    cpf_cnpj_autor: { stdKey: 'CPF_CNPJ_AUTOR', defaultHeader: 'CPF/CNPJ Autor', width: 22 },
    cpf_cnpj_reu: { stdKey: 'CPF_CNPJ_REU', defaultHeader: 'CPF/CNPJ Réu', width: 22 },
    comarca: { stdKey: 'COMARCA', defaultHeader: 'Município', width: 26 },
    vara_judicial: { stdKey: 'VARA_JUDICIAL', defaultHeader: 'Vara Judicial', width: 30 },
    valor_arbitrado_pelo_juiz: { stdKey: 'VALOR', defaultHeader: 'Valor', width: 24 },
    observacao: { stdKey: 'OBSERVACAO', defaultHeader: 'Observação', width: 24 },
    data_vencimento: { stdKey: 'DATA_VENCIMENTO', defaultHeader: 'Data de Vencimento', width: 24 },
    status_analise: { stdKey: 'STATUS', defaultHeader: 'status_analise', width: 24 },
    justificativa_status: { stdKey: 'JUSTIFICATIVA', defaultHeader: 'justificativa_status', width: 30 },
    despacho_gerado: { stdKey: 'DESPACHO', defaultHeader: 'Despacho', width: 40 }
};

function obterColunasPlanilha(configPerfil) {
    const mapeamento = configPerfil?.mapeamento_colunas || {};
    return Object.entries(MAPA_CHAVE_PADRAO).map(([key, info]) => {
        const header = mapeamento[info.stdKey] || info.defaultHeader;
        return { header, key, width: info.width };
    });
}

function normalizarTexto(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor).trim();
}

function extrairProcessoSei(arquivoOrigem) {
    const base = path.basename(normalizarTexto(arquivoOrigem), path.extname(normalizarTexto(arquivoOrigem)));
    const semPrefixo = base.replace(/^SEI[_\s-]*/i, '');
    const digitos = semPrefixo.replace(/\D/g, '');
    return /^SEI/i.test(base) && digitos ? digitos : '';
}

function normalizarBooleano(valor) {
    if (valor === true) return 'Sim';
    if (valor === false) return 'Nao';
    return '';
}

function formatarMoeda(valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return normalizarTexto(valor);
    return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escapeHtml(valor) {
    return normalizarTexto(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizarRespostaN8n(resposta) {
    if (Array.isArray(resposta)) {
        if (resposta.length === 1) return normalizarRespostaN8n(resposta[0]);
        return resposta.map(normalizarRespostaN8n).filter(Boolean);
    }

    if (resposta && typeof resposta === 'object') {
        if (resposta.json) return normalizarRespostaN8n(resposta.json);
        if (resposta.data) return normalizarRespostaN8n(resposta.data);
        if (resposta.body) return normalizarRespostaN8n(resposta.body);
    }

    return resposta;
}

function normalizarProcessos(resultadoExtracao) {
    const resultados = resultadoExtracao?.resultados || {};
    const processos = [];
    const falhas = [];

    for (const [arquivoOrigem, item] of Object.entries(resultados)) {
        const processoSei = extrairProcessoSei(arquivoOrigem);

        if (!item?.sucesso) {
            falhas.push({
                arquivo_origem: arquivoOrigem,
                processo_sei: processoSei,
                erro: normalizarTexto(item?.erro || 'Falha sem mensagem.')
            });
            continue;
        }

        const resposta = normalizarRespostaN8n(item.resposta);
        const lista = Array.isArray(resposta) ? resposta : [resposta];

        for (const processo of lista) {
            if (!processo || typeof processo !== 'object') {
                falhas.push({
                    arquivo_origem: arquivoOrigem,
                    processo_sei: processoSei,
                    erro: 'Resposta da IA nao possui objeto de processo.'
                });
                continue;
            }

            processos.push({
                arquivo_origem: arquivoOrigem,
                processo_sei: processoSei,
                ...processo,
                pericias_encontradas: Array.isArray(processo.pericias_encontradas)
                    ? processo.pericias_encontradas
                    : []
            });
        }
    }

    return { processos, falhas };
}

function calcularDataVencimento(diasAcrescimo) {
    let dias = Number(diasAcrescimo);
    // Caso seja indefinido, nulo, inválido ou negativo, adota fallback padrão de 5 dias corridos
    if (diasAcrescimo === null || diasAcrescimo === undefined || isNaN(dias) || dias < 0) {
        dias = 5;
    }
    
    // Obtém data de processamento sem componentes locais de hora (UTC puro)
    const hoje = new Date();
    const dataUtc = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
    
    // Incrementa dias
    dataUtc.setUTCDate(dataUtc.getUTCDate() + dias);
    
    // Prorrogação simples se cair em fim de semana
    const diaSemana = dataUtc.getUTCDay();
    if (diaSemana === 6) { // Sábado
        dataUtc.setUTCDate(dataUtc.getUTCDate() + 2);
    } else if (diaSemana === 0) { // Domingo
        dataUtc.setUTCDate(dataUtc.getUTCDate() + 1);
    }
    
    // Formata usando obrigatoriamente a função utilitária do projeto
    return navUtils.formatarData(dataUtc);
}

function gerarDespacho(processo) {
    const processoNum = normalizarTexto(processo.processo_judicial);
    const comarca = normalizarTexto(processo.comarca);
    const vara = normalizarTexto(processo.vara_judicial);

    const valProcesso = processoNum ? processoNum : '[PROCESSO NÃO ENCONTRADO]';
    const valComarca = comarca ? comarca.toUpperCase() : '[COMARCA NÃO ENCONTRADA]';
    const valVara = vara ? vara.toUpperCase() : '[VARA NÃO ENCONTRADA]';

    return `Em cumprimento à solicitação extraída dos autos do Processo nº ${valProcesso} - Comarca de ${valComarca} - ${valVara}, encaminhem-se, ao Setor de Honorários Periciais, desta Gerência da Secretaria Geral do Gabinete, a documentação, referente ao depósito judicial, à título de honorários periciais, tendo em vista que tem-se parte(s) beneficiária(s) da Assistência Judiciária Gratuita, nos termos da resolução nº 232/2016 do CNJ e Decreto Judiciário nº 1.068/2021 e Decreto Judiciário nº 2.000/2023 do Tribunal de Justiça do Estado de Goiás. Posto isto, remetam-se os autos ao Setor de Honorários Periciais CDHP desta secretaria da Economia para elaboração da resposta desta Pasta ao Juízo do feito.`;
}

function montarLinhasPlanilha(resultadoExtracao, configPerfil) {
    const { processos, falhas } = normalizarProcessos(resultadoExtracao);
    const linhas = [];
    const diasAcrescimo = configPerfil?.configuracoes_fixas?.dias_acrescimo_vencimento;
    const dataVencimento = calcularDataVencimento(diasAcrescimo);

    for (const processo of processos) {
        const pericias = processo.pericias_encontradas.length > 0
            ? processo.pericias_encontradas
            : [{}];

        for (const pericia of pericias) {
            linhas.push({
                processo_sei: normalizarTexto(processo.processo_sei),
                processo_judicial: normalizarTexto(processo.processo_judicial),
                cpf_cnpj_autor: normalizarTexto(pericia.autor?.documento_cpf_cnpj),
                cpf_cnpj_reu: normalizarTexto(pericia.reu?.documento_cpf_cnpj),
                comarca: normalizarTexto(processo.comarca),
                valor_arbitrado_pelo_juiz: pericia.dados_pericia?.valor_arbitrado_pelo_juiz ?? '',
                observacao: `SEI - ${normalizarTexto(processo.processo_sei)} - ${normalizarTexto(processo.comarca ?? '')}`,
                data_vencimento: dataVencimento,
                status_analise: normalizarTexto(pericia.analise_valores?.status_analise),
                justificativa_status: normalizarTexto(pericia.analise_valores?.justificativa_status),
                vara_judicial: normalizarTexto(processo.vara_judicial),
                despacho_gerado: gerarDespacho(processo)
            });
        }
    }

    return { linhas, processos, falhas };
}

async function exportarPlanilhaHonorarios(caminhoArquivo, resultadoExtracao, configPerfil) {
    const { linhas, processos, falhas } = montarLinhasPlanilha(resultadoExtracao, configPerfil);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Honorarios');

    sheet.columns = obterColunasPlanilha(configPerfil);
    sheet.addRows(linhas);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1F2937' }
    };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    const valorColuna = sheet.getColumn('valor_arbitrado_pelo_juiz');
    valorColuna.numFmt = '"R$" #,##0.00';

    sheet.eachRow((row) => {
        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
            };
        });
    });

    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    await workbook.xlsx.writeFile(caminhoArquivo);
    return { caminho: caminhoArquivo, linhas: linhas.length, processos: processos.length, falhas: falhas.length };
}

function renderizarCampo(label, valor) {
    return `
        <div class="field">
            <span class="label">${escapeHtml(label)}</span>
            <span class="value">${escapeHtml(valor || 'Nao informado')}</span>
        </div>
    `;
}

function renderizarPericia(pericia, indice) {
    const dados = pericia.dados_pericia || {};
    const analise = pericia.analise_valores || {};

    return `
        <section class="pericia">
            <h2>Pericia ${escapeHtml(pericia.id_referencia || indice + 1)}</h2>
            <div class="grid two">
                ${renderizarCampo('Autor', pericia.autor?.nome)}
                ${renderizarCampo('CPF/CNPJ do autor', pericia.autor?.documento_cpf_cnpj)}
                ${renderizarCampo('Reu', pericia.reu?.nome)}
                ${renderizarCampo('CPF/CNPJ do reu', pericia.reu?.documento_cpf_cnpj)}
                ${renderizarCampo('Perito', pericia.perito?.nome)}
                ${renderizarCampo('CPF/CNPJ do perito', pericia.perito?.documento_cpf_cnpj)}
            </div>
            <div class="grid two">
                ${renderizarCampo('Codigo da tabela', dados.codigo_tabela_identificado)}
                ${renderizarCampo('Descricao da tabela', dados.descricao_tabela_identificada)}
                ${renderizarCampo('Valor arbitrado pelo juiz', formatarMoeda(dados.valor_arbitrado_pelo_juiz))}
                ${renderizarCampo('Decisao fundamentada', normalizarBooleano(dados.possui_decisao_fundamentada))}
                ${renderizarCampo('Valor base da tabela', formatarMoeda(analise.valor_base_tabela))}
                ${renderizarCampo('Valor maximo TJ', formatarMoeda(analise.valor_maximo_tj_tabela))}
                ${renderizarCampo('Limite TJ x5', formatarMoeda(analise.limite_TJ_x5))}
                ${renderizarCampo('Limite tolerancia PGE x3', formatarMoeda(analise.limite_tolerancia_pge_3x))}
            </div>
            <div class="status">${escapeHtml(analise.status_analise || 'Status nao informado')}</div>
            <div class="justificativa">${escapeHtml(analise.justificativa_status || 'Justificativa nao informada')}</div>
            ${pericia.perito?.contato_ou_dados_bancarios ? `
                <p class="note"><strong>Contato/dados bancarios:</strong> ${escapeHtml(pericia.perito.contato_ou_dados_bancarios)}</p>
            ` : ''}
        </section>
    `;
}

function montarHtmlRelatorio(processos, falhas) {
    const paginasProcessos = processos.map((processo) => `
        <article class="page">
            <header>
                <p class="eyebrow">Relatorio de honorarios periciais</p>
                <p class="sei">Processo SEI: ${escapeHtml(processo.processo_sei || 'Nao informado')}</p>
                <h1>${escapeHtml(processo.processo_judicial || 'Processo nao informado')}</h1>
                <div class="meta">
                    <span>${escapeHtml(processo.comarca || 'Comarca nao informada')}</span>
                    <span>${escapeHtml(processo.vara_judicial || 'Vara nao informada')}</span>
                    <span>Gratuidade/ACP: ${escapeHtml(normalizarBooleano(processo.gratuidade_justica_ou_acp) || 'Nao informado')}</span>
                </div>
            </header>
            ${(processo.pericias_encontradas.length > 0 ? processo.pericias_encontradas : [{}])
                .map(renderizarPericia)
                .join('')}
        </article>
    `).join('');

    const paginaFalhas = falhas.length === 0 ? '' : `
        <article class="page">
            <header>
                <p class="eyebrow">Relatorio de honorarios periciais</p>
                <h1>Falhas de extracao</h1>
            </header>
            ${falhas.map((falha) => `
                <section class="pericia">
                    ${renderizarCampo('Processo SEI', falha.processo_sei)}
                    ${renderizarCampo('Arquivo', falha.arquivo_origem)}
                    ${renderizarCampo('Erro', falha.erro)}
                </section>
            `).join('')}
        </article>
    `;

    return `
        <!doctype html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <style>
                * { box-sizing: border-box; }
                body {
                    margin: 0;
                    font-family: Arial, Helvetica, sans-serif;
                    color: #172033;
                    background: #ffffff;
                    font-size: 12px;
                }
                .page {
                    min-height: 100vh;
                    padding: 34px;
                    page-break-after: always;
                }
                .page:last-child { page-break-after: auto; }
                header {
                    border-bottom: 2px solid #1f6f78;
                    padding-bottom: 14px;
                    margin-bottom: 18px;
                }
                .eyebrow {
                    margin: 0 0 8px;
                    color: #1f6f78;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: .04em;
                    font-size: 10px;
                }
                .sei {
                    margin: 0 0 8px;
                    color: #0f172a;
                    font-size: 16px;
                    font-weight: 700;
                }
                h1 {
                    margin: 0;
                    font-size: 22px;
                    color: #111827;
                }
                h2 {
                    margin: 0 0 12px;
                    font-size: 15px;
                    color: #1f2937;
                }
                .meta {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                    margin-top: 12px;
                }
                .meta span {
                    border: 1px solid #cbd5e1;
                    border-radius: 4px;
                    padding: 5px 8px;
                    background: #f8fafc;
                }
                .pericia {
                    border: 1px solid #d7dee8;
                    border-radius: 6px;
                    padding: 14px;
                    margin: 0 0 14px;
                    break-inside: avoid;
                }
                .grid {
                    display: grid;
                    gap: 8px;
                    margin-bottom: 10px;
                }
                .grid.two { grid-template-columns: 1fr 1fr; }
                .field {
                    border: 1px solid #e5e7eb;
                    border-radius: 4px;
                    padding: 7px;
                    min-height: 46px;
                    background: #ffffff;
                }
                .label {
                    display: block;
                    color: #607083;
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                    margin-bottom: 4px;
                }
                .value { color: #111827; }
                .status {
                    display: inline-block;
                    margin-top: 2px;
                    padding: 7px 10px;
                    border-radius: 4px;
                    background: #e7f3f5;
                    color: #14565e;
                    font-weight: 700;
                }
                .note {
                    margin: 12px 0 0;
                    padding: 9px;
                    border-left: 3px solid #1f6f78;
                    background: #f8fafc;
                    line-height: 1.35;
                }
            </style>
        </head>
        <body>
            ${paginasProcessos || '<article class="page"><h1>Nenhum processo extraido</h1></article>'}
            ${paginaFalhas}
        </body>
        </html>
    `;
}

async function exportarPdfHonorarios(caminhoArquivo, resultadoExtracao) {
    const { processos, falhas } = normalizarProcessos(resultadoExtracao);
    const html = montarHtmlRelatorio(processos, falhas);
    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        await page.pdf({
            path: caminhoArquivo,
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        });
    } finally {
        if (browser) await browser.close();
    }

    return { caminho: caminhoArquivo, processos: processos.length, falhas: falhas.length };
}

async function exportarRelatoriosHonorarios(diretorios, resultadoExtracao, configPerfil) {
    const hora = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
    const caminhoPlanilha = path.join(diretorios.planilhas, `Honorarios_Periciais_${hora}.xlsx`);
    const caminhoPdf = path.join(diretorios.evidencias, `Relatorio_Honorarios_Periciais_${hora}.pdf`);

    if (!fs.existsSync(diretorios.planilhas)) fs.mkdirSync(diretorios.planilhas, { recursive: true });
    if (!fs.existsSync(diretorios.evidencias)) fs.mkdirSync(diretorios.evidencias, { recursive: true });

    const planilha = await exportarPlanilhaHonorarios(caminhoPlanilha, resultadoExtracao, configPerfil);
    const pdf = await exportarPdfHonorarios(caminhoPdf, resultadoExtracao);

    return { planilha, pdf };
}

module.exports = {
    extrairProcessoSei,
    normalizarRespostaN8n,
    normalizarProcessos,
    montarLinhasPlanilha,
    montarHtmlRelatorio,
    exportarPlanilhaHonorarios,
    exportarPdfHonorarios,
    exportarRelatoriosHonorarios
};
