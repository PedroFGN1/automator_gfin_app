const { extrairDadosBoleto } = require('../src/backend/utils/angular-utils');

describe('Extração de Código de Barras e ID de Depósito da tela de Boleto', () => {
    test('Deve extrair ID de Depósito e Código de Barras corretamente do texto real da Caixa', () => {
        const textoRealCaixa = `
Caixa Jud - Soluções para o Judiciário
Serviços para o Judiciário
Depósito
Judicial
Competência
Dados do Depósito
Pagamento
Boleto
Validação do Processo
Natureza do Depósito
Informações do Depósito
Confirmação de dados
Forma de Pagamento
Emissão de Guia de Depósito
Depósito Judicial - Justiça Estadual
Seu ID de Depósito foi gerado com sucesso no valor de: R$ 2.063,90
10498392757300010004718514531120615870000206390
Este é o ID do seu depósito: 040253501662609038
Conta Judicial: Ag: 2535 / Op: 040 / Conta: 02227108-6

Importante: Antes de acessar o Internet Banking não esqueça de copiar o ID do seu depósito.

Copiar o Código de Barra
Ver boleto bancário
Acessar o Internet Banking
Novo Depósito
        `;

        const resultado = extrairDadosBoleto(textoRealCaixa);

        expect(resultado.codigoBarra).toBe('10498392757300010004718514531120615870000206390');
        expect(resultado.idDeposito).toBe('040253501662609038');
        // Garante que o ID de depósito NÃO é prefixo nem pedaço do código de barras
        expect(resultado.codigoBarra.startsWith(resultado.idDeposito)).toBe(false);
    });

    test('Deve suportar variações no rótulo de ID (sem acento, com traço ou quebra de linha)', () => {
        const textoVariacao = `
Linha Digitável: 10498392757300010004718514531120615870000206390
ID do seu deposito - 040253501662609038
        `;

        const resultado = extrairDadosBoleto(textoVariacao);

        expect(resultado.codigoBarra).toBe('10498392757300010004718514531120615870000206390');
        expect(resultado.idDeposito).toBe('040253501662609038');
    });

    test('Deve extrair via elementos folha se o texto completo estiver fragmentado', () => {
        const folhas = [
            { texto: 'Código de Barra', tag: 'SPAN' },
            { texto: '10498392757300010004718514531120615870000206390', tag: 'SPAN' },
            { texto: 'Este é o ID do seu depósito: ', tag: 'SPAN' },
            { texto: '040253501662609038', tag: 'STRONG' }
        ];

        const resultado = extrairDadosBoleto('', folhas);

        expect(resultado.codigoBarra).toBe('10498392757300010004718514531120615870000206390');
        expect(resultado.idDeposito).toBe('040253501662609038');
    });

    test('Não deve atribuir pedaço do código de barras como ID_DEPOSITO se o ID não for encontrado', () => {
        const textoSemId = `
10498392757300010004718514531120615870000206390
Boleto emitido com sucesso
        `;

        const resultado = extrairDadosBoleto(textoSemId);

        expect(resultado.codigoBarra).toBe('10498392757300010004718514531120615870000206390');
        expect(resultado.idDeposito).toBe('');
    });
});
