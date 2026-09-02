const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const puppeteer = require('puppeteer');

const MAPA_TIPO_PARA_GUIA = {
    'Restituição de Fiança': 'guia_fianca',
    'Restituição de ICMS': 'guia_icms',
    'Restituição de IPVA': 'guia_ipva',
    'Restituição de ITCD': 'guia_itcd'
};

function normalizarTexto(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor).trim();
}

function escapeHtml(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatarMoeda(valor) {
    if (valor === null || valor === undefined || isNaN(parseFloat(valor))) return '';
    return parseFloat(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(dataStr) {
    if (!dataStr) return '';
    const match = String(dataStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        return `${match[3]}/${match[2]}/${match[1]}`;
    }
    return dataStr;
}

function extrairProcessoSei(arquivoOrigem) {
    if (!arquivoOrigem) return '';
    const base = path.basename(String(arquivoOrigem), path.extname(String(arquivoOrigem)));
    const matchSei = base.match(/SEI[_\s-]*(\d+)/i);
    if (matchSei) {
        return matchSei[1];
    }
    const digitos = base.replace(/\D/g, '');
    if (digitos.length >= 7) {
        return digitos;
    }
    return '';
}

function normalizarRespostaN8n(resposta) {
    if (!resposta) return null;
    let dados = resposta;
    if (Array.isArray(dados)) dados = dados[0];
    if (dados && dados.json) dados = dados.json;
    if (dados && dados.data) dados = dados.data;
    if (dados && dados.body) dados = dados.body;
    return dados;
}

function normalizarProcessos(resultadoExtracao) {
    const processos = [];
    const falhas = [];

    if (!resultadoExtracao || !resultadoExtracao.resultados) {
        return { processos, falhas };
    }

    for (const [arquivo, item] of Object.entries(resultadoExtracao.resultados)) {
        const processoSeiExtraido = extrairProcessoSei(arquivo);
        
        if (!item.sucesso) {
            falhas.push({
                arquivo,
                processoSei: processoSeiExtraido,
                erro: item.erro || 'Erro na extração'
            });
            continue;
        }

        const dadosNormalizados = normalizarRespostaN8n(item.resposta);
        if (dadosNormalizados) {
            const seiNoJson = dadosNormalizados.processo_sei || 
                              dadosNormalizados.numero_processo_sei || 
                              dadosNormalizados._processo_sei || 
                              dadosNormalizados.processoSEI || 
                              dadosNormalizados.sei || 
                              dadosNormalizados.numero_sei || 
                              dadosNormalizados.processo;
                              
            dadosNormalizados._processo_sei = (seiNoJson ? String(seiNoJson).trim() : '') || processoSeiExtraido || '';
            dadosNormalizados._arquivo_origem = arquivo;
            processos.push(dadosNormalizados);
        }
    }

    return { processos, falhas };
}

function resolverChaveMapeamentoGuia(tipoProcesso, configPerfil) {
    if (!tipoProcesso) return null;
    if (MAPA_TIPO_PARA_GUIA[tipoProcesso]) {
        return MAPA_TIPO_PARA_GUIA[tipoProcesso];
    }
    const norm = String(tipoProcesso)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (norm.includes('fianca')) return 'guia_fianca';
    if (norm.includes('icms')) return 'guia_icms';
    if (norm.includes('ipva')) return 'guia_ipva';
    if (norm.includes('itcd')) return 'guia_itcd';

    if (configPerfil && configPerfil.configuracoes_fixas) {
        for (const [chaveGuia, nomePlanilha] of Object.entries(configPerfil.configuracoes_fixas)) {
            if (chaveGuia.startsWith('guia_') && chaveGuia !== 'guia_dare' && typeof nomePlanilha === 'string') {
                const normNome = nomePlanilha.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (norm.includes(normNome) || normNome.includes(norm)) {
                    return chaveGuia;
                }
            }
        }
    }
    return null;
}

function resolverNomeGuia(tipoProcesso, configPerfil) {
    const chave = resolverChaveMapeamentoGuia(tipoProcesso, configPerfil);
    if (!chave) return null;
    return configPerfil?.configuracoes_fixas?.[chave] || null;
}

function obterCabecalhosGuia(tipoGuia, configPerfil) {
    if (!configPerfil.mapeamento_colunas) return [];
    const mapeamento = configPerfil.mapeamento_colunas[tipoGuia];
    if (!mapeamento || typeof mapeamento !== 'object') return [];
    return Object.entries(mapeamento).map(([chave, cabecalho]) => ({ chave, cabecalho }));
}

function extrairValorProcesso(processo, chaveMapeamento) {
    if (chaveMapeamento === 'PROCESSO_SEI' || chaveMapeamento === 'PROCESSO') {
        return processo._processo_sei || 
               processo.processo_sei || 
               processo.numero_processo_sei || 
               processo.processoSEI || 
               processo.sei || 
               processo.numero_sei || 
               '';
    }
    if (chaveMapeamento === 'tipo_processo') return processo.tipo_processo || '';
    
    const isCpfCnpj = chaveMapeamento.includes('cpf_cnpj');
    const isValor = chaveMapeamento.endsWith('.valor_pago') || 
                    chaveMapeamento.endsWith('.valor_restituir') || 
                    chaveMapeamento.endsWith('.valor_restituicao') || 
                    chaveMapeamento.endsWith('.valor');
    const isData = chaveMapeamento.endsWith('.data_pagamento') || chaveMapeamento.endsWith('.data');
    
    const keys = chaveMapeamento.split('.');
    let atual = processo;
    
    for (let i = 0; i < keys.length; i++) {
        if (atual === null || atual === undefined) return '';
        
        let key = keys[i];
        
        if (key === 'dares_recolhidos' && Array.isArray(atual.dares_recolhidos)) {
            atual = atual.dares_recolhidos[0] || {};
            continue;
        }

        // Aliases for contribuinte <-> acusado
        if (key === 'contribuinte' && (atual.contribuinte === undefined || atual.contribuinte === null) && atual.acusado !== undefined) {
            atual = atual.acusado;
        } else if (key === 'acusado' && (atual.acusado === undefined || atual.acusado === null) && atual.contribuinte !== undefined) {
            atual = atual.contribuinte;
        } else if (isCpfCnpj && i === keys.length - 1) {
            if (atual && typeof atual === 'object') {
                if (atual['cpf/cnpj'] !== undefined && atual['cpf/cnpj'] !== null) {
                    atual = atual['cpf/cnpj'];
                } else if (atual['cpf_cnpj'] !== undefined && atual['cpf_cnpj'] !== null) {
                    atual = atual['cpf_cnpj'];
                } else {
                    atual = atual[key];
                }
            } else {
                atual = '';
            }
        } else if (isValor && i === keys.length - 1) {
            if (atual && typeof atual === 'object') {
                if (atual.valor_restituir !== undefined && atual.valor_restituir !== null) {
                    atual = atual.valor_restituir;
                } else if (atual.valor_pago !== undefined && atual.valor_pago !== null) {
                    atual = atual.valor_pago;
                } else if (atual.valor_restituicao !== undefined && atual.valor_restituicao !== null) {
                    atual = atual.valor_restituicao;
                } else if (atual.valor !== undefined && atual.valor !== null) {
                    atual = atual.valor;
                } else {
                    atual = atual[key];
                }
            } else {
                atual = '';
            }
        } else {
            atual = atual[key];
        }
    }

    if (isData) {
        return formatarData(atual);
    }
    if (isValor) {
        if (atual === '' || atual === null || atual === undefined) return '';
        const num = parseFloat(atual);
        return isNaN(num) ? normalizarTexto(atual) : num;
    }
    
    return normalizarTexto(atual);
}

function extrairValorMunicipio(processo, chaveMapeamento) {
    let valor = extrairValorProcesso(processo, chaveMapeamento);
    if (valor) return valor;

    if (Array.isArray(processo.dares_recolhidos)) {
        for (const dare of processo.dares_recolhidos) {
            if (!dare) continue;
            const munDare = dare.codigo_municipio || dare.municipio || dare.cod_municipio || dare.cd_municipio;
            if (munDare) return normalizarTexto(munDare);
        }
    }

    const munRaiz = processo.codigo_municipio || 
                    processo.municipio || 
                    processo.cod_municipio || 
                    processo.cd_municipio || 
                    processo.veiculo?.codigo_municipio || 
                    processo.veiculo?.municipio;
    if (munRaiz) return normalizarTexto(munRaiz);

    return '';
}

function montarLinhasGuiaPrincipal(processos, configPerfil) {
    const linhasPorGuia = {};
    const alertasMultiplosDares = [];

    for (const processo of processos) {
        let chaveMapeamentoGuia = resolverChaveMapeamentoGuia(processo.tipo_processo, configPerfil);
        let nomePlanilha = chaveMapeamentoGuia ? configPerfil?.configuracoes_fixas?.[chaveMapeamentoGuia] : null;
        
        if (!nomePlanilha) {
            chaveMapeamentoGuia = 'guia_fianca';
            nomePlanilha = configPerfil?.configuracoes_fixas?.guia_fianca || 'Fianca';
        }

        if (!linhasPorGuia[nomePlanilha]) {
            linhasPorGuia[nomePlanilha] = [];
        }

        const cabecalhos = obterCabecalhosGuia(chaveMapeamentoGuia, configPerfil);
        const linha = {};
        const isMultiplosDares = Array.isArray(processo.dares_recolhidos) && processo.dares_recolhidos.length > 1;

        if (isMultiplosDares) {
            alertasMultiplosDares.push(processo._arquivo_origem || processo._processo_sei || 'Processo');
        }

        for (const col of cabecalhos) {
            const isMunicipio = col.chave.toLowerCase().includes('municipio');
            if (isMultiplosDares && col.chave.startsWith('dares_recolhidos.')) {
                if (col.chave === 'dares_recolhidos.numero_dare' || col.chave.includes('valor')) {
                    linha[col.cabecalho] = 'multiplos dares';
                } else if (isMunicipio) {
                    linha[col.cabecalho] = extrairValorMunicipio(processo, col.chave);
                } else {
                    linha[col.cabecalho] = '';
                }
            } else if (isMunicipio) {
                linha[col.cabecalho] = extrairValorMunicipio(processo, col.chave);
            } else {
                linha[col.cabecalho] = extrairValorProcesso(processo, col.chave);
            }
        }

        linhasPorGuia[nomePlanilha].push(linha);
    }

    return { linhasPorGuia, alertasMultiplosDares };
}

function montarLinhasGuiaDare(processos, configPerfil) {
    const linhasDare = [];
    const cabecalhos = obterCabecalhosGuia('guia_dare', configPerfil);

    for (const processo of processos) {
        if (!Array.isArray(processo.dares_recolhidos)) continue;
        
        // DARE sheet only gets filled if there are MORE THAN ONE DAREs for the process
        if (processo.dares_recolhidos.length <= 1) continue;

        for (const dare of processo.dares_recolhidos) {
            const linha = {};
            const processoFake = { ...processo, dares_recolhidos: [dare] };
            
            for (const col of cabecalhos) {
                linha[col.cabecalho] = extrairValorProcesso(processoFake, col.chave);
            }
            linhasDare.push(linha);
        }
    }

    return linhasDare;
}

async function gravarDadosNaPlanilhaXlsm(caminhoModelo, caminhoSaida, linhasPorGuia, linhasDare, configPerfil) {
    const origBuf = fs.readFileSync(caminhoModelo);
    const zip = await JSZip.loadAsync(origBuf);

    // Remove calcChain.xml to prevent Excel recovery warning about out-of-sync formula chains
    if (zip.file('xl/calcChain.xml')) {
        zip.remove('xl/calcChain.xml');
    }

    // Map sheet names from workbook.xml to sheet XML files
    const wbXml = await zip.file('xl/workbook.xml').async('text');
    const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('text');

    const relsMap = {};
    const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g;
    let match;
    while ((match = relRegex.exec(relsXml)) !== null) {
        relsMap[match[1]] = match[2];
    }

    const sheetMap = {};
    const sheetRegex = /<sheet[^>]+name="([^"]+)"[^>]+r:id="([^"]+)"/g;
    while ((match = sheetRegex.exec(wbXml)) !== null) {
        const sheetName = match[1];
        const rId = match[2];
        const target = relsMap[rId];
        if (target) {
            sheetMap[sheetName] = target.startsWith('xl/') ? target : 'xl/' + target;
        }
    }

    let sharedStrings = [];
    if (zip.file('xl/sharedStrings.xml')) {
        const ssXml = await zip.file('xl/sharedStrings.xml').async('text');
        const siParts = ssXml.split('</si>');
        for (let i = 0; i < siParts.length; i++) {
            const part = siParts[i];
            const tMatches = [...part.matchAll(/<t[^>]*>([^<]*)<\/t>/g)];
            if (tMatches.length > 0) {
                sharedStrings.push(tMatches.map(m => m[1]).join(''));
            } else if (part.includes('<si>')) {
                sharedStrings.push('');
            }
        }
    }

    function obterLetraColuna(colHeaderMap, cabecalho) {
        const normCabecalho = cabecalho.trim().toLowerCase();
        
        // 1. Exact case-insensitive match
        for (const [key, letter] of Object.entries(colHeaderMap)) {
            if (key.trim().toLowerCase() === normCabecalho) {
                return letter;
            }
        }
        
        // 2. Synonyms for DARE number column (e.g. '123' used as placeholder)
        const dareNumSynonyms = ['documento referência', 'dare', 'dare/gnre nº', 'dare/gnre/das', '123'];
        if (dareNumSynonyms.includes(normCabecalho)) {
            for (const synonym of dareNumSynonyms) {
                for (const [key, letter] of Object.entries(colHeaderMap)) {
                    if (key.trim().toLowerCase() === synonym) {
                        return letter;
                    }
                }
            }
        }
        
        // 3. Synonyms for Valor Autorizado column
        const valorSynonyms = ['valor autorizado', 'valor autorizado a restituir', 'valor'];
        if (valorSynonyms.includes(normCabecalho)) {
            for (const synonym of valorSynonyms) {
                for (const [key, letter] of Object.entries(colHeaderMap)) {
                    if (key.trim().toLowerCase() === synonym) {
                        return letter;
                    }
                }
            }
        }

        return null;
    }

    function colLetterToIndex(colLetter) {
        let index = 0;
        for (let i = 0; i < colLetter.length; i++) {
            index = index * 26 + (colLetter.charCodeAt(i) - 64);
        }
        return index;
    }

function dataParaSerialExcel(dataStr) {
    if (dataStr === null || dataStr === undefined) return null;
    const str = String(dataStr).trim();
    if (!str) return null;

    let d, m, y;
    const matchBr = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (matchBr) {
        d = parseInt(matchBr[1], 10);
        m = parseInt(matchBr[2], 10);
        y = parseInt(matchBr[3], 10);
    } else {
        const matchIso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (matchIso) {
            y = parseInt(matchIso[1], 10);
            m = parseInt(matchIso[2], 10);
            d = parseInt(matchIso[3], 10);
        }
    }
    if (!d || !m || !y) return null;
    if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2100) return null;

    const dt = new Date(Date.UTC(y, m - 1, d));
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const diffDays = Math.round((dt - epoch) / (24 * 60 * 60 * 1000));
    return diffDays > 0 ? diffDays : null;
}

    function atualizarDadosDaGuia(sheetXmlContent, linhas) {
        if (!linhas || linhas.length === 0) return sheetXmlContent;

        const colHeaderMap = {};
        const cellRegex = /<c r="([A-Z]+)1"[^>]*>([\s\S]*?)<\/c>/g;
        let cellMatch;
        while ((cellMatch = cellRegex.exec(sheetXmlContent)) !== null) {
            const colLetter = cellMatch[1];
            const cellBody = cellMatch[2];
            let headerText = '';
            if (cellBody.includes('<is><t>')) {
                const tm = /<is><t>([^<]*)<\/t><\/is>/.exec(cellBody);
                if (tm) headerText = tm[1];
            } else if (cellBody.includes('<v>')) {
                const vm = /<v>(\d+)<\/v>/.exec(cellBody);
                if (vm && sharedStrings[parseInt(vm[1])]) {
                    headerText = sharedStrings[parseInt(vm[1])];
                }
            }
            if (headerText) {
                colHeaderMap[headerText.trim()] = colLetter;
            }
        }

        let newSheetXml = sheetXmlContent.replace(/<row r="([2-9]|\d{2,})"[^>]*>[\s\S]*?<\/row>/g, '');

        let rowsXml = '';
        for (let i = 0; i < linhas.length; i++) {
            const rowNum = i + 2;
            const linhaObj = linhas[i];
            let rowXml = `<row r="${rowNum}">`;

            const cells = [];
            for (const [cabecalho, valor] of Object.entries(linhaObj)) {
                const colLetter = obterLetraColuna(colHeaderMap, cabecalho);
                if (colLetter) {
                    const cellRef = `${colLetter}${rowNum}`;
                    let cellXml = '';
                    if (typeof valor === 'number') {
                        cellXml = `<c r="${cellRef}"><v>${valor}</v></c>`;
                    } else if (valor !== '' && valor !== null && valor !== undefined) {
                        const serialDate = dataParaSerialExcel(valor);
                        if (serialDate !== null && (cabecalho.toLowerCase().includes('data') || cabecalho.toLowerCase().includes('vencimento'))) {
                            cellXml = `<c r="${cellRef}" s="4"><v>${serialDate}</v></c>`;
                        } else {
                            cellXml = `<c r="${cellRef}" t="inlineStr"><is><t>${escapeHtml(valor)}</t></is></c>`;
                        }
                    }
                    if (cellXml) {
                        cells.push({ colLetter, cellXml });
                    }
                }
            }

            // OpenXML strictly requires cells inside a row to be sorted alphabetically by cell reference
            cells.sort((a, b) => colLetterToIndex(a.colLetter) - colLetterToIndex(b.colLetter));
            
            rowXml += cells.map(c => c.cellXml).join('');
            rowXml += '</row>';
            rowsXml += rowXml;
        }

        return newSheetXml.replace('</sheetData>', `${rowsXml}</sheetData>`);
    }

    for (const [nomeGuia, linhas] of Object.entries(linhasPorGuia)) {
        const sheetXmlPath = sheetMap[nomeGuia];
        if (sheetXmlPath && zip.file(sheetXmlPath)) {
            const origSheetXml = await zip.file(sheetXmlPath).async('text');
            const updatedSheetXml = atualizarDadosDaGuia(origSheetXml, linhas);
            zip.file(sheetXmlPath, updatedSheetXml);
        }
    }

    const nomeGuiaDare = configPerfil?.configuracoes_fixas?.guia_dare || 'Marcar DARE';
    if (nomeGuiaDare && linhasDare && linhasDare.length > 0) {
        const sheetDareXmlPath = sheetMap[nomeGuiaDare];
        if (sheetDareXmlPath && zip.file(sheetDareXmlPath)) {
            const origSheetXml = await zip.file(sheetDareXmlPath).async('text');
            const updatedSheetXml = atualizarDadosDaGuia(origSheetXml, linhasDare);
            zip.file(sheetDareXmlPath, updatedSheetXml);
        }
    }

    const finalBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(caminhoSaida, finalBuf);
    return { caminho: caminhoSaida };
}

async function exportarPlanilhaBackupXls(caminhoSaida, linhasPorGuia, linhasDare, configPerfil) {
    const workbook = new ExcelJS.Workbook();
    let totalLinhas = 0;

    for (const [nomeGuia, linhas] of Object.entries(linhasPorGuia)) {
        const sheet = workbook.addWorksheet(nomeGuia);
        if (linhas.length > 0) {
            const cabecalhos = Object.keys(linhas[0]);
            sheet.addRow(cabecalhos);
            
            const headerRow = sheet.getRow(1);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF4F81BD' }
            };

            for (const linha of linhas) {
                const values = cabecalhos.map(c => linha[c]);
                sheet.addRow(values);
                totalLinhas++;
            }
        }
    }

    const nomeGuiaDare = configPerfil.configuracoes_fixas['guia_dare'] || 'Marcar DARE';
    if (linhasDare && linhasDare.length > 0) {
        const sheetDare = workbook.addWorksheet(nomeGuiaDare);
        const cabecalhos = Object.keys(linhasDare[0]);
        sheetDare.addRow(cabecalhos);
        
        const headerRowDare = sheetDare.getRow(1);
        headerRowDare.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRowDare.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F81BD' }
        };

        for (const linha of linhasDare) {
            const values = cabecalhos.map(c => linha[c]);
            sheetDare.addRow(values);
            totalLinhas++;
        }
    }

    await workbook.xlsx.writeFile(caminhoSaida);
    return { caminho: caminhoSaida, totalLinhas };
}

function montarHtmlRelatorio(processos, falhas, configPerfil) {
    const css = `
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #172033; font-size: 13px; margin: 0; padding: 0; background: #ffffff; }
        .page { page-break-after: always; padding: 24px; box-sizing: border-box; min-height: 100vh; }
        .page:last-child { page-break-after: auto; }
        h1 { font-size: 20px; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; margin: 0 0 18px 0; line-height: 1.3; }
        h2 { font-size: 15px; color: #1f2937; margin-top: 18px; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
        .field { border: 1px solid #d7dee8; border-radius: 4px; padding: 7px 9px; min-height: 48px; background: #ffffff; display: flex; flex-direction: column; justify-content: center; }
        .label { color: #607083; font-size: 10px; font-weight: 700; text-transform: uppercase; margin-bottom: 3px; display: block; letter-spacing: 0.03em; }
        .value { color: #111827; font-size: 12px; word-break: break-word; line-height: 1.3; }
        .table-dares { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
        .table-dares th, .table-dares td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; }
        .table-dares th { background-color: #f1f5f9; font-weight: 700; color: #334155; text-transform: uppercase; font-size: 10px; }
        .alerta-confianca { background: #fef2f2; border: 2px solid #dc2626; color: #991b1b; padding: 12px; font-weight: 700; text-align: center; border-radius: 6px; margin-bottom: 18px; font-size: 13px; }
        .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; float: right; }
        .badge.green { background-color: #dcfce7; color: #166534; }
        .badge.red { background-color: #fee2e2; color: #991b1b; }
        .analise-text { white-space: pre-wrap; background: #f8fafc; padding: 12px; border: 1px solid #cbd5e1; border-radius: 4px; line-height: 1.4; color: #0f172a; }
        .falha-item { background: #fef2f2; border-left: 4px solid #ef4444; padding: 10px; margin-bottom: 10px; border-radius: 0 4px 4px 0; }
    `;

    const limiar_confianca = configPerfil?.configuracoes_fixas?.limiar_confianca || 0.80;

    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>`;

    for (const processo of processos) {
        const confianca = processo.confianca_geral || 0;
        const confiancaPercent = (confianca * 100).toFixed(0);
        const isBaixaConfianca = confianca < limiar_confianca;

        html += `<article class="page">`;
        
        if (isBaixaConfianca) {
            html += `<div class="alerta-confianca">⚠️ ATENÇÃO: Análise de Baixa Confiança (${confiancaPercent}%) - Revisão Humana Obrigatória</div>`;
        }

        const badgeClass = isBaixaConfianca ? 'red' : 'green';
        html += `<h1>Relatório de Análise de Restituição <span class="badge ${badgeClass}">Confiança: ${confiancaPercent}%</span></h1>`;
        
        html += `<div class="grid">
            <div class="field"><span class="label">Processo SEI</span><span class="value">${escapeHtml(processo._processo_sei || processo.processo_sei)}</span></div>
            <div class="field"><span class="label">Tipo de Processo</span><span class="value">${escapeHtml(processo.tipo_processo)}</span></div>
        </div>`;

        html += `<h2>Dados do Processo</h2>`;
        html += `<div class="grid">
            <div class="field"><span class="label">Número Processo Judicial</span><span class="value">${escapeHtml(processo.numero_processo_judicial)}</span></div>
        </div>`;

        const contribuinte = processo.contribuinte || processo.acusado || {};
        html += `<h2>Contribuinte / Acusado</h2>`;
        html += `<div class="grid">
            <div class="field"><span class="label">Nome Completo</span><span class="value">${escapeHtml(contribuinte.nome_completo)}</span></div>
            <div class="field"><span class="label">CPF/CNPJ</span><span class="value">${escapeHtml(contribuinte['cpf/cnpj'] || contribuinte.cpf_cnpj)}</span></div>
        </div>`;

        const beneficiario = processo.beneficiario || {};
        html += `<h2>Beneficiário</h2>`;
        html += `<div class="grid">
            <div class="field"><span class="label">Nome Completo</span><span class="value">${escapeHtml(beneficiario.nome_completo)}</span></div>
            <div class="field"><span class="label">CPF/CNPJ</span><span class="value">${escapeHtml(beneficiario['cpf/cnpj'] || beneficiario.cpf_cnpj)}</span></div>
        </div>`;

        const conta = processo.conta_bancaria_restituicao || {};
        html += `<h2>Conta Bancária</h2>`;
        html += `<div class="grid">
            <div class="field"><span class="label">Titular</span><span class="value">${escapeHtml(conta.titular)}</span></div>
            <div class="field"><span class="label">CPF/CNPJ Titular</span><span class="value">${escapeHtml(conta.cpf_cnpj_titular)}</span></div>
            <div class="field"><span class="label">Banco (Código - Nome)</span><span class="value">${escapeHtml(conta.banco_codigo)} - ${escapeHtml(conta.banco_nome)}</span></div>
            <div class="field"><span class="label">Agência</span><span class="value">${escapeHtml(conta.agencia)}</span></div>
            <div class="field"><span class="label">Conta</span><span class="value">${escapeHtml(conta.conta)}</span></div>
            <div class="field"><span class="label">Tipo de Conta</span><span class="value">${escapeHtml(conta.tipo_conta)}</span></div>
            <div class="field"><span class="label">Titular Confere com Beneficiário?</span><span class="value">${conta.titular_confere_com_beneficiario ? 'Sim' : 'Não'}</span></div>
        </div>`;

        html += `<h2>DAREs Recolhidos</h2>`;
        const dares = Array.isArray(processo.dares_recolhidos) ? processo.dares_recolhidos : [];
        if (dares.length > 0) {
            html += `<table class="table-dares">
                <thead><tr><th>Número DARE</th><th>Data Pagamento</th><th>Valor</th></tr></thead>
                <tbody>`;
            for (const dare of dares) {
                const val = dare.valor_restituir !== undefined && dare.valor_restituir !== null ? dare.valor_restituir : dare.valor_pago;
                html += `<tr>
                    <td>${escapeHtml(dare.numero_dare)}</td>
                    <td>${escapeHtml(formatarData(dare.data_pagamento))}</td>
                    <td>${escapeHtml(formatarMoeda(val))}</td>
                </tr>`;
            }
            html += `</tbody></table>`;
        } else {
            html += `<div class="field"><span class="label">Status DARE</span><span class="value">Nenhum DARE recolhido encontrado.</span></div>`;
        }

        const analise = processo.analise || {};
        html += `<h2>Parecer de Conformidade</h2>`;
        html += `<div class="analise-text">${escapeHtml(analise || 'Sem análise disponível.')}</div>`;

        html += `</article>`;
    }

    if (falhas && falhas.length > 0) {
        html += `<article class="page">`;
        html += `<h1>Falhas na Extração</h1>`;
        for (const falha of falhas) {
            html += `<div class="falha-item">
                <span class="label">Arquivo: ${escapeHtml(falha.arquivo)}</span>
                <span class="label">Processo SEI: ${escapeHtml(falha.processoSei)}</span>
                <div class="value">Erro: ${escapeHtml(falha.erro)}</div>
            </div>`;
        }
        html += `</article>`;
    }

    html += `</body></html>`;
    return html;
}

async function exportarPdfRelatorio(caminhoArquivo, processos, falhas, configPerfil) {
    const html = montarHtmlRelatorio(processos, falhas, configPerfil);
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        await page.pdf({
            path: caminhoArquivo,
            format: 'A4',
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        });
        return { caminho: caminhoArquivo, processos: processos.length, falhas: falhas.length };
    } finally {
        await browser.close();
    }
}

async function exportarRelatoriosRestituicoes(diretorios, resultadoExtracao, configPerfil, caminhoModeloXlsm) {
    const { processos, falhas } = normalizarProcessos(resultadoExtracao);
    const { linhasPorGuia, alertasMultiplosDares } = montarLinhasGuiaPrincipal(processos, configPerfil);
    const linhasDare = montarLinhasGuiaDare(processos, configPerfil);

    const hora = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');

    if (!fs.existsSync(diretorios.planilhas)) fs.mkdirSync(diretorios.planilhas, { recursive: true });
    if (!fs.existsSync(diretorios.evidencias)) fs.mkdirSync(diretorios.evidencias, { recursive: true });

    let xlsmResult = null;
    if (caminhoModeloXlsm && fs.existsSync(caminhoModeloXlsm)) {
        const caminhoSaidaXlsm = path.join(diretorios.planilhas, `restituicoes_analise_${hora}.xlsm`);
        xlsmResult = await gravarDadosNaPlanilhaXlsm(caminhoModeloXlsm, caminhoSaidaXlsm, linhasPorGuia, linhasDare, configPerfil);
    }

    const backupsXls = [];
    for (const tipoGuia of Object.keys(linhasPorGuia)) {
        const caminhoSaidaXlsx = path.join(diretorios.planilhas, `${tipoGuia.toLowerCase().replace(/\s+/g, '_')}_backup_${hora}.xlsx`);
        const resXlsx = await exportarPlanilhaBackupXls(caminhoSaidaXlsx, { [tipoGuia]: linhasPorGuia[tipoGuia] }, linhasDare, configPerfil);
        backupsXls.push(resXlsx);
    }

    const modoPdf = configPerfil?.configuracoes_fixas?.modo_exportacao_pdf || 'individual';
    const relatoriosPdf = [];

    if (modoPdf === 'unico' && processos.length > 0) {
        const nomeArquivo = `Relatorio_Restituicoes_Lote_${hora}.pdf`;
        const caminhoPdf = path.join(diretorios.evidencias, nomeArquivo);
        const resPdf = await exportarPdfRelatorio(caminhoPdf, processos, falhas, configPerfil);
        relatoriosPdf.push(resPdf);
    } else {
        for (const processo of processos) {
            const nomeArquivo = `Relatorio_Restituicao_SEI_${processo._processo_sei || 'Desconhecido'}_${hora}.pdf`;
            const caminhoPdf = path.join(diretorios.evidencias, nomeArquivo);
            const resPdf = await exportarPdfRelatorio(caminhoPdf, [processo], [], configPerfil);
            relatoriosPdf.push(resPdf);
        }

        if (falhas.length > 0) {
            const caminhoPdfFalhas = path.join(diretorios.evidencias, `Relatorio_Falhas_Restituicoes_${hora}.pdf`);
            const resFalhas = await exportarPdfRelatorio(caminhoPdfFalhas, [], falhas, configPerfil);
            relatoriosPdf.push(resFalhas);
        }
    }

    return {
        xlsm: xlsmResult,
        backupsXls,
        relatoriosPdf,
        alertasMultiplosDares
    };
}

module.exports = {
    extrairProcessoSei,
    normalizarRespostaN8n,
    normalizarProcessos,
    resolverChaveMapeamentoGuia,
    resolverNomeGuia,
    extrairValorProcesso,
    extrairValorMunicipio,
    montarLinhasGuiaPrincipal,
    montarLinhasGuiaDare,
    gravarDadosNaPlanilhaXlsm,
    exportarPlanilhaBackupXls,
    montarHtmlRelatorio,
    exportarPdfRelatorio,
    exportarRelatoriosRestituicoes
};
