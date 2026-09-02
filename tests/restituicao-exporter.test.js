const {
    montarLinhasGuiaPrincipal,
    montarLinhasGuiaDare,
    extrairValorMunicipio
} = require('../src/backend/utils/restituicao-exporter.js');

describe('restituicao-exporter - Guia IPVA e Múltiplos DAREs', () => {
    const configPerfil = {
        configuracoes_fixas: {
            guia_ipva: 'IPVA',
            guia_dare: 'Marcar DARE'
        },
        mapeamento_colunas: {
            guia_ipva: {
                'PROCESSO_SEI': 'Proc. SEI',
                'contribuinte.nome_completo': 'Contribuinte',
                'contribuinte.cpf_cnpj': 'Contribuinte - Marcação',
                'dares_recolhidos.numero_dare': 'Documento Referência',
                'dares_recolhidos.data_pagamento': 'Data pagamento DARE',
                'dares_recolhidos.codigo_municipio': 'Código Município',
                'dares_recolhidos.end': 'END -TERMINAL',
                'dares_recolhidos.seq': 'SEQ - TERMINAL',
                'dares_recolhidos.valor_restituir': 'Valor autorizado'
            },
            guia_dare: {
                'PROCESSO_SEI': 'Proc. SEI',
                'contribuinte.cpf_cnpj': 'Contribuinte - Marcação',
                'dares_recolhidos.numero_dare': 'Documento Referência',
                'dares_recolhidos.data_pagamento': 'Data pagamento DARE',
                'dares_recolhidos.valor_restituir': 'Valor autorizado'
            }
        }
    };

    test('Deve preservar o Código Município na guia IPVA quando há múltiplos DAREs', () => {
        const processos = [
            {
                tipo_processo: 'Restituição de IPVA',
                _processo_sei: '2024000010001',
                contribuinte: {
                    nome_completo: 'JOAO DA SILVA',
                    cpf_cnpj: '12345678900'
                },
                dares_recolhidos: [
                    {
                        numero_dare: '1111111',
                        data_pagamento: '2024-01-10',
                        codigo_municipio: '9701',
                        end: '001',
                        seq: '002',
                        valor_restituir: 150.50
                    },
                    {
                        numero_dare: '2222222',
                        data_pagamento: '2024-02-10',
                        codigo_municipio: '9701',
                        end: '003',
                        seq: '004',
                        valor_restituir: 200.00
                    }
                ]
            }
        ];

        const { linhasPorGuia, alertasMultiplosDares } = montarLinhasGuiaPrincipal(processos, configPerfil);

        expect(alertasMultiplosDares).toHaveLength(1);
        expect(linhasPorGuia['IPVA']).toBeDefined();
        expect(linhasPorGuia['IPVA']).toHaveLength(1);

        const linhaIpva = linhasPorGuia['IPVA'][0];
        expect(linhaIpva['Proc. SEI']).toBe('2024000010001');
        expect(linhaIpva['Contribuinte']).toBe('JOAO DA SILVA');
        expect(linhaIpva['Documento Referência']).toBe('multiplos dares');
        expect(linhaIpva['Valor autorizado']).toBe('multiplos dares');
        expect(linhaIpva['Data pagamento DARE']).toBe('');
        expect(linhaIpva['END -TERMINAL']).toBe('');
        expect(linhaIpva['SEQ - TERMINAL']).toBe('');
        // O campo Código Município DEVE ser preservado!
        expect(linhaIpva['Código Município']).toBe('9701');

        // Valida que a guia DARE também é montada com os 2 registros individuais
        const linhasDare = montarLinhasGuiaDare(processos, configPerfil);
        expect(linhasDare).toHaveLength(2);
        expect(linhasDare[0]['Documento Referência']).toBe('1111111');
        expect(linhasDare[1]['Documento Referência']).toBe('2222222');
    });

    test('Deve preencher normalmente o Código Município quando há apenas um DARE', () => {
        const processos = [
            {
                tipo_processo: 'Restituição de IPVA',
                _processo_sei: '2024000010002',
                contribuinte: {
                    nome_completo: 'MARIA SANTOS',
                    cpf_cnpj: '98765432100'
                },
                dares_recolhidos: [
                    {
                        numero_dare: '3333333',
                        data_pagamento: '2024-03-15',
                        codigo_municipio: '5208707',
                        end: '005',
                        seq: '006',
                        valor_restituir: 350.00
                    }
                ]
            }
        ];

        const { linhasPorGuia, alertasMultiplosDares } = montarLinhasGuiaPrincipal(processos, configPerfil);

        expect(alertasMultiplosDares).toHaveLength(0);
        const linhaIpva = linhasPorGuia['IPVA'][0];
        expect(linhaIpva['Documento Referência']).toBe('3333333');
        expect(linhaIpva['Valor autorizado']).toBe(350.00);
        expect(linhaIpva['Código Município']).toBe('5208707');
    });

    test('Deve encontrar o município via fallback se o primeiro DARE estiver sem município mas o segundo tiver', () => {
        const processo = {
            tipo_processo: 'Restituição de IPVA',
            dares_recolhidos: [
                { numero_dare: '111', valor_restituir: 50 },
                { numero_dare: '222', codigo_municipio: '9705', valor_restituir: 60 }
            ]
        };

        const mun = extrairValorMunicipio(processo, 'dares_recolhidos.codigo_municipio');
        expect(mun).toBe('9705');
    });

    test('Deve encontrar o município via fallback se vier na raiz do processo', () => {
        const processo = {
            tipo_processo: 'Restituição de IPVA',
            codigo_municipio: '9710',
            dares_recolhidos: [
                { numero_dare: '111', valor_restituir: 50 },
                { numero_dare: '222', valor_restituir: 60 }
            ]
        };

        const mun = extrairValorMunicipio(processo, 'dares_recolhidos.codigo_municipio');
        expect(mun).toBe('9710');
    });
});
