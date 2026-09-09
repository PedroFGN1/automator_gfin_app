const navUtils = require('../src/backend/utils/navigation-utils');
const fileUtils = require('../src/backend/utils/file-utils');

describe('Utilitários de Data e Leitura de Planilha', () => {
    describe('navUtils.tratarData', () => {
        test('deve tratar data em formato string brasileiro DD/MM/AAAA sem inverter dia com mês', () => {
            const data = navUtils.tratarData('08/09/2026');
            expect(data).not.toBeNull();
            expect(data.getUTCDate()).toBe(8);
            expect(data.getUTCMonth() + 1).toBe(9);
            expect(data.getUTCFullYear()).toBe(2026);
        });

        test('deve tratar data em formato string com dia maior que 12', () => {
            const data = navUtils.tratarData('22/01/2024');
            expect(data).not.toBeNull();
            expect(data.getUTCDate()).toBe(22);
            expect(data.getUTCMonth() + 1).toBe(1);
            expect(data.getUTCFullYear()).toBe(2024);
        });

        test('deve tratar data em formato ISO AAAA-MM-DD', () => {
            const data = navUtils.tratarData('2026-09-08');
            expect(data).not.toBeNull();
            expect(data.getUTCDate()).toBe(8);
            expect(data.getUTCMonth() + 1).toBe(9);
            expect(data.getUTCFullYear()).toBe(2026);
        });

        test('deve preservar Date em UTC meia-noite vindo do ExcelJS', () => {
            const excelDate = new Date('2026-09-08T00:00:00.000Z');
            const data = navUtils.tratarData(excelDate);
            expect(data.getUTCDate()).toBe(8);
            expect(data.getUTCMonth() + 1).toBe(9);
            expect(data.getUTCFullYear()).toBe(2026);
        });

        test('deve extrair a data civil local caso receba objeto Date com horário (ex: gerado às 23h)', () => {
            // Cria data local: 08/09/2026 às 23:30 (em UTC-3 isso seria 09/09/2026 às 02:30 UTC)
            const dataLocal = new Date(2026, 8, 8, 23, 30, 0);
            const data = navUtils.tratarData(dataLocal);
            expect(data.getUTCDate()).toBe(8);
            expect(data.getUTCMonth() + 1).toBe(9);
            expect(data.getUTCFullYear()).toBe(2026);
        });

        test('deve retornar null para valores vazios ou inválidos', () => {
            expect(navUtils.tratarData(null)).toBeNull();
            expect(navUtils.tratarData(undefined)).toBeNull();
            expect(navUtils.tratarData('')).toBeNull();
            expect(navUtils.tratarData('texto-invalido')).toBeNull();
        });
    });

    describe('navUtils.obterDataHoje', () => {
        test('deve retornar o dia civil de hoje conforme horário local', () => {
            const hojeLocal = new Date();
            const dataHoje = navUtils.obterDataHoje();
            expect(dataHoje.getUTCDate()).toBe(hojeLocal.getDate());
            expect(dataHoje.getUTCMonth()).toBe(hojeLocal.getMonth());
            expect(dataHoje.getUTCFullYear()).toBe(hojeLocal.getFullYear());
        });
    });

    describe('navUtils.formatarData', () => {
        test('deve formatar Date ou string para dd/mm/aaaa', () => {
            expect(navUtils.formatarData(new Date('2026-09-08T00:00:00.000Z'))).toBe('08/09/2026');
            expect(navUtils.formatarData('08/09/2026')).toBe('08/09/2026');
            expect(navUtils.formatarData('2026-09-08')).toBe('08/09/2026');
        });
    });

    describe('fileUtils.lerExcelInput - Case Insensitive', () => {
        test('deve permitir acesso à coluna mesmo com variação de maiúsculas/minúsculas', async () => {
            const dados = await fileUtils.lerExcelInput('teste 1.xlsx');
            expect(dados.length).toBeGreaterThan(0);
            const linha = dados[0];
            // O arquivo teste 1.xlsx possui cabeçalho "Data da Restituição"
            expect(linha['Data da Restituição']).toBeDefined();
            // Via chave do perfil com "r" minúsculo:
            expect(linha['Data da restituição']).toBeDefined();
            expect(linha['DATA DA RESTITUIÇÃO']).toBeDefined();
        });
    });
});
