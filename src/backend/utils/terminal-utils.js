/**
 * 
 * @param {Page} pagina - A página puppeteer (o pai dos frames).
 * @returns {Frame}
 */
async function obterFrameAtivoPorCols(pagina) {
    // 1. Obtém o elemento frameset principal
    const framesetHandle = await pagina.waitForSelector('#gx_winFrameSet', { timeout: 5000 });

    if (!framesetHandle) throw new Error("Elemento #gx_winFrameSet não encontrado.");

    // 2. Lê o valor do atributo 'cols'
    const cols = await pagina.evaluate(el => el.getAttribute('cols'), framesetHandle);
    
    // console.log(`--> [DEBUG] Estado do Frameset cols: "${cols}"`);

    // 3. Localiza os frames pelo nome (sufixo)
    // Precisamos garantir que pegamos os frames corretos
    const frameLeft = pagina.frames().find(f => f.name().endsWith('_left'));
    const frameRight = pagina.frames().find(f => f.name().endsWith('_right'));

    if (!frameLeft || !frameRight) {
        throw new Error("Não foi possível localizar os frames _left ou _right.");
    }

    // 4. Lógica de Decisão baseada em:
    // "100%,*,..." significa que o primeiro frame (Left) ocupa tudo.
    // "*,100%,..." significa que o segundo frame (Right) ocupa tudo.
    
    // Pequeno delay de segurança para garantir que o frame terminou de renderizar o conteúdo internoo.
    await new Promise(r => setTimeout(r, 200));

    if (cols.startsWith('100%')) {
        return frameLeft;
    } else {
        return frameRight;
    }
}

/**
 * Preenche campos de data fragmentados (DD MM AAAA) onde o cursor pula automaticamente.
 * @param {Frame} frame - O frame ativo.
 * @param {String} textoRotulo - O texto visual ao lado do primeiro campo (ex: "DATA").
 * @param {String|Array} valores - Uma data "01012026" OU uma lista de datas ["012026", "022026"].
 */
async function preencherDataMultipartida(frame, textoRotulo, valores) {
    // 1. Normalização: Garante que tratamos sempre como uma lista
    const listaValores = Array.isArray(valores) ? valores : [valores];

    console.log(`--> [DATA] Iniciando preenchimento múltiplo para "${textoRotulo}" (${listaValores.length} valores)...`);

    // 2. Localizar o PRIMEIRO input da sequência visualmente (apenas uma vez)
    // A suposição é que o cursor pulará para os próximos inputs automaticamente
    const handleInputInicial = await frame.evaluateHandle((textoBusca) => {
        const spans = Array.from(document.querySelectorAll('#gx_screenArea span'));
        const labelSpan = spans.find(s => s.innerText.replace(/\u00a0/g, '').includes(textoBusca.replace(/\s/g, '')));
        
        if (!labelSpan) return null;

        const topLabel = parseFloat(labelSpan.style.top);
        const leftLabel = parseFloat(labelSpan.style.left);
        const inputs = Array.from(document.querySelectorAll('#gx_screenArea input:not([type="hidden"])'));

        // Encontra o input mais próximo à direita e na mesma linha
        return inputs.find(input => {
            const topInput = parseFloat(input.style.top);
            const leftInput = parseFloat(input.style.left);
            return Math.abs(topInput - topLabel) < 15 && leftInput > leftLabel;
        });
    }, textoRotulo);

    if (!handleInputInicial.asElement()) {
        throw new Error(`Campo inicial de data ao lado de "${textoRotulo}" não encontrado.`);
    }

    // 3. Focar no primeiro campo encontrado
    await handleInputInicial.click();
    
    // Limpar por segurança (apenas o primeiro campo onde clicamos)
    await frame.page().keyboard.press('Backspace');
    await frame.page().keyboard.press('Backspace');

    // 4. Loop para digitar cada data da lista sequencialmente
    for (let i = 0; i < listaValores.length; i++) {
        const valorBruto = listaValores[i];
        const valorLimpo = String(valorBruto).replace(/\D/g, ''); // Remove barras/pontos
        
        let dia = null, mes = null, ano = null;

        // Detecção do formato (DDMMAAAA ou MMAAAA)
        if (valorLimpo.length === 8) {
            dia = valorLimpo.substring(0, 2);
            mes = valorLimpo.substring(2, 4);
            ano = valorLimpo.substring(4, 8);
        } else if (valorLimpo.length === 6) {
            mes = valorLimpo.substring(0, 2);
            ano = valorLimpo.substring(2, 6);
        } else {
            throw new Error(`Valor de data inválido na posição ${i}: "${valorBruto}". Use 6 ou 8 dígitos.`);
        }

        // --- Digitação dos Fragmentos ---

        if (dia) {
            await frame.page().keyboard.type(dia, { delay: 100 });
            await new Promise(r => setTimeout(r, 200)); // Pulo Dia -> Mês
        }

        await frame.page().keyboard.type(mes, { delay: 100 });
        await new Promise(r => setTimeout(r, 200)); // Pulo Mês -> Ano

        await frame.page().keyboard.type(ano, { delay: 100 });

        // Se houver mais datas na lista, faz uma pausa maior para pular o separador visual (ex: " A ")
        if (i < listaValores.length - 1) {
            console.log(`   ...pulo para o próximo campo...`);
            await new Promise(r => setTimeout(r, 600)); // Pausa para o cursor saltar o " A "
        }
    }
    
    // Confirmação final (Tab para sair do último campo)
    await frame.page().keyboard.press('Tab');
    
    console.log("--> [DATA] Sequência concluída.");
}

/**
 * Lê o conteúdo do "Terminal" (div gx_screenArea) e retorna o texto reconstruído.
 * Esta função é essencial porque o texto está fragmentado em spans posicionados.
 */
async function lerTextoTerminal(frame) {
    return await frame.evaluate(() => {
        // Seleciona todos os spans dentro da área da tela
        const spans = Array.from(document.querySelectorAll('#gx_screenArea span'));
        
        // Ordena visualmente: primeiro pelo TOPO (linha), depois pela ESQUERDA (coluna)
        spans.sort((a, b) => {
            const topA = parseFloat(a.style.top);
            const topB = parseFloat(b.style.top);
            const leftA = parseFloat(a.style.left);
            const leftB = parseFloat(b.style.left);
            
            // Margem de erro pequena para alinhar itens na mesma linha (ex: 5px)
            if (Math.abs(topA - topB) > 5) {
                return topA - topB;
            }
            return leftA - leftB;
        });

        // Concatena o texto
        let textoCompleto = "";
        let ultimoTop = -1;

        spans.forEach(span => {
            const topAtual = parseFloat(span.style.top);
            // Se mudou de linha significativamente, adiciona quebra de linha
            if (ultimoTop !== -1 && Math.abs(topAtual - ultimoTop) > 5) {
                textoCompleto += "\n";
            }
            // Pega o texto e limpa espaços não quebráveis (&nbsp;)
            textoCompleto += span.innerText.replace(/\u00a0/g, " "); 
            ultimoTop = topAtual;
        });

        return textoCompleto;
    });
}

/**
 * Encontra o número da opção baseada no nome do menu.
 * Ex: Se a tela tem "4 - RECEITA", e passamos "RECEITA", retorna "4".
 */
function encontrarOpcaoDinamica(textoTela, nomeMenu) {
    // Normaliza o texto da tela (remove excesso de espaços entre letras se houver)
    // Muitos terminais mostram "R E C E I T A". Vamos compactar espaços múltiplos.
    const linhas = textoTela.split('\n');
    
    for (const linha of linhas) {
        // Remove espaços duplicados para facilitar a busca
        const linhaLimpa = linha.replace(/\s+/g, ' ').trim();
        
        // Verifica se a linha contém o nome do menu desejado
        if (linhaLimpa.includes(nomeMenu)) {
            // Regex para capturar o número no início da linha ou antes de um hífen
            // Espera algo como "4-RECEITA" ou "4 - RECEITA" ou "04 RECEITA"
            const match = linhaLimpa.match(/^(\d+)[\s-]*.*$/);
            if (match) {
                return match[1]; // Retorna o número (ex: "4")
            }
            
            // Tentativa secundária: Procura número imediatamente antes do texto
            // Ex: "4 RECEITA"
            const regexInLine = new RegExp(`(\\d+)[\\s-]*${nomeMenu}`);
            const matchInline = linhaLimpa.match(regexInLine);
            if (matchInline) {
                return matchInline[1];
            }
        }
    }
    throw new Error(`Menu "${nomeMenu}" não encontrado na tela.`);
}

/**
 * Localiza o input que está atualmente ativo (focado) ou o primeiro campo editável disponível.
 * Útil para telas onde o cursor já nasce posicionado e só existe uma ação possível.
 * @param {Frame} frame - O frame onde o terminal está carregado.
 * @returns {Promise<ElementHandle>} O ponteiro do Puppeteer para o input.
 */
async function localizarInputAtivo(frame) {
    console.log("--> [AUTO-FOCUS] Procurando input ativo ou primeiro editável...");

    const handleInput = await frame.evaluateHandle(() => {
        // 1. Tenta pegar quem tem o foco real do navegador
        const ativo = document.activeElement;
        
        // Verifica se o elemento focado é realmente um input de texto
        if (ativo && (ativo.tagName === 'INPUT' || ativo.tagName === 'TEXTAREA')) {
            return ativo;
        }

        // 2. Fallback: Se o foco estiver no 'body' (comum ao carregar frames), 
        // pega o primeiro input visualmente disponível e editável.
        const todosInputs = Array.from(document.querySelectorAll('#gx_screenArea input'));
        
        const inputDisponivel = todosInputs.find(el => {
            const estilo = window.getComputedStyle(el);
            return (
                el.type !== 'hidden' &&          // Não é oculto
                !el.disabled &&                  // Não está desativado
                !el.readOnly &&                  // Não é apenas leitura
                estilo.display !== 'none' &&     // É visível no CSS
                estilo.visibility !== 'hidden'
            );
        });

        return inputDisponivel || null;
    });

    if (!handleInput.asElement()) {
        throw new Error("Não foi possível encontrar nenhum input ativo ou editável nesta tela.");
    }

    // Opcional: Garante que o elemento receba o foco visual se foi achado pelo fallback
    await handleInput.focus();

    return handleInput;
}

// --- FUNÇÕES DE INTERAÇÃO COM O TERMINAL ---

/**
 * Pressiona ENTER no frame do terminal.
 * Inclui um pequeno delay para garantir que o processamento do mainframe iniciou.
 */
async function enviarEnter(frame) {
    console.log("--> [TECLADO] Pressionando ENTER...");
    await frame.page().keyboard.press('Enter');
    // Espera "técnica" para o mainframe reagir (comum em emuladores 3270/web)
    await new Promise(r => setTimeout(r, 1000));
}

/**
 * Preenche um input baseado no ID exato (ex: "POS366").
 * Verifica dinamicamente se o frame mudou durante a espera pelo seletor.
 */
async function preencherInputPorId(page, idPosicao, valor) {
    let frame = await obterFrameAtivoPorCols(page);
    const frameNomeInicial = frame.name();
    const seletor = `input[id="${idPosicao}"]`;

    console.log(`--> [INPUT] Procurando campo ID "${idPosicao}" no frame ${frameNomeInicial}...`);

    try {
        // 1. Espera pelo seletor no frame obtido (com timeout)
        try {
            await frame.waitForSelector(seletor, { timeout: 15000 });
        } catch (timeoutError) {
            // Seletor não apareceu no tempo esperado, não é erro fatal ainda
            console.warn(`--> [AVISO] Seletor não encontrado em ${frameNomeInicial} dentro do timeout. Verificando frame...`);
        }

        // 2. Aguarda transições de rede/página antes de verificar frame
        try {
            await page.waitForNetworkIdle({ timeout: 3000 });
        } catch (e) {
            // Network idle timeout é aceitável
        }

        // 3. Verifica se o frame mudou durante a espera
        const frameAtivo = await obterFrameAtivoPorCols(page);
        const frameNomeAtual = frameAtivo.name();

        if (frameNomeAtual !== frameNomeInicial) {
            console.warn(`--> [AVISO] Frame mudou de "${frameNomeInicial}" para "${frameNomeAtual}". Continuando no novo frame...`);
            frame = frameAtivo;
        }

        // 4. Preenche o campo no frame correto (atual)
        try {
            await frame.$eval(seletor, el => el.value = '');
            await frame.type(seletor, String(valor), { delay: 50 });
            console.log(`--> [INPUT] ✅ Campo preenchido: ID ${idPosicao} = "${valor}" (Frame: ${frame.name()})`);
        } catch (preencherError) {
            throw new Error(`Falha ao preencher seletor "${seletor}": ${preencherError.message}`);
        }

    } catch (erro) {
        console.error(`❌ Erro ao preencher input ${idPosicao}:`, erro.message);
        throw new Error(`Não foi possível preencher o input com ID "${idPosicao}".`);
    }
}

/**
 * Encontra um input visualmente alinhado com um texto, permitindo escolher a direção.
 * * @param {Frame} frame - O frame do terminal.
 * @param {String} textoRotulo - O texto âncora (Label).
 * @param {String} valor - O valor a ser preenchido.
 * @param {String} [direcao='ambos'] - 'direita', 'esquerda' ou 'ambos' (padrão).
 */
async function preencherInputAoLadoDoTexto(frame, textoRotulo, valor, direcao = 'ambos') {
    console.log(`--> [BUSCA INTELIGENTE] Procurando campo ao lado de: "${textoRotulo}" (Direção: ${direcao})...`);
    
    const inputEncontrado = await frame.evaluate((textoBusca, valorParaDigitar, dir) => {
        // 1. Achar o SPAN do rótulo
        const spans = Array.from(document.querySelectorAll('#gx_screenArea span'));
        const labelSpan = spans.find(s => s.innerText.replace(/\u00a0/g, '').includes(textoBusca.replace(/\s/g, '')));

        if (!labelSpan) return { sucesso: false, erro: `Texto "${textoBusca}" não encontrado.` };

        // 2. Pegar coordenadas do rótulo
        const topLabel = parseFloat(labelSpan.style.top);
        const leftLabel = parseFloat(labelSpan.style.left);

        // 3. Achar inputs visíveis
        const inputs = Array.from(document.querySelectorAll('#gx_screenArea input:not([type="hidden"])'));

        // 4. Filtrar inputs na mesma LINHA (margem de erro vertical de 15px)
        const inputsNaLinha = inputs.filter(input => {
            const topInput = parseFloat(input.style.top);
            return Math.abs(topInput - topLabel) < 15;
        });

        // 5. Calcular distâncias e filtrar pela direção
        const candidatos = inputsNaLinha.map(input => {
            const leftInput = parseFloat(input.style.left);
            const diferenca = leftInput - leftLabel; // Positivo = Direita, Negativo = Esquerda
            return {
                element: input,
                distancia: diferenca,
                distanciaAbsoluta: Math.abs(diferenca) // Para saber quem está mais perto
            };
        }).filter(candidato => {
            if (dir === 'direita') return candidato.distancia > 0;
            if (dir === 'esquerda') return candidato.distancia < 0;
            return true; // 'ambos' aceita tudo
        });

        // 6. Encontrar o input MAIS PRÓXIMO visualmente
        // Isso evita pegar um input que está na mesma linha mas muito longe
        candidatos.sort((a, b) => a.distanciaAbsoluta - b.distanciaAbsoluta);

        const inputAlvo = candidatos.length > 0 ? candidatos[0].element : null;

        if (inputAlvo) {
            inputAlvo.value = valorParaDigitar;
            // Disparar eventos
            inputAlvo.dispatchEvent(new Event('input', { bubbles: true }));
            inputAlvo.dispatchEvent(new Event('change', { bubbles: true }));
            inputAlvo.dispatchEvent(new Event('blur', { bubbles: true }));
            return { sucesso: true, id: inputAlvo.id };
        } else {
            return { sucesso: false, erro: `Nenhum input encontrado na direção '${dir}' de "${textoBusca}"` };
        }

    }, textoRotulo, valor, direcao);

    if (!inputEncontrado.sucesso) {
        throw new Error(inputEncontrado.erro);
    } else {
        console.log(`--> [SUCESSO] Campo preenchido (ID: ${inputEncontrado.id}).`);
    }
}

/**
 * Aguarda a abertura de uma nova aba e retorna o objeto 'page' correspondente.
 * @param {Browser} browser - Instância do navegador Puppeteer.
 * @param {String} urlParcial - Parte da URL fixa que identifica a nova aba (ex: 'instant.html').
 */
async function trocarParaNovaAba(browser, urlParcial) {
    console.log(`--> [NAVEGADOR] Aguardando nova aba com URL contendo: "${urlParcial}"...`);
    
    // Espera que um novo alvo (aba/janela) seja criado e corresponda à URL
    const novoTarget = await browser.waitForTarget(target => 
        target.url().includes(urlParcial)
    , { timeout: 5000 }); // 5 segundos de timeout

    if (!novoTarget) {
        throw new Error("Nova aba não foi detetada a tempo.");
    }
    
    const novaPagina = await novoTarget.page();
    await novaPagina.bringToFront();

    try {
        await novaPagina.evaluate(() => {
            if (document.readyState === 'loading') {
                return new Promise(resolve => {
                    document.addEventListener('DOMContentLoaded', resolve);
                });
            }
        });
    } catch (e) {
        console.log("Aviso: Verificação de carregamento ignorada (página já pode estar pronta).");
    }

    console.log("--> [SUCESSO] Controle transferido para a nova aba: " + novaPagina.url());
    
    return novaPagina; // Retorna a nova página para ser usada nas próximas funções
}

/**
 * Espera inteligente pela mudança do atributo 'cols' no frameset pai
 */
async function aguardarTrocaDeFrame(page) {
    try {
        const frameset = await page.$('#gx_winFrameSet');
        if (!frameset) return;

        const colsAntigo = await page.evaluate(el => el.getAttribute('cols'), frameset);
        
        // Espera até que o atributo mude OU timeout de 3s
        await page.waitForFunction((el, antigo) => el.getAttribute('cols') !== antigo, 
            { timeout: 3000, polling: 200 }, 
            frameset, colsAntigo
        ).catch(() => { /* Timeout silencioso se a tela não mudar */ });
        
    } catch (e) {
        // Ignora erros de espera, segue o fluxo
    }
}

/**
 * Percorre páginas de uma lista (1-12), encontra um registro e marca com 'x' no modal F3.
 * @param {Page} page - A página Puppeteer.
 * @param {String} textoBusca - O texto único que identifica a linha (ex: número do documento).
 * @param {number} maxPaginas - Limite de segurança para não ficar em loop infinito.
 */
async function buscarRegistroEmListaPaginada(page, textoBusca, maxPaginas = 10) {
    console.log(`\n📋 [LISTA] Iniciando busca por "${textoBusca}" em até ${maxPaginas} páginas...`);
    const delayAcoes = 500;

    for (let i = 1; i <= maxPaginas; i++) {
        const frame = await obterFrameAtivoPorCols(page);
        console.log(`   📄 Página ${i} (Frame: ${frame.name()})...`);

        // 1. Ler todo o texto da tela
        const textoTela = await lerTextoTerminal(frame);
        const linhas = textoTela.split('\n');

        // 2. Tentar encontrar a linha que contém o texto de busca
        // Normaliza espaços para evitar erros de comparação
        const linhaEncontrada = linhas.find(l => l.replace(/\s+/g, ' ').includes(textoBusca));

        if (linhaEncontrada) {
            console.log(`   ✅ Registro encontrado na linha: "${linhaEncontrada.trim()}"`);

            // 3. Extrair o índice visual (Número no início da linha)
            // Regex: Pega o primeiro número encontrado na linha (Ex: "01 - DOC..." -> "01")
            const matchIndice = linhaEncontrada.trim().match(/^(\d+)/);
            
            if (!matchIndice) {
                throw new Error(`Texto encontrado, mas não foi possível extrair o índice da linha: "${linhaEncontrada}"`);
            }
            
            let indiceVisual = matchIndice[1]; // Ex: "01" ou "1"
            
            // Remove zero à esquerda se necessário, ou mantém conforme aparece no modal F3
            // Geralmente no modal aparece igual à lista (ex: "01"). Vamos usar como capturado.
            console.log(`   🔢 Índice visual detectado: ${indiceVisual}`);

            // 4. Fluxo de Seleção (F3 -> Modal -> Marcar -> Enter)
            
            // Passo A: Apertar F3 (usando a nossa função de injeção 'teclar' adaptada internamente)
            // Vamos chamar o navegarNoTerminal para reutilizar a lógica robusta do F3
            await navegarNoTerminal(page, [{ acao: 'teclar', tecla: 'F3' }]);

            // Passo B: Preencher 'x' no input ao lado do número correspondente
            // O modal deve ter algo como "01 [ ]", "02 [ ]". Procuramos o rótulo "01" e pomos "x".
            // Importante: O frame pode ter mudado ou ser o mesmo (AJAX), o navegarNoTerminal já lidou com esperas.
            const frameModal = await obterFrameAtivoPorCols(page); // Reavalia frame
            
            await preencherInputAoLadoDoTexto(frameModal, indiceVisual, 'x');
            
            // Passo C: Confirmar
            await enviarEnter(frameModal);
            
            // Aguarda atualização da tela
            await new Promise(r => setTimeout(r, 1000));
            
            return; // SUCESSO - Sai da função
        }

        // 5. Se não encontrou, avança para a próxima página
        console.log(`   ❌ Não encontrado na página ${i}. Avançando...`);
        await enviarEnter(frame);
        
        // Espera a tela carregar (o Enter muda a página da lista)
        // Usamos a detecção de mudança de frameset cols se houver, ou delay fixo
        try {
            await page.waitForFunction((oldCols) => {
                 const el = document.getElementById('gx_winFrameSet');
                 return el && el.getAttribute('cols') !== oldCols;
            }, { timeout: 2000 }, await page.$eval('#gx_winFrameSet', el => el.getAttribute('cols')));
        } catch(e) {
            await new Promise(r => setTimeout(r, 1000)); // Fallback delay
        }
    }

    throw new Error(`Registro "${textoBusca}" não encontrado após percorrer ${maxPaginas} páginas.`);
}

/**
 * Lê o texto visualmente posicionado ao lado de um rótulo.
 * Útil para extrair dados da tela.
 * @param {Frame} frame - O frame ativo.
 * @param {String} textoRotulo - O texto âncora (ex: "SALDO:").
 * @param {String} [direcao='direita'] - 'direita' ou 'esquerda'.
 * @returns {Promise<String>} O texto encontrado ou null.
 */
async function lerTextoAoLadoDoRotulo(frame, textoRotulo, direcao = 'direita') {
    console.log(`--> [EXTRAÇÃO] Lendo texto à ${direcao} de "${textoRotulo}"...`);

    const resultado = await frame.evaluate((rotulo, dir) => {
        // 1. Encontrar o rótulo
        const spans = Array.from(document.querySelectorAll('#gx_screenArea span'));
        const labelSpan = spans.find(s => s.innerText.replace(/\u00a0/g, '').includes(rotulo.replace(/\s/g, '')));

        if (!labelSpan) return null;

        const topLabel = parseFloat(labelSpan.style.top);
        const leftLabel = parseFloat(labelSpan.style.left);

        // 2. Filtrar spans na mesma linha (exceto o próprio rótulo)
        const candidatos = spans.filter(span => {
            if (span === labelSpan) return false; // Ignora o próprio rótulo

            const topSpan = parseFloat(span.style.top);
            // Verifica alinhamento vertical (linha)
            const mesmaLinha = Math.abs(topSpan - topLabel) < 15;
            
            // Verifica direção
            const leftSpan = parseFloat(span.style.left);
            const naDirecaoCerta = (dir === 'direita') 
                ? leftSpan > leftLabel 
                : leftSpan < leftLabel;

            return mesmaLinha && naDirecaoCerta;
        });

        // 3. Encontrar o mais próximo
        if (candidatos.length === 0) return null;

        candidatos.sort((a, b) => {
            const distA = Math.abs(parseFloat(a.style.left) - leftLabel);
            const distB = Math.abs(parseFloat(b.style.left) - leftLabel);
            return distA - distB;
        });

        return candidates[0].innerText.replace(/\u00a0/g, ' ').trim();

    }, textoRotulo, direcao);

    if (resultado !== null) {
        console.log(`--> [SUCESSO] Valor lido: "${resultado}"`);
    } else {
        console.warn(`--> [AVISO] Nenhum texto encontrado à ${direcao} de "${textoRotulo}".`);
    }

    return resultado;
}

/**
 * Função auxiliar interna para lidar com Enter + Espera de carregamento (cols)
 */
async function confirmarMudancaDeTela(frame) {
    await enviarEnter(frame);
    // Como enviarEnter acessa frame.page(), precisamos passar o pai (page) para verificar o frameset
    await aguardarTrocaDeFrame(frame.page());
}

/**
 * Motor de Execução de Passos no Terminal.
 * Interpreta uma lista de comandos padronizados e executa as ações no frame correto.
 * * @param {Page} page - A página puppeteer (o pai dos frames).
 * @param {Array} passos - Array de objetos ou strings definindo o fluxo.
 */
async function navegarNoTerminal(page, passos) {
    const delayTeclado = 100;
    const delayTela = 1000; // Tempo base de espera entre telas

    for (const [index, passo] of passos.entries()) {
        // 1. Normalizar o passo (String vira objeto de menu)
        const comando = (typeof passo === 'string')
            ? { acao: 'menu', menu: passo }
            : passo;

        // 2. Descobrir onde está o terminal AGORA (Gestão de Frame Dinâmico)
        const frame = await obterFrameAtivoPorCols(page);
        console.log(`\n🔹 [PASSO ${index + 1}] Ação: ${comando.acao.toUpperCase()} | Frame: ${frame.name()}`);

        try {
            switch (comando.acao) {
                case 'menu':
                    console.log(`   🔎 Procurando opção de menu: "${comando.menu}"`);
                    const textoTela = await lerTextoTerminal(frame);
                    const numeroOpcao = encontrarOpcaoDinamica(textoTela, comando.menu);
                    
                    console.log(`   ✅ Encontrado: "${comando.menu}" = Opção [${numeroOpcao}]`);
                    
                    // Em terminais, geralmente digita-se o número num campo "Opção" ou solto
                    // Vamos tentar preencher no campo 'SELECIONE' ou similar, se falhar, digita solto
                    try {
                        if (comando.rotulo){
                            await preencherInputAoLadoDoTexto(frame, comando.rotulo, numeroOpcao, comando.direcao || 'ambos');
                        } else await preencherInputAoLadoDoTexto(frame, 'SELECIONE', numeroOpcao, comando.direcao || 'ambos');
                    } catch (e) {
                        await frame.page().keyboard.type(numeroOpcao, { delay: delayTeclado });
                    }
                    
                    // Menu quase sempre requer Enter para ir para a próxima tela
                    await confirmarMudancaDeTela(frame); 
                    break;

                case 'escrever':
                    // Ex: { acao: 'escrever', rotulo: 'MATRICULA', valor: '123456' }
                    await preencherInputAoLadoDoTexto(frame, comando.rotulo, comando.valor, comando.direcao || 'ambos');
                    break;

                case 'data':
                    // Ex: { acao: 'data', rotulo: 'DATA INICIO', valor: '01012026' }
                    await preencherDataMultipartida(frame, comando.rotulo, comando.valor);
                    break;

                case 'focado':
                    // Ex: { acao: 'focado', valor: '123' } ou { acao: 'focado', rotulo_menu: 'Opção X' }
                    const inputHandle = await localizarInputAtivo(frame);
                    
                    let valorFinal = comando.valor;
                    
                    // Caso especial: O valor depende de ler um número de menu na tela antes de digitar
                    if (comando.rotulo_menu) {
                        const txt = await lerTextoTerminal(frame);
                        valorFinal = encontrarOpcaoDinamica(txt, comando.rotulo_menu);
                    }

                    // Limpa (3 cliques + backspace) e digita
                    await inputHandle.click({ clickCount: 3 });
                    await inputHandle.press('Backspace');
                    await inputHandle.type(String(valorFinal), { delay: delayTeclado });
                    break;

                case 'teclar':
                    // Ex: { acao: 'teclar', tecla: 'Enter' }
                    const tecla = comando.tecla || 'Enter';

                    // --- NOVA LÓGICA PARA TECLAS DE FUNÇÃO (F1 - F12) ---
                    // Se for F3, F5, F12, etc., usamos a injeção direta no GX_ActionKey
                    if (/^F\d+$/.test(tecla)) {
                        const numeroF = tecla.substring(1); 
                        // Nota: Baseado no seu log, o site usa colchetes: "[pf3]"
                        const valorKey = `[pf${numeroF}]`; 

                        console.log(`   🔧 GeneXus: Definindo GX_ActionKey="${valorKey}" e acionando evento interno...`);

                        await frame.evaluate((key) => {
                            // 1. Define o valor no campo oculto
                            const actionInput = document.getElementById('GX_ActionKey');
                            if (actionInput) actionInput.value = key;

                            // 2. A MÁGICA: Invoca a função de postback nativa do site
                            // O HTML mostra que existe um botão #gx_HostKey que chama gx_postBack('gx_hostKey_Pressed')
                            // Vamos chamar essa função diretamente ou clicar no botão oculto.
                            if (typeof window.gx_postBack === 'function') {
                                window.gx_postBack('gx_hostKey_Pressed');
                            } else {
                                // Fallback: clica no botão oculto se a função não estiver no escopo direto
                                const btnHost = document.getElementById('gx_HostKey');
                                if (btnHost) btnHost.click();
                            }
                        }, valorKey);
                    } 
                    // --- LÓGICA PADRÃO PARA OUTRAS TECLAS (ENTER, TAB, ETC) ---
                    else {
                        console.log(`   ⌨️ Pressionando: ${tecla}`);
                        try { await frame.click('#gx_screenArea'); } catch(e) {} // Foco preventivo
                        
                        await frame.page().keyboard.press(tecla);
                        
                        if (tecla === 'Enter') {
                            await aguardarTrocaDeFrame(page);
                        }
                    }
                    break;

                case 'lista_selecionar':
                    // Ex: { acao: 'lista_selecionar', valor: 'DOC-12345', max_paginas: 5 }
                    // Nota: Como esta função manipula a navegação (F3, Enter), ela assume o controle temporário
                    await buscarRegistroEmListaPaginada(page, comando.valor, comando.max_paginas);
                    break;

                case 'extrair':
                    // Ex: { acao: 'extrair', rotulo: 'VALOR TOTAL:', direcao: 'direita' }
                    const valorLido = await lerTextoAoLadoDoRotulo(frame, comando.rotulo, comando.direcao);
                    // Aqui você pode salvar numa variável global ou contexto se precisar usar depois
                    global.VALOR_EXTRAIDO = valorLido; // Exemplo simples
                    break;
                case 'escrever_id':
                    await preencherInputPorId(page, comando.id, comando.valor);
                    break;

                default:
                    console.warn(`⚠️ Ação desconhecida: ${comando.acao}`);
            }

            // Pausa de segurança entre passos se houver navegação
            if (['menu', 'enter'].includes(comando.acao)) {
                 await new Promise(r => setTimeout(r, 100));
            }

        } catch (erro) {
            console.error(`❌ Erro no passo ${index + 1}:`, erro.message);
            throw erro; // Interrompe o fluxo para não fazer ações em cadeia erradas
        }
    }
}



module.exports ={ 
    obterFrameAtivoPorCols, 
    navegarNoTerminal, 
    lerTextoTerminal, 
    encontrarOpcaoDinamica, 
    localizarInputAtivo, 
    enviarEnter, 
    preencherInputPorId, 
    preencherInputAoLadoDoTexto, 
    trocarParaNovaAba, 
    preencherDataMultipartida,
    buscarRegistroEmListaPaginada,
    lerTextoAoLadoDoRotulo,
};