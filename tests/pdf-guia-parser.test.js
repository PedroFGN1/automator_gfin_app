const path = require('path');
const { extrairDadosGuiaPdf, formatarProcessoCnj } = require('../src/backend/utils/pdf-guia-parser');

describe('Parser Nativo de Guias Judiciais em PDF', () => {
    const caminhoGuiaExemplo = path.join(__dirname, '..', 'SEI - 202600004052861 - Goiânia.pdf');

    test('Deve extrair ID de Depósito, Observação e Processo da guia PDF de exemplo', () => {
        const dados = extrairDadosGuiaPdf(caminhoGuiaExemplo);

        expect(dados).toBeDefined();
        expect(dados.idDeposito).toBe('040253501912609030');
        expect(dados.observacao).toBe('SEI - 202600004052861 - Goiânia');
        expect(dados.processo).toBe('5692205-60.2022.8.09.0051');
        expect(dados.arquivoOrigem).toBe('SEI - 202600004052861 - Goiânia.pdf');
    });

    test('Deve formatar processo numérico de 20 dígitos no padrão CNJ', () => {
        const formatado = formatarProcessoCnj('56922056020228090051');
        expect(formatado).toBe('5692205-60.2022.8.09.0051');
    });

    test('Deve manter inalterado processos que já contenham formatação ou tamanho diferente de 20', () => {
        expect(formatarProcessoCnj('5692205-60.2022.8.09.0051')).toBe('5692205-60.2022.8.09.0051');
        expect(formatarProcessoCnj('12345')).toBe('12345');
    });
});
