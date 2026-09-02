const { executarRestituicaoDeducaoReceita } = require('../src/backend/bots/restituicao-deducao-receita');
const fileUtils = require('../src/backend/utils/file-utils');
const pptUtils = require('../src/backend/utils/puppeteer-utils');
const navUtils = require('../src/backend/utils/navigation-utils');
const logger = require('../src/backend/utils/logger');
const puppeteer = require('puppeteer');
const { dialog } = require('electron');

jest.mock('../src/backend/utils/file-utils');
jest.mock('../src/backend/utils/puppeteer-utils');
jest.mock('../src/backend/utils/navigation-utils');
jest.mock('../src/backend/utils/logger');
jest.mock('puppeteer');
jest.mock('electron', () => ({
    dialog: {
        showMessageBox: jest.fn()
    }
}));

describe('Bot: Restituição - Dedução de Receita com Restituição de Recursos (86)', () => {
    let mockPage;
    let mockBrowser;
    let mockContexto;
    let mockConfigPerfil;
    let mockLogs;
    let enviarLog;

    beforeEach(() => {
        jest.clearAllMocks();
        mockLogs = [];
        enviarLog = (msg) => mockLogs.push(msg);

        mockContexto = {
            $: jest.fn().mockImplementation((selector) => {
                if (selector.includes('Continuar') || selector.includes('Avancar')) {
                    return Promise.resolve({ click: jest.fn().mockResolvedValue(true) });
                }
                if (selector.includes('Incluir')) {
                    return Promise.resolve({ click: jest.fn().mockResolvedValue(true) });
                }
                if (selector.includes('Sim') || selector.includes('Confirmar')) {
                    return Promise.resolve({ click: jest.fn().mockResolvedValue(true) });
                }
                if (selector.includes('cboDDRDebito') || selector.includes('cboNomeFonteDebito')) {
                    return Promise.resolve({ name: 'cboDDRDebito' });
                }
                return Promise.resolve(null);
            }),
            keyboard: {
                press: jest.fn().mockResolvedValue(true)
            },
            evaluate: jest.fn().mockResolvedValue(true)
        };

        mockPage = {
            goto: jest.fn().mockResolvedValue(true),
            waitForNavigation: jest.fn().mockResolvedValue(true),
            waitForSelector: jest.fn().mockResolvedValue(true),
            $eval: jest.fn().mockImplementation((selector) => {
                if (selector === '.titulo2') {
                    return Promise.resolve('OP extra-orçamentária n 2026.9995.0888 efetuada com sucesso.');
                }
                return Promise.resolve('');
            }),
            on: jest.fn(),
            off: jest.fn(),
            screenshot: jest.fn().mockResolvedValue(true),
            frames: jest.fn().mockReturnValue([{
                name: () => 'principal',
                $: mockContexto.$
            }])
        };

        mockBrowser = {
            newPage: jest.fn().mockResolvedValue(mockPage),
            close: jest.fn().mockResolvedValue(true)
        };

        puppeteer.launch.mockResolvedValue(mockBrowser);

        fileUtils.prepararDiretorios.mockReturnValue({
            base: 'C:/fake/saida',
            evidencias: 'C:/fake/saida/evidencias',
            planilhas: 'C:/fake/saida/planilhas'
        });

        fileUtils.exportarRelatorios.mockResolvedValue({
            qtdSucesso: 1,
            qtdErro: 0,
            caminhoArquivo: 'C:/fake/saida/planilhas/relatorio.xlsx'
        });

        navUtils.delay.mockResolvedValue(true);
        navUtils.tratarData.mockReturnValue(new Date('2026-08-30T12:00:00Z'));
        navUtils.formatarMoeda.mockReturnValue('1.500,00');

        pptUtils.aguardarContextoDoCampo.mockResolvedValue(mockContexto);
        pptUtils.selecionarOpcaoPorTexto.mockResolvedValue(true);
        pptUtils.preencherTexto.mockResolvedValue(true);
        pptUtils.injetarValor.mockResolvedValue(true);
        pptUtils.marcarOpcao.mockResolvedValue(true);
        pptUtils.buscarIdBeneficiario.mockResolvedValue('987654');

        mockConfigPerfil = {
            id: 'restituicao-deducao-receita',
            nome: 'Dedução de Receita com Restituição de Recursos (86)',
            url_portal: 'https://siafic.sistemas.go.gov.br/#/',
            url_formulario_direto: 'https://siofi.sistemas.go.gov.br/siofi/servlet/control?cmd=EfetuarOPExtra',
            url_base_sistema: 'https://siofi.sistemas.go.gov.br/siofi',
            configuracoes_fixas: {
                texto_selecao_inicial: 'Dedução de Receita com Restituição de Recursos',
                finalidade_codigo: '86',
                orgao_codigo: '9995',
                receita_debito_padrao: '199999219054',
                tipo_debito_texto: 'CUTE',
                conta_debito: {
                    banco: '104',
                    agencia: '4204',
                    conta: '05734669195'
                },
                ddr_debito_texto: '9995.17990142.00000.0000',
                tipo_credito_texto: 'Movimento',
                enviar_para_banco: 'S',
                lista_credores: 'N',
                rascunho: 'N'
            },
            mapeamento_colunas: {
                PROCESSO: 'Proc. SEI',
                DATA: 'Data da restituição',
                VALOR: 'Valor Atualizado',
                NOME: 'Beneficiário',
                CPF_CNPJ: 'CPF | CNPJ (Beneficiário)',
                RECEITA_DEBITO: 'Receita Débito',
                BANCO_CREDITO: 'Banco',
                AGENCIA_CREDITO: 'Agência',
                CONTA_CREDITO: 'Conta',
                HISTORICO: 'Histórico'
            }
        };
    });

    test('Deve abortar a execução quando o usuário cancela o diálogo de login inicial', async () => {
        dialog.showMessageBox.mockResolvedValue({ response: 1 }); // Cancelar

        fileUtils.lerExcelInput.mockResolvedValue([
            { 'Proc. SEI': '20260001', 'Valor Atualizado': 1500, 'Beneficiário': 'João Silva', 'CPF | CNPJ (Beneficiário)': '12345678901' }
        ]);

        const res = await executarRestituicaoDeducaoReceita(
            mockConfigPerfil,
            'C:/fake/planilha.xlsx',
            'C:/fake/saida',
            enviarLog,
            { abortar: false }
        );

        expect(res.sucesso).toBe(false);
        expect(res.erro).toContain('cancelada pelo usuário');
        expect(mockBrowser.close).toHaveBeenCalled();
    });

    test('Deve executar com sucesso processando linha com receita de débito dinâmica da planilha', async () => {
        dialog.showMessageBox.mockResolvedValue({ response: 0 }); // Iniciar

        fileUtils.lerExcelInput.mockResolvedValue([
            {
                'Proc. SEI': '2026/0001/TJ',
                'Data da restituição': '30/08/2026',
                'Valor Atualizado': '2.500,50',
                'Beneficiário': 'Empresa Exemplo LTDA',
                'CPF | CNPJ (Beneficiário)': '12.345.678/0001-90',
                'Receita Débito': '111301019001',
                'Banco': '001',
                'Agência': '1234',
                'Conta': '98765-4',
                'Histórico': 'Restituição Processo TJ 2026/0001'
            }
        ]);

        const res = await executarRestituicaoDeducaoReceita(
            mockConfigPerfil,
            'C:/fake/planilha.xlsx',
            'C:/fake/saida',
            enviarLog,
            { abortar: false }
        );

        expect(res.sucesso).toBe(true);
        expect(res.resumo.qtdSucesso).toBe(1);
        expect(pptUtils.buscarIdBeneficiario).toHaveBeenCalledWith(
            mockBrowser,
            mockConfigPerfil.url_base_sistema,
            '12.345.678/0001-90'
        );
        expect(pptUtils.preencherTexto).toHaveBeenCalledWith(
            mockContexto,
            'txtCodigoReceitaDebito',
            '111301019001'
        );
        expect(mockBrowser.close).toHaveBeenCalled();
    });

    test('Deve usar receita de débito padrão do perfil se a planilha não informar', async () => {
        dialog.showMessageBox.mockResolvedValue({ response: 0 });

        fileUtils.lerExcelInput.mockResolvedValue([
            {
                'Proc. SEI': '2026/0002/TJ',
                'Data da restituição': '30/08/2026',
                'Valor Atualizado': 1000,
                'Beneficiário': 'Maria Oliveira',
                'CPF | CNPJ (Beneficiário)': '98765432100'
            }
        ]);

        const res = await executarRestituicaoDeducaoReceita(
            mockConfigPerfil,
            'C:/fake/planilha.xlsx',
            'C:/fake/saida',
            enviarLog,
            { abortar: false }
        );

        expect(res.sucesso).toBe(true);
        expect(pptUtils.preencherTexto).toHaveBeenCalledWith(
            mockContexto,
            'txtCodigoReceitaDebito',
            '199999219054'
        );
    });

    test('Deve registrar erro na linha se o beneficiário não for encontrado', async () => {
        dialog.showMessageBox.mockResolvedValue({ response: 0 });

        fileUtils.lerExcelInput.mockResolvedValue([
            {
                'Proc. SEI': '2026/0003/ERRO',
                'Valor Atualizado': 500,
                'Beneficiário': 'Favorecido Inexistente',
                'CPF | CNPJ (Beneficiário)': '00000000000'
            }
        ]);

        pptUtils.buscarIdBeneficiario.mockResolvedValue(null);

        fileUtils.exportarRelatorios.mockResolvedValue({
            qtdSucesso: 0,
            qtdErro: 1,
            caminhoArquivo: 'C:/fake/saida/planilhas/relatorio.xlsx'
        });

        const res = await executarRestituicaoDeducaoReceita(
            mockConfigPerfil,
            'C:/fake/planilha.xlsx',
            'C:/fake/saida',
            enviarLog,
            { abortar: false }
        );

        expect(res.sucesso).toBe(true);
        expect(fileUtils.exportarRelatorios).toHaveBeenCalledWith(
            'C:/fake/saida/planilhas',
            expect.arrayContaining([
                expect.objectContaining({
                    status: 'ERRO',
                    mensagem: expect.stringContaining('não encontrado no sistema')
                })
            ])
        );
    });
});
