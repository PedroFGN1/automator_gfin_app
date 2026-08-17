const fs = require('fs');
const path = require('path');
const navUtils = require('./navigation-utils');
/**
 * Função auxiliar para montar o seletor CSS correto para JSF.
 * O JSF usa ':' nos IDs, o que quebra seletores CSS padrões se não escaparmos.
 */
const obterSeletorID = (config, idCampoChave) => {
    let prefixo = "";
    const configPrefix = config.configuracoes_fixas.config_ids.prefixo_id;

    if (typeof configPrefix === 'object') {
        prefixo = configPrefix[1] || "";
    } else {
        prefixo = configPrefix || "";
    }
    
    const sufixo = config.configuracoes_fixas.config_ids[idCampoChave];
    return `${prefixo}${sufixo}`; // Retorna o ID puro, sem # ou []
};

const navigationUtils = {

    /**
     * Função ESPECÍFICA para PrimeFaces SelectOneMenu.
     * Simula: Clicar no Trigger -> Esperar Painel -> Clicar no Item
     */
    selecionarPrimeFaces: async (page, config, idConfig, textoOpcao) => {
        try {
            // 1. Montar os IDs do PrimeFaces
            const idBase = obterSeletorID(config, idConfig);
            
            // O PrimeFaces costuma ter o ID do trigger visual = idBase
            // E o ID do painel de opções = idBase + "_panel"
            const seletorTrigger = `[id="${idBase}"]`; // A div principal ou o trigger
            const idPainel = `${idBase}_panel`;
            const seletorPainel = `[id="${idPainel}"]`;

            console.log(`      🖱️  Clicando no combo PrimeFaces: ${idBase}`);
            
            // Clica para abrir as opções
            await page.click(seletorTrigger);

            // Espera o painel de opções aparecer (animado pelo JS)
            try {
                await page.waitForSelector(seletorPainel, { visible: true, timeout: 5000 });
            } catch (e) {
                // Tenta clicar no label se o trigger falhar
                await page.click(`[id="${idBase}_label"]`);
                await page.waitForSelector(seletorPainel, { visible: true, timeout: 5000 });
            }

            // 2. Procurar e Clicar na Opção pelo Texto
            const sucesso = await page.evaluate((painelId, texto) => {
                const painel = document.getElementById(painelId);
                if (!painel) return false;

                // PrimeFaces usa <li> para os itens dentro do painel
                const itens = painel.querySelectorAll('li.ui-selectonemenu-item');
                
                for (let item of itens) {
                    // Compara o texto (ignorando espaços extras)
                    if (item.innerText.trim() === texto) {
                        item.click(); // O clique nativo do elemento dispara o evento do PrimeFaces
                        return true;
                    }
                }
                return false;
            }, idPainel, textoOpcao);

            if (sucesso) {
                console.log(`      ✅ Opção "${textoOpcao}" selecionada com sucesso.`);
                // Pausa essencial para o AJAX atualizar a tela (máscaras, outros campos)
                await new Promise(r => setTimeout(r, 2000));
            } else {
                console.error(`      ❌ Opção "${textoOpcao}" não encontrada na lista.`);
            }

        } catch (error) {
            console.error(`      ❌ Erro PrimeFaces: ${error.message}`);
        }
    },

    /**
     * Função auxiliar para clicar em Radio Buttons do PrimeFaces
     */
    marcarRadioPrimeFaces: async (page, idCompleto) => {
        // PrimeFaces esconde o radio real. O clique deve ser na div visual.
        // O ID visual geralmente é o mesmo do input, mas procuramos a caixa "ui-radiobutton-box"
        const seletorRadio = `[id="${idCompleto}"]`;
        const seletorVisual = `div[id="${idCompleto}"] .ui-radiobutton-box`;
        
        try {
            // Tenta clicar na parte visual (caixinha)
            const elementoVisual = await page.$(seletorVisual);
            if (elementoVisual) {
                await elementoVisual.click();
            } else {
                // Se não achar a visual, tenta o elemento pai ou o próprio ID
                await page.click(seletorRadio);
            }
            console.log(`      🔘 Radio clicado: ${idCompleto}`);
        } catch (e) {
            console.error(`      ❌ Erro ao clicar no radio ${idCompleto}: ${e.message}`);
        }
    },

    /**
     * Garante que o container ou campo principal está visível.
     * Substitui a lógica de procurar por texto. Espera pelo botão ou campo principal.
     */
    garantirPaginaCarregada: async (page, config) => {
        // Vamos usar o campo 'tipo_contribuinte' como referência de que a tela carregou
        const id = obterSeletorID(config, 'tipo_contribuinte');
        const seletor = `[id="${id}"]`
        console.log(`⏳ Aguardando carregamento do elemento: ${seletor}`);
        
        try {
            await page.waitForSelector(seletor, { visible: true, timeout: 10000 });
            return true;
        } catch (e) {
            console.error(`❌ Erro: Elemento ${seletor} não encontrado.`);
            throw e;
        }
    },

    /**
     * NOVA FUNÇÃO: Simula o "Ctrl+V" (Colar).
     * Injeta o valor instantaneamente e dispara os eventos para a máscara se adaptar.
     */
    inserirValorDireto: async (page, seletor, valor) => {
        // 1. Foca no campo
        await page.click(seletor);
        
        // 2. Limpa o campo para garantir que está vazio
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');

        // 3. Injeta o valor instantaneamente e "acorda" a máscara
        await page.evaluate((sel, val) => {
            const el = document.querySelector(sel);
            if (el) {
                el.value = val; // "Cola" o valor
                // Dispara os eventos que dizem ao site para formatar o valor
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true })); // Simula a saída do campo
            }
        }, seletor, String(valor));

        // 4. Pequena pausa e Tab para confirmar
        await new Promise(r => setTimeout(r, 200));
        await page.keyboard.press('Tab');
    },

    /**
     * Preenche o formulário de pesquisa com os dados da linha do Excel.
     */
    preencherFormularioConsulta: async (page, config, dadosLinha) => {
        const mapa = config.mapeamento_colunas;
        
        if (dadosLinha[mapa.TIPO] === "DARE") {
            await navigationUtils.marcarRadioPrimeFaces(page, obterSeletorID(config, 'tipo_documento_dare'));
        } else if (dadosLinha[mapa.TIPO] === "GNRE") {
            await navigationUtils.marcarRadioPrimeFaces(page, obterSeletorID(config, 'tipo_documento_gnre'));
        } else {
            console.error(`Tipo desconhecido no mapeamento: ${mapa.TIPO}`);
        }

        // --- 1. PREENCHER TIPO DE CONTRIBUINTE (SELECT) ---
        const textoTipo = dadosLinha[mapa.TIPO_CONTRIBUINTE]; 
        await navigationUtils.selecionarPrimeFaces(page, config, 'tipo_contribuinte', textoTipo);

        await new Promise(r => setTimeout(r, 1000));

        // --- 2. PREENCHER DOCUMENTO (INPUT TEXTO) ---
        const idDoc = obterSeletorID(config, 'campo_contribuinte');
        const valorDoc = dadosLinha[mapa.CONTRIBUINTE];
        const seletorDoc = `[id="${idDoc}"]`;

        console.log(`      ✍️  Colando Documento: ${valorDoc}`);
        await page.click(seletorDoc, { clickCount: 3 });
        await new Promise(r => setTimeout(r, 300));
        
        await navigationUtils.inserirValorDireto(page, seletorDoc, valorDoc);

        // --- 3. PREENCHER TIPO DE DATA (SELECT) ---
        const textoTipoData = 'Pagamento'; // O tipo de data para pesquisa é sempre "Pagamento" no ARR
        await navigationUtils.selecionarPrimeFaces(page, config, 'tipo_periodo', textoTipoData);

        // --- 4. PREENCHER DATAS (COM MÁSCARA) ---
        const camposData = [
            { idConfig: 'data_inicio', valor: dadosLinha[mapa.DATA] },
            { idConfig: 'data_fim', valor: dadosLinha[mapa.DATA] }
        ];

        for (const campo of camposData) {
            const idData = obterSeletorID(config, campo.idConfig);
            const seletorData = `[id="${idData}"]`;

            await new Promise(r => setTimeout(r, 300));

            // Segura Control, aperta A (selecionar tudo), solta Control, aperta Backspace
            await page.click(seletorData);
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');

            // Digita a data formatada (mascara dd/mm/aaaa)
            const valorFormatado = navUtils.formatarData(campo.valor);
            console.log(`      ✍️  Colando Data: ${valorFormatado}`);
            await navigationUtils.inserirValorDireto(page, seletorData, valorFormatado);

        }
    },

    /**
     * Clica no botão pesquisar e aguarda o resultado.
     */
    clicarPesquisar: async (page, config) => {
        const idBotao = obterSeletorID(config, 'botao_pesquisar');
        const seletorBotao = `[id="${idBotao}"]`;
        
        const promessaRede = page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {});
        await page.click(seletorBotao);
        console.log('🔍 Pesquisando...');
        await promessaRede;
    },

    /**
     * (Placeholder) Função para processar a tabela de resultados.
     * Implementaremos a lógica de busca do DARE na próxima etapa.
     */
    processarTabelaResultados: async (page, numeroDARE, configPerfil = null, loggerCallback = console.log) => {
        console.log(`👀 Procurando DARE ${numeroDARE} na tabela...`);
        try {
            const idTabelaBase = "frmHistoricoPagamentosContribuintes:tabelaPagamentos";
            const seletorLinhas = `tbody[id="${idTabelaBase}_data"] tr`;

            // Aguarda que apareça pelo menos uma linha na tabela (timeout de 10s)
            try {
                await page.waitForSelector(seletorLinhas, { timeout: 10000 });
            } catch (e) {
                loggerCallback("⚠️ Nenhuma linha apareceu na tabela após a pesquisa.");
                return false;
            }

            const rawHabilitar = configPerfil?.configuracoes_fixas?.habilitar_paginacao;
            const habilitarPaginacao = rawHabilitar === true || (typeof rawHabilitar === 'string' && rawHabilitar.trim().toLowerCase() === 'true');
            const limiteMaximoPaginas = Number(configPerfil?.configuracoes_fixas?.limite_maximo_paginas) || 10;
            const sufixoPaginador = configPerfil?.configuracoes_fixas?.config_ids?.seletor_paginador || "tabelaPagamentos_paginator_bottom";
            const idPaginador = configPerfil ? obterSeletorID(configPerfil, 'seletor_paginador') : "frmHistoricoPagamentosContribuintes:" + sufixoPaginador;

            let paginaAtual = 1;

            while (true) {
                // 2. Busca e Ação dentro do navegador na página atual
                const resultado = await page.evaluate((dareAlvo, seletorTr) => {
                    const linhas = document.querySelectorAll(seletorTr);
                    let listaDaresVistos = [];

                    for (const linha of linhas) {
                        const celulas = linha.querySelectorAll('.ui-dt-c');
                        let achouLinha = false;

                        for (const celula of celulas) {
                            const textoCelula = celula.innerText.trim();
                            listaDaresVistos.push(textoCelula);

                            if (textoCelula.includes(dareAlvo)) {
                                achouLinha = true;
                                break;
                            }
                        }

                        if (achouLinha) {
                            const botao = linha.querySelector('[title*="Restituição"]') || 
                                          linha.querySelector('.ui-icon-pencil') ||
                                          Array.from(linha.querySelectorAll('a, button, span')).find(el => el.innerText.includes('Restituir'));

                            if (botao) {
                                botao.click();
                                return { sucesso: true, msg: 'Clicado' };
                            } else {
                                return { sucesso: false, msg: 'LINHA_ACHADA_SEM_BOTAO' };
                            }
                        }
                    }

                    return { 
                        sucesso: false, 
                        msg: 'NAO_ENCONTRADO', 
                        debug: listaDaresVistos.slice(0, 5)
                    };
                }, String(numeroDARE), seletorLinhas);

                if (resultado.sucesso) {
                    loggerCallback(`      ✅ Botão Restituir clicado com sucesso (Página ${paginaAtual})!`);
                    await new Promise(r => setTimeout(r, 2000));
                    return true;
                } else if (resultado.msg === 'LINHA_ACHADA_SEM_BOTAO') {
                    loggerCallback(`      ⚠️ Encontrei a linha do DARE ${numeroDARE} na página ${paginaAtual}, mas não achei o botão 'Restituir' nela.`);
                    return false;
                }

                // Se não encontrou o DARE na página atual, verifica se a paginação deve continuar
                if (!habilitarPaginacao) {
                    loggerCallback(`      ℹ️ DARE ${numeroDARE} não encontrado na página 1. Paginação desabilitada no perfil.`);
                    return false;
                }

                if (paginaAtual >= limiteMaximoPaginas) {
                    loggerCallback(`      ⚠️ Limite máximo de páginas (${limiteMaximoPaginas}) atingido sem localizar o DARE ${numeroDARE}.`);
                    return false;
                }

                // Tenta clicar na próxima página no PrimeFaces
                const navegouProxima = await page.evaluate((containerId) => {
                    const container = document.getElementById(containerId) || 
                                      document.querySelector(`[id="${containerId}"]`) ||
                                      document.querySelector('.ui-paginator-bottom') ||
                                      document.querySelector('.ui-paginator-top');
                    if (!container) return false;

                    const btnNext = container.querySelector('.ui-paginator-next');
                    if (!btnNext || btnNext.classList.contains('ui-state-disabled')) {
                        return false;
                    }

                    btnNext.click();
                    return true;
                }, idPaginador);

                if (!navegouProxima) {
                    loggerCallback(`      ℹ️ Alcançou a última página disponível (${paginaAtual}) sem localizar o DARE ${numeroDARE}.`);
                    return false;
                }

                paginaAtual++;
                loggerCallback(`      📄 DARE ${numeroDARE} não encontrado na página ${paginaAtual - 1}. Avançando para a página ${paginaAtual}...`);

                await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 1200));
            }

        } catch (error) {
            console.error(`❌ Erro técnico ao ler tabela: ${error.message}`);
            return false;
        }
    },

    /**
     * NOVA FUNÇÃO: Preenche o modal de Restituição
     */
    preencherModalRestituicao: async (page, config, dadosLinha) => {
        console.log('📝 Preenchendo Modal de Restituição...');
        const mapa = config.mapeamento_colunas;

        try {
            // 1. Clicar no botão 'Nova Restituição'
            // Ou esse botão É o que abre o modal? Vou seguir teu fluxo (Item 6).
            const idBotaoNova = obterSeletorID(config, 'botao_nova_restituicao');
            console.log(`      🖱️ Clicando em Nova Restituição (${idBotaoNova})...`);
            
            await page.waitForSelector(`[id="${idBotaoNova}"]`, { visible: true, timeout: 10000 });
            await page.click(`[id="${idBotaoNova}"]`);
            
            // Pausa para os campos aparecerem/habilitarem
            await new Promise(r => setTimeout(r, 1500));


            // 2. Preencher Processo (Input Texto)
            const idProcesso = obterSeletorID(config, 'campo_processo');
            const valorProcesso = dadosLinha[mapa.PROCESSO]; // Pega do Excel
            
            console.log(`      ✍️ Processo: ${valorProcesso}`);
            const selProcesso = `[id="${idProcesso}"]`;
            await page.click(selProcesso, { clickCount: 3 });
            await navigationUtils.inserirValorDireto(page, selProcesso, valorProcesso);


            // 3. Preencher Valor a Restituir (Input Valor)
            const idValor = obterSeletorID(config, 'campo_valor_restituir');
            const valorRestituir = navUtils.formatarMoeda(dadosLinha[mapa.VALOR_RESTITUIDO]); // Pega do Excel
            

            console.log(`      💲 Valor: ${valorRestituir}`);
            const selValor = `[id="${idValor}"]`;
            // Limpeza forçada para campos de valor (máscara de moeda)
            await page.click(selValor);
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            //await page.type(selValor, String(valorRestituir), { delay: 150 });
            await navigationUtils.inserirValorDireto(page, selValor, String(valorRestituir)); // Garante que o valor é inserido e a máscara é atualizada

            // 4. Preencher Informações Complementares (Textarea)
            const idInfos = obterSeletorID(config, 'campo_informacoes');
            const textoInfos = config.configuracoes_fixas.campo_informacoes; // Valor fixo do config
            
            console.log(`      📝 Informações: ${textoInfos}`);
            const selInfos = `[id="${idInfos}"]`;
            await page.type(selInfos, textoInfos);


            // 5. Marcar Radio Buttons
            // Radio 1: Tipo Restituição
            const idRadioTipo = obterSeletorID(config, 'tipo_restituicao');
            await navigationUtils.marcarRadioPrimeFaces(page, idRadioTipo);

            // Radio 2: Forma Restituição
            const idRadioForma = obterSeletorID(config, 'forma_restituicao');
            await navigationUtils.marcarRadioPrimeFaces(page, idRadioForma);

            console.log('      ✅ Modal preenchido com sucesso.');

            try {
                const idBotaoIncluir = obterSeletorID(config, 'botao_incluir'); // Certifica-te que adicionaste ao config
                const idCampoExtraRadar = obterSeletorID(config, 'campo_endereco');

                console.log(`      💾 Clicando em Incluir/Salvar...`);
                
                // Tenta clicar pelo ID, ou busca por texto se o ID for dinâmico
                const botaoSalvar = await page.$(`[id="${idBotaoIncluir}"]`) || 
                                    await page.evaluateHandle(() => {
                                        // Busca botão que contenha texto "Incluir" ou "Salvar" dentro do modal
                                        const botoes = Array.from(document.querySelectorAll('button, span.ui-button-text'));
                                        return botoes.find(b => b.innerText.includes('Incluir') || b.innerText.includes('Salvar'));
                                    });

                if (botaoSalvar) {
                    await botaoSalvar.click();
                    
                    // Aguarda o modal fechar ou a mensagem de sucesso
                    // O site costuma mostrar uma mensagem "Operação realizada com sucesso" ou fechar o modal
                    //await new Promise(r => setTimeout(r, 100000));
                    
                    await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});
                    console.log(`      ⏳ Aguardando resposta do sistema...`);
                    // ESPERA INTELIGENTE POR BIFUCAÇÃO: O sistema pode seguir 2 caminhos após clicar em Incluir:
                    
                    const seletorDuplicado1 = `[id="${obterSeletorID(config, 'campo_endereco')}"]`;

                    try {
                        // --- A CORRIDA (PROMISE.RACE) ---
                        // O Puppeteer vai monitorar as duas condições simultaneamente.

                        // 1. Promessa do Duplicado: O motor nativo do Puppeteer sabe exatamente quando o 'display: none' sai
                        const promessaDuplicado = page.waitForSelector(seletorDuplicado1, { visible: true, timeout: 15000 })
                            .then(() => 'FLUXO_DUPLICADO');

                        // 2. Promessa Normal: Procura pelo texto da mensagem no ecrã ou pela notificação de canto
                        const promessaNormal = page.waitForFunction(() => {
                            // Verifica se o texto apareceu em qualquer lugar visível do corpo da página
                            if (document.body.innerText.includes('inserido com sucesso')) return true;
                            if (document.body.innerText.includes('com sucesso')) return true; // Fallback mais curto
                            
                            // Verifica a classe padrão do balão de notificação (growl) do PrimeFaces
                            const growl = document.querySelector('.ui-growl-message, .ui-messages-success, .ui-notification');
                            if (growl && growl.offsetParent !== null) return true;
                            
                            return false;
                        }, { timeout: 15000 }).then(() => 'FLUXO_NORMAL');

                        // Quem chegar primeiro decide o resultado!
                        const resultadoFluxo = await Promise.race([promessaDuplicado, promessaNormal]);

                        if (resultadoFluxo === 'FLUXO_DUPLICADO') {
                            console.log(`      ⚠️ Pagamento duplicado detectado! Preenchendo dados adicionais...`);
                            
                            // 1. Preenche os 4 campos (Adapta os seletores e valores conforme a tua necessidade)
                            // Usa inserirValorDireto para inputs de texto ou selecionarPrimeFaces para combos
                            const seletorC1 = `[id="${obterSeletorID(config, 'campo_endereco')}"]`;
                            await navigationUtils.inserirValorDireto(page, seletorC1, String(dadosLinha[mapa.END] || ''));

                            const seletorC2 = `[id="${obterSeletorID(config, 'campo_data_pagamento')}"]`;
                            await navigationUtils.inserirValorDireto(page, seletorC2, String(navUtils.formatarData(dadosLinha[mapa.DATA]) || ''));

                            const seletorC3 = `[id="${obterSeletorID(config, 'campo_tpa')}"]`;
                            await navigationUtils.inserirValorDireto(page, seletorC3, String(navUtils.safeSlice(dadosLinha[mapa.SEQ], 0, 3) || ''));

                            const seletorC4 = `[id="${obterSeletorID(config, 'campo_indicador')}"]`;
                            await navigationUtils.inserirValorDireto(page, seletorC4, String(navUtils.safeSlice(dadosLinha[mapa.SEQ], 3, 5) || ''));


                            // 2. Clica no NOVO botão de incluir do segundo modal
                            const idBotaoIncluirSecundario = obterSeletorID(config, 'botao_incluir_duplicado');
                            console.log(`      💾 Clicando em Incluir no modal secundário...`);
                            const botaoSecundario = await page.$(`[id="${idBotaoIncluirSecundario}"]`);
                            if (botaoSecundario) {
                                await page.click(`[id="${idBotaoIncluirSecundario}"]`); 
                            } else return false;

                            // 3. Agora sim, espera o fechamento total e o botão 'Nova Restituição' reaparecer
                            console.log(`      ⏳ Aguardando processamento final...`);
                            await page.waitForFunction(() => {
                                return document.body.innerText.includes('com sucesso') || 
                                       document.querySelector('.ui-growl-message, .ui-messages-success') !== null;
                            }, { timeout: 15000 });

                            await page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {});
                            
                            console.log(`      ✅ Exceção duplicada finalizada com sucesso!`);
                        } else {
                            console.log(`      ✅ Processamento normal concluído com sucesso!`);
                        }

                        return true;

                    } catch (err) {
                        console.error(`      ❌ Timeout aguardando estabilização da tela (Normal ou Duplicado): ${err.message}`);
                        // 2. RAIO-X DA TELA
                        const diagnostico = await page.evaluate((idNova, idExtra) => {
                            const isVis = (el) => el && window.getComputedStyle(el).display !== 'none' && el.offsetWidth > 0;
                            const elNova = document.getElementById(idNova);
                            const elExtra = document.getElementById(idExtra);
                            const overlays = document.querySelectorAll('.ui-widget-overlay');
                            const overlayBloqueando = Array.from(overlays).find(ov => isVis(ov) && window.getComputedStyle(ov).opacity !== '0');

                            return {
                                botaoNovaExiste: !!elNova,
                                botaoNovaVisivel: isVis(elNova),
                                campoDuplicadoExiste: !!elExtra,
                                campoDuplicadoVisivel: isVis(elExtra),
                                overlayTravandoTela: !!overlayBloqueando
                            };
                        }, idBotaoNova, idCampoExtraRadar);

                        console.log(`      🔍 DIAGNÓSTICO DO TIMEOUT:`, diagnostico);
                        return false; 
                    }

                } else {
                    console.error('      ❌ Botão de Incluir não encontrado!');
                    return false;
                }

            } catch (e) {
                console.error(`      ❌ Erro ao clicar em incluir: ${e.message}`);
                return false;
            }

        } catch (error) {
            console.error(`❌ Erro no modal: ${error.message}`);
            return false;
        }
    },

    /**
     * NOVA FUNÇÃO: Extrai código de barras da tabela e baixa o PDF
     */
    baixarPDFComprovante_CodigoBarras: async (browser, page, config, numeroDARE) => {
        console.log(`⬇️ Iniciando procedimento de download para DARE ${numeroDARE}...`);
        
        try {
            // 1. Re-localizar a linha na tabela para pegar o Código de Barras (1ª coluna)
            const idTabelaBase = "frmHistoricoPagamentosContribuintes:tabelaPagamentos";
            const seletorLinhas = `tbody[id="${idTabelaBase}_data"] tr`;

            const codigoBarras = await page.evaluate((dareAlvo, seletor) => {
                const linhas = document.querySelectorAll(seletor);
                for (const linha of linhas) {
                    // Verifica se esta linha contém o DARE (igual à lógica anterior)
                    if (linha.innerText.includes(dareAlvo)) {
                        // Pega a primeira célula (.ui-dt-c)
                        const primeiraCelula = linha.querySelector('.ui-dt-c');
                        if (primeiraCelula) {
                            return primeiraCelula.innerText.trim();
                        }
                    }
                }
                return null;
            }, String(numeroDARE), seletorLinhas);

            if (!codigoBarras) {
                console.log(`      ⚠️ Não consegui extrair o código de barras para o DARE ${numeroDARE}.`);
                return false;
            }

            console.log(`      🎫 Código de barras extraído: ${codigoBarras}`);

            // 2. Construir a URL do PDF
            // URL Base: https://arr.economia.go.gov.br/arr-www/view/exibeDARE.jsf?codigo=...
            const urlPDF = `https://arr.economia.go.gov.br/arr-www/view/exibeDARE.jsf?codigo=${codigoBarras}`;

            // 3. Criar pasta de downloads se não existir
            const pastaDownload = './comprovantes';
            if (!fs.existsSync(pastaDownload)){
                fs.mkdirSync(pastaDownload);
            }

            // 4. Baixar o Arquivo (Abrindo nova aba para não sair da tela principal)
            const novaPagina = await browser.newPage();
            
            console.log(`      🌍 Baixando de: ${urlPDF}`);
            
            // Acessa a URL. O Puppeteer vai compartilhar os Cookies da sessão principal.
            const response = await novaPagina.goto(urlPDF, { waitUntil: 'networkidle2' });
            const buffer = await response.buffer(); // Pega os dados binários do PDF

            // Salva o arquivo
            const nomeArquivo = path.join(pastaDownload, `Comprovante_${numeroDARE}.pdf`);
            fs.writeFileSync(nomeArquivo, buffer);
            
            console.log(`      ✅ PDF salvo com sucesso em: ${nomeArquivo}`);

            await novaPagina.close(); // Fecha a aba temporária
            return true;

        } catch (error) {
            console.error(`      ❌ Erro ao baixar PDF: ${error.message}`);
            return false;
        }
    },

    /**
     * NOVA FUNÇÃO: Extrai código de barras da tabela e baixa o PDF
     */
    baixarPDFComprovante: async (browser, numeroDARE) => {
        console.log(`⬇️ Iniciando procedimento de download para DARE ${numeroDARE}...`);
        
        try {
            // Construir a URL do PDF
            // URL Base: https://arr.economia.go.gov.br/arr-www/view/exibeDARE.jsf?codigo=...
            const domainBase = "https://arr.economia.go.gov.br/arr-www/view";
            const urlViewer = `${domainBase}/exibeDARE.jsf?codigo=${numeroDARE}`;

            // Criar pasta de downloads se não existir
            const pastaDownload = './comprovantes';
            if (!fs.existsSync(pastaDownload)){
                fs.mkdirSync(pastaDownload);
            }

            // Baixar o Arquivo (Abrindo nova aba para não sair da tela principal)
            const novaPagina = await browser.newPage();
            
            const client = await novaPagina.target().createCDPSession();
            await client.send('Network.enable'); // Ativa o monitoramento de rede

            console.log(`      📡 Monitor de rede ativado. Aguardando PDF...`);

            // --- A MÁGICA DA EXTRAÇÃO ---
            const promessaPDF = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => resolve(null), 30000); // 30s timeout

                client.on('Network.responseReceived', async (params) => {
                    const { response, requestId } = params;
                    
                    // Verifica se a resposta é um PDF (pelo MIME type)
                    // Isso ignora os GETs de HTML e pega só o POST do arquivo real
                    if (response.mimeType === 'application/pdf') {
                        console.log(`      🎣 PDF detectado na memória! (Status: ${response.status})`);
                        
                        try {
                            // Espera um pouco para garantir que o corpo da resposta baixou totalmente
                            // O evento loadingFinished seria o ideal, mas um delay costuma bastar
                            await new Promise(r => setTimeout(r, 2000));

                            // Extrai o corpo da resposta (o arquivo binário) direto do Chrome
                            const responseBody = await client.send('Network.getResponseBody', { requestId });
                            
                            clearTimeout(timeout);
                            resolve({ buffer: responseBody.body, isBase64: responseBody.base64Encoded });
                            
                        } catch (err) {
                            console.error(`      ❌ Erro ao extrair corpo do PDF: ${err.message}`);
                        }
                    }
                });
            });

            // 4. Acessa a página (Isso dispara o fluxo normal do navegador)
            console.log(`      🌍 Acessando Viewer...`);
            await novaPagina.goto(urlViewer, { waitUntil: 'networkidle0' });

            // 5. Aguarda a captura
            const dadosPDF = await promessaPDF;

            if (dadosPDF) {
                const nomeArquivo = path.join(pastaDownload, `Comprovante_${numeroDARE}.pdf`);
                
                // O CDP retorna base64, precisamos converter para Buffer
                const buffer = Buffer.from(dadosPDF.buffer, 'base64');
                fs.writeFileSync(nomeArquivo, buffer);
                
                console.log(`      ✅ SUCESSO! PDF extraído da memória e salvo: ${nomeArquivo}`);
                await novaPagina.close();
                return true;
            } else {
                console.error(`      ❌ Timeout: O PDF não foi identificado na rede.`);
                await novaPagina.close();
                return false;
            }

        } catch (error) {
            console.error(`      ❌ Erro técnico CDP: ${error.message}`);
            return false;
        }
    },
    /**
     * NOVA FUNÇÃO: Acessa o link do comprovante e tira um print da tela inteira.
     */
    tirarPrintComprovante: async (browser, diretorio, numeroDARE, processoSEI, configPerfil) => {
        console.log(`📸 Iniciando captura de tela do comprovante para DARE ${numeroDARE}...`);
        
        try {
            // 1. Garantir que o diretório existe (cria recursivamente se necessário)
            if (!fs.existsSync(diretorio)){
                fs.mkdirSync(diretorio, { recursive: true });
            }

            // 2. Montar o nome do arquivo conforme a regra especificada
            const link = `${configPerfil.url_base_comprovante}${numeroDARE}`;
            const textoFinal = configPerfil.configuracoes_fixas.texto_final || 'MARCADO'; 
            const nomeArquivo = `${processoSEI}_${textoFinal}_${numeroDARE}.pdf`;
            const caminhoCompleto = path.join(diretorio, nomeArquivo);

            // 3. Abrir nova aba para não interferir na página principal
            const novaPagina = await browser.newPage();
            
            console.log(`      🌍 Acessando visualizador: ${link}`);
            
            // Navega para o link e aguarda a rede ficar completamente ociosa (0 conexões ativas)
            await novaPagina.goto(link, { waitUntil: 'networkidle0', timeout: 30000 });

            console.log(`      ⏳ Aguardando renderização do documento...`);
            
            // 4. Espera estratégica pelo documento
            // Como vimos nos teus prints anteriores, a página usa um iframe para exibir o PDF
            try {
                await novaPagina.waitForSelector('iframe', { visible: true, timeout: 10000 });
            } catch (e) {
                console.log(`      ⚠️ Iframe não detectado, prosseguindo com espera fixa...`);
            }

            // 🛑 PAUSA FUNDAMENTAL: O visualizador de PDF do Chrome é uma extensão embutida.
            // Ele leva alguns segundos para "desenhar" o PDF na tela, mesmo após o carregamento da rede.
            await new Promise(r => setTimeout(r, 3000));

            // 5. Tirar o Print em PNG para evitar zoom exagerado
            console.log(`      📸 Capturando a tela (PNG em memória)...`);
            const screenshotBuffer = await novaPagina.screenshot({ fullPage: true });

            // 5.a Converter imagem para PDF usando uma página temporária
            const pdfPage = await browser.newPage();
            const base64Img = screenshotBuffer.toString('base64');
            await pdfPage.setContent(`<html><body style="margin:0"><img src="data:image/png;base64,${base64Img}" style="width:100%;height:auto"/></body></html>`);
            await pdfPage.pdf({ path: caminhoCompleto, printBackground: true });
            await pdfPage.close();

            console.log(`      ✅ Sucesso! Print salvo em: ${caminhoCompleto}`);
            
            await novaPagina.close();
            return true;

        } catch (error) {
            console.error(`      ❌ Erro ao tirar print do comprovante: ${error.message}`);
            return false;
        }
    },

    extrairComprovanteNativo: async (browser, diretorio, numeroDARE, processoSEI, configPerfil) => {
        console.log(`📸 Iniciando extração cirúrgica do comprovante para DARE ${numeroDARE}...`);
        
        try {
            if (!fs.existsSync(diretorio)){
                fs.mkdirSync(diretorio, { recursive: true });
            }

            const link = `${configPerfil.url_base_comprovante}${numeroDARE}`;
            const textoFinal = configPerfil.configuracoes_fixas.texto_final || 'MARCADO'; 
            const nomeArquivo = `${processoSEI}_${textoFinal}_${numeroDARE}.pdf`;
            const caminhoCompleto = path.join(diretorio, nomeArquivo);

            const novaPagina = await browser.newPage();
            
            // 1. O PULO DO GATO: Ativa o modo de interceptação total
            await novaPagina.setRequestInterception(true);

            // Criamos uma Promise para gerenciar a extração
            const pdfPromise = new Promise((resolve, reject) => {
                novaPagina.on('request', async (request) => {
                    
                    // 2. Quando a página tentar fazer o POST que gera o PDF
                    if (request.method() === 'POST' && request.isNavigationRequest()) {
                        console.log(`      📥 Navegação POST detectada. Bloqueando visualizador do Chrome...`);
                        
                        try {
                            const url = request.url();
                            const postData = request.postData();
                            const headers = request.headers();

                            // 3. CANCELA A NAVEGAÇÃO! O Chrome não vai carregar a extensão.
                            // A página ficará "congelada" no formulário invisível.
                            await request.abort();

                            console.log(`      ⚙️ Recriando requisição via Fetch interno...`);

                            // 4. Injeta o fetch na página congelada repassando todos os dados do form
                            const base64 = await novaPagina.evaluate(async (fetchUrl, fetchHeaders, fetchBody) => {
                                // Limpa headers criados pelo navegador que fazem o Fetch falhar por segurança
                                const safeHeaders = { ...fetchHeaders };
                                delete safeHeaders['host'];
                                delete safeHeaders['origin'];
                                delete safeHeaders['referer'];
                                delete safeHeaders['user-agent'];
                                delete safeHeaders['accept'];
                                delete safeHeaders['upgrade-insecure-requests'];
                                delete safeHeaders['connection'];
                                delete safeHeaders['content-length']; // Crucial deletar: O fetch calcula sozinho

                                const response = await fetch(fetchUrl, {
                                    method: 'POST',
                                    headers: safeHeaders,
                                    body: fetchBody
                                });

                                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

                                // Conversão do binário puro
                                const arrayBuffer = await response.arrayBuffer();
                                let binary = '';
                                const bytes = new Uint8Array(arrayBuffer);
                                const len = bytes.byteLength;
                                for (let i = 0; i < len; i++) {
                                    binary += String.fromCharCode(bytes[i]);
                                }
                                return window.btoa(binary);

                            }, url, headers, postData);

                            resolve(base64);

                        } catch (err) {
                            reject(new Error('Falha no Fetch interno: ' + err.message));
                        }
                    } else {
                        // Permite que qualquer outra requisição flua normalmente (como o acesso à tela inicial)
                        request.continue();
                    }
                });
            });

            console.log(`      🌍 Acessando página do comprovante: ${link}`);
            
            // O catch vazio é proposital: como nós abortamos a requisição POST, 
            // o Puppeteer pode lançar um erro de net::ERR_ABORTED, o que significa que nosso plano funcionou!
            novaPagina.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

            console.log(`      ⏳ Extraindo arquivo final...`);

            // Corrida de 30 segundos
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Tempo limite aguardando a geração do PDF.')), 30000)
            );

            const pdfBase64 = await Promise.race([pdfPromise, timeoutPromise]);

            // Limpa a memória e fecha a aba oculta
            await novaPagina.setRequestInterception(false);
            await novaPagina.close();

            // 5. Salva no disco
            if (pdfBase64) {
                fs.writeFileSync(caminhoCompleto, Buffer.from(pdfBase64, 'base64'));
                console.log(`      ✅ Sucesso Absoluto! PDF original salvo em: ${caminhoCompleto}`);
                return true;
            }

            return false;

        } catch (error) {
            console.error(`      ❌ Erro ao extrair comprovante: ${error.message}`);
            // Força fechamento da aba se um erro catastrófico ocorrer
            try { 
                const paginas = await browser.pages();
                if(paginas.length > 1) await novaPagina.close(); 
            } catch(e){}
            return false;
        }
    }
};

module.exports = navigationUtils;