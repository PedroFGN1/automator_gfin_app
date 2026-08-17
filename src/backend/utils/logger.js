const fs = require('fs');
const path = require('path');

function gravarLogSistema(mensagem) {
    const dataHoje = new Date().toISOString().split('T')[0]; // 2024-01-26
    const pastaLogs = path.join(process.cwd(), 'logs');
    
    // Cria pasta logs se não existir
    if (!fs.existsSync(pastaLogs)) {
        fs.mkdirSync(pastaLogs, { recursive: true });
    }

    const hora = new Date().toLocaleTimeString();
    const linhaLog = `[${hora}] ${mensagem}\n`;
    const arquivoLog = path.join(pastaLogs, `sistema-${dataHoje}.log`);

    // Adiciona ao final do arquivo
    fs.appendFile(arquivoLog, linhaLog, (err) => {
        if (err) console.error('Falha ao gravar log em disco:', err);
    });
}

module.exports = { gravarLogSistema };