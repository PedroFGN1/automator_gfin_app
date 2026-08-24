const fs = require('fs');
const pdf = require('pdf-parse');

/**
 * Normaliza textos extraídos de PDFs com falhas de mapeamento de fontes (ex: TrueType com CMap 16-bit).
 * Trata o byte swap de UTF-16 BE e glifos corrompidos recorrentes.
 */
function normalizarTextoPdf(texto) {
    if (!texto) return '';
    // Substitui a sequência de escape corrompida do dígito '2' (\u1100 ou (\u1100))
    let s = texto.replace(/\(\u1100\)/g, '2').replace(/\u1100/g, '2');
    let resultado = '';
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        // Corrige caracteres onde o byte alto contém o caractere ASCII imprimível (0x20 a 0x7E)
        if ((code & 0xFF) === 0 && (code >> 8) >= 0x20 && (code >> 8) <= 0x7E) {
            resultado += String.fromCharCode(code >> 8);
        } else {
            resultado += s[i];
        }
    }
    return resultado;
}

/**
 * Processa um ou mais PDFs de certidões e extrai os dados baseados em Regex.
 * 
 * @param {Array<string|Buffer>} pdfInputs - Caminhos dos arquivos PDF ou Buffers.
 * @param {Object} config - Objeto de configuração de busca e regras.
 * @returns {Promise<Object>} Dados extraídos e categorizados.
 */
async function extrairCertidoes(pdfInputs, config) {
    const resultados = {
        negativa: [],
        positiva: []
    };

    // Garante que o input seja um array (mesmo se passar apenas um arquivo)
    const files = Array.isArray(pdfInputs) ? pdfInputs : [pdfInputs];

    for (const file of files) {
        let dataBuffer;
        if (Buffer.isBuffer(file)) {
            dataBuffer = file;
        } else if (typeof file === 'string') {
            dataBuffer = fs.readFileSync(file);
        } else {
            throw new Error('O input deve ser um caminho de arquivo (string) ou um Buffer.');
        }

        // Função customizada para renderizar o PDF página por página e inserir um delimitador.
        // Isso garante que o texto não se misture entre certidões diferentes.
        const renderPage = async function(pageData) {
            const textContent = await pageData.getTextContent();
            let text = '';
            let lastY = null;

            for (let item of textContent.items) {
                // Preserva quebras de linha baseadas na posição Y (ajuda na precisão do Regex)
                if (lastY !== item.transform[5] && lastY !== null) {
                    text += '\n';
                }
                text += normalizarTextoPdf(item.str);
                lastY = item.transform[5];
            }
            return text + '\n---FIM_DA_PAGINA---\n';
        };

        const options = { pagerender: renderPage };
        const pdfData = await pdf(dataBuffer, options);

        // Divide o texto do PDF inteiro em um array de páginas
        const pages = pdfData.text.split('---FIM_DA_PAGINA---').filter(p => p.trim().length > 0);

        for (const pageText of pages) {
            const certidao = {};
            //console.log(pageText); // Log para depuração do texto extraído
            // 1. Extrair dinamicamente os campos configurados
            for (const [chave, padraoRegex] of Object.entries(config.campos)) {
                // Aceita flags opcionais no config, padrão 'i' (case insensitive)
                const regex = new RegExp(padraoRegex, config.flags || 'i');
                const match = pageText.match(regex);
                //console.log(`Regex para ${chave}:`, regex); // Log do regex para depuração
                //console.log(`Match para ${chave}:`, match); // Log do match para depuração

                if (match) {
                    // Se o Regex tiver grupo de captura ex: "(.*)", pega o grupo 1, senão o match inteiro
                    certidao[chave] = match[1] ? match[1].trim() : match[0].trim();
                    certidao[chave] = certidao[chave].replace(/\s+/g, ' '); // Normaliza espaços
                    //console.log(`Valor extraído para ${chave}:`, certidao[chave]); // Log do valor extraído para depuração
                } else {
                    certidao[chave] = null;
                }
            }

            // Ignorar páginas em branco ou que não possuam nenhum dos dados vitais
            if (!certidao.cpf_cnpj && !certidao.nome) continue;

            // 2. Classificar o status dinamicamente com base nas regras do config
            let status = 'positiva'; // Fallback padrão
            
            if (certidao[config.chaveStatus]) {
                const textoSituacao = certidao[config.chaveStatus].toLowerCase();
                
                // Verifica se o texto extraído contém as palavras-chave de "negativa"
                const isNegativa = config.regras.negativa.some(regra => 
                    textoSituacao.includes(regra.toLowerCase())
                );

                if (isNegativa) {
                    status = 'negativa';
                }
            }

            // Adiciona a certidão no grupo correspondente
            resultados[status].push(certidao);
        }
    }

    return resultados;
}

module.exports = { extrairCertidoes };