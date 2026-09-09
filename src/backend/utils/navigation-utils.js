const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function obterDataHoje() {
    const hoje = new Date();
    return new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0));
}

function tratarData(valorExcel) {
    if (valorExcel === null || valorExcel === undefined || valorExcel === '') {
        return null;
    }

    // Se o Excel devolver número serial (ex: 45300)
    if (typeof valorExcel === 'number') {
        const data = new Date(Math.round((valorExcel - 25569) * 86400 * 1000));
        return data; // Já normalizado em UTC meia-noite
    }

    // Se já for um objeto Date
    if (valorExcel instanceof Date) {
        if (isNaN(valorExcel.getTime())) return null;
        // Se for UTC meia-noite exata (típico de células de data lidas pelo ExcelJS)
        if (valorExcel.getUTCHours() === 0 && valorExcel.getUTCMinutes() === 0 && valorExcel.getUTCSeconds() === 0 && valorExcel.getUTCMilliseconds() === 0) {
            return valorExcel;
        }
        // Se tiver hora (ex: new Date() gerado no fuso local), o dia civil pretendido é a data local do operador
        return new Date(Date.UTC(valorExcel.getFullYear(), valorExcel.getMonth(), valorExcel.getDate(), 0, 0, 0));
    }

    // Se for string
    if (typeof valorExcel === 'string') {
        const str = valorExcel.trim();
        if (!str) return null;

        // Formato brasileiro: DD/MM/YYYY ou DD-MM-YYYY (com hora opcional)
        let m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (m) {
            const dia = parseInt(m[1], 10);
            const mes = parseInt(m[2], 10);
            const ano = parseInt(m[3], 10);
            return new Date(Date.UTC(ano, mes - 1, dia, 0, 0, 0));
        }

        // Formato ISO: YYYY-MM-DD
        m = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (m) {
            const ano = parseInt(m[1], 10);
            const mes = parseInt(m[2], 10);
            const dia = parseInt(m[3], 10);
            return new Date(Date.UTC(ano, mes - 1, dia, 0, 0, 0));
        }

        // Fallback para outros formatos de string parseáveis
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
            return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0));
        }
    }

    return null;
}

/**
 * Converte um objeto Date (ou valor aceito pelo construtor Date) para a
 * string esperada pelos campos mascarados do tipo "dd/mm/aaaa".
 *
 * @param {Date|string|number} data - data a ser formatada
 * @returns {string} data no formato dd/mm/yyyy
 */
function formatarData(data) {
    if (!data) return '';
    const d = (data instanceof Date) ? tratarData(data) : tratarData(data);
    if (!d || isNaN(d.getTime())) return '';
    // Use UTC components para manter fidelidade ao dia civil normalizado
    const dia = String(d.getUTCDate()).padStart(2, '0');
    const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
    const ano = d.getUTCFullYear();
    return `${dia}/${mes}/${ano}`;
}

function formatarMoeda(valor) {
    if (valor === null || valor === undefined || valor === '') return '0,00';

    let numero;
    if (typeof valor === 'number') {
        numero = valor;
    } else {
        let str = String(valor).replace(/R\$/gi, '').trim();
        if (str.includes(',') && str.includes('.')) {
            if (str.indexOf('.') < str.indexOf(',')) {
                // Formato pt-BR: 2.063,90
                str = str.replace(/\./g, '').replace(',', '.');
            } else {
                // Formato en-US: 2,063.90
                str = str.replace(/,/g, '');
            }
        } else if (str.includes(',')) {
            str = str.replace(',', '.');
        }
        numero = parseFloat(str);
    }

    if (isNaN(numero)) return '0,00';
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numero);
}

// Faz o slice de forma segura (retorna vazio se for null/undefined)
const safeSlice = (valor, inicio, fim) => {
    if (!valor) return '';
    const str = String(valor);
    return str.slice(inicio, fim !== undefined ? fim : str.length);
};

module.exports = { delay, tratarData, formatarMoeda, formatarData, safeSlice, obterDataHoje };