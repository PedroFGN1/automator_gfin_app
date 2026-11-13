const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Extrai dados essenciais (ID do Depósito, Observação/SEI e Processo Judicial) de uma Guia de Depósito da Caixa (PDF).
 * Funciona de forma 100% nativa utilizando zlib do Node.js, sem dependências externas.
 *
 * @param {string|Buffer} entradaPdf - Caminho absoluto do arquivo PDF ou Buffer do arquivo.
 * @returns {{ idDeposito: string, observacao: string, processo: string, arquivoOrigem: string }}
 */
function extrairDadosGuiaPdf(entradaPdf) {
    let buf;
    let nomeArquivo = '';

    if (typeof entradaPdf === 'string') {
        if (!fs.existsSync(entradaPdf)) {
            throw new Error(`Arquivo PDF não encontrado: ${entradaPdf}`);
        }
        buf = fs.readFileSync(entradaPdf);
        nomeArquivo = path.basename(entradaPdf, path.extname(entradaPdf));
    } else if (Buffer.isBuffer(entradaPdf)) {
        buf = entradaPdf;
    } else {
        throw new Error('Entrada inválida para extração de guia PDF. Esperado caminho ou Buffer.');
    }

    let idDeposito = '';
    let observacao = '';
    let processo = '';

    let pos = 0;
    while (pos < buf.length) {
        const streamStart = buf.indexOf('stream', pos);
        if (streamStart === -1) break;

        const streamEnd = buf.indexOf('endstream', streamStart);
        if (streamEnd === -1) break;

        // Ajusta cabeçalho do stream (pula "stream\r\n" ou "stream\n")
        let offset = streamStart + 6;
        if (buf[offset] === 13) offset++; // \r
        if (buf[offset] === 10) offset++; // \n

        const streamSlice = buf.slice(offset, streamEnd);

        try {
            const decompressed = zlib.inflateSync(streamSlice);
            const contentStr = decompressed.toString('latin1');

            // 1. ID de Depósito (campo txtTedJudicialId / txtTedJudicialId2 ou tag de texto visual)
            if (!idDeposito) {
                const matchIdForm = contentStr.match(/txtTedJudicialId\d*.*?\/V\s*\((040\d{12,18})\)/s);
                if (matchIdForm) {
                    idDeposito = matchIdForm[1];
                } else {
                    const matchIdTj = contentStr.match(/\((040\d{12,18})\)\s*Tj/);
                    if (matchIdTj) {
                        idDeposito = matchIdTj[1];
                    }
                }
            }

            // 2. Observação / Processo SEI
            if (!observacao) {
                // Em formulário AcroForm, frequentemente vem em notação hexadecimal <534549...>
                const matchObsHex = contentStr.match(/txtObservacao\d*.*?\/V\s*<([0-9a-fA-F]+)>/s);
                if (matchObsHex) {
                    const decoded = Buffer.from(matchObsHex[1], 'hex').toString('latin1').trim();
                    if (decoded) observacao = decoded;
                }

                // Ou em notação de string literal (SEI - ...)
                if (!observacao) {
                    const matchObsStr = contentStr.match(/txtObservacao\d*.*?\/V\s*\((.*?)\)/s);
                    if (matchObsStr && matchObsStr[1].trim()) {
                        observacao = matchObsStr[1].trim();
                    }
                }
            }

            // 3. Processo Judicial (20 dígitos numéricos CNJ)
            if (!processo) {
                const matchProcForm = contentStr.match(/txtProcesso\d*.*?\/V\s*\(([0-9]{20})\)/s);
                if (matchProcForm) {
                    processo = formatarProcessoCnj(matchProcForm[1]);
                } else {
                    const matchProcTj = contentStr.match(/\(([0-9]{20})\)\s*Tj/);
                    if (matchProcTj) {
                        processo = formatarProcessoCnj(matchProcTj[1]);
                    }
                }
            }
        } catch (_) {
            // Ignora streams que não são FlateDecode comprimidos ou são imagens/fontes binárias
        }

        pos = streamEnd + 9;
    }

    // Fallback para observação caso não venha expressa dentro do PDF:
    // utiliza o nome do próprio arquivo PDF (ex: "SEI - 202600004052861 - Goiânia.pdf")
    if (!observacao && nomeArquivo) {
        observacao = nomeArquivo.trim();
    }

    return {
        idDeposito: idDeposito ? idDeposito.trim() : '',
        observacao: observacao ? observacao.trim() : '',
        processo: processo ? processo.trim() : '',
        arquivoOrigem: nomeArquivo ? `${nomeArquivo}.pdf` : ''
    };
}

/**
 * Formata processo com 20 dígitos para o formato padrão CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO
 */
function formatarProcessoCnj(proc) {
    const limpo = String(proc || '').replace(/\D/g, '');
    if (limpo.length !== 20) return proc;
    // Ex: 5692205 60 2022 8 09 0051 -> 5692205-60.2022.8.09.0051
    return `${limpo.slice(0, 7)}-${limpo.slice(7, 9)}.${limpo.slice(9, 13)}.${limpo.slice(13, 14)}.${limpo.slice(14, 16)}.${limpo.slice(16, 20)}`;
}

module.exports = {
    extrairDadosGuiaPdf,
    formatarProcessoCnj
};
