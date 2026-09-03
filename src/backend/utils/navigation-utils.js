const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function tratarData(valorExcel) {
    // Se o Excel devolver número serial (ex: 45300)
    if (typeof valorExcel === 'number') {
        const data = new Date(Math.round((valorExcel - 25569) * 86400 * 1000));
        data.setMinutes(data.getMinutes() + data.getTimezoneOffset()); // Ajuste fuso
        return data;
    }
    // Se for string "2024-01-22" ou "22/01/2024"
    const data = new Date(valorExcel);
    return data; // Retorna objeto Date do JS
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
    if (!(data instanceof Date)) {
        data = new Date(data);
    }
    // Use UTC components so que a conversão não seja afetada pelo fuso local
    const dia = String(data.getUTCDate()).padStart(2, '0');
    const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
    const ano = data.getUTCFullYear();
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

module.exports = { delay, tratarData, formatarMoeda, formatarData, safeSlice };