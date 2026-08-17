# Esqueleto Padrão para Desenvolvimento de Bots (Blueprint)

**Data:** 30 de Março de 2026
**Versão:** 1.0

---

## 1. Introdução

Este documento serve como um **esqueleto padrão (blueprint)** para a criação de novos bots de automação no projeto `automacao_gefin_app`. Ele visa garantir a padronização, robustez, manutenibilidade e a rápida contextualização para desenvolvedores e IAs que necessitem criar ou modificar bots. Ao seguir esta estrutura, asseguramos que todos os bots compartilhem uma base sólida de funcionalidades essenciais, tratamento de erros e práticas de logging.

---

## 2. Estrutura de Arquivos e Importações Essenciais

Todo novo bot deve ser criado na pasta `src/backend/bots/` e fará uso de um conjunto padrão de utilitários localizados em `src/backend/utils/`. As importações iniciais devem seguir o modelo abaixo:

```javascript
const puppeteer = require('puppeteer');
const path = require('path');
const fileUtils = require('../utils/file-utils');
const pptUtils = require('../utils/puppeteer-utils'); // Funções de interação com Puppeteer
const navUtils = require('../utils/navigation-utils'); // Funções de navegação e delays
const logger = require('../utils/logger'); // Sistema de logging
const { dialog } = require('electron'); // Para interação com o usuário via Electron (se aplicável)

// Outras importações específicas do bot, se houver
```

---

## 3. Template da Função Principal do Bot

A função principal de cada bot deve ser assíncrona e exportada, recebendo parâmetros essenciais para sua operação. Ela deve encapsular toda a lógica do bot, incluindo inicialização, loop de processamento e finalização, com tratamento de erros robusto.

```javascript
async function executarNomeDoBot(configPerfil, caminhoExcel, diretorioSaida, enviarLog, controle) {
    // Helper para logar na tela E no arquivo txt ao mesmo tempo
    const logTotal = (msg) => {
        enviarLog(msg); // Envia para o frontend
        logger.gravarLogSistema(`[BOT-${configPerfil.nome}] ${msg}`); // Grava em arquivo
    };

    logTotal('🚀 Inicializando Bot: [Nome do Bot]...');
    let browser = null;
    const resultados = []; // Armazena status de cada linha para o relatório final

    try {
        // 1. Preparar Pastas de Evidências e Relatórios
        logTotal('📂 Preparando diretórios de evidências...');
        const diretorios = fileUtils.prepararDiretorios(diretorioSaida, configPerfil.nome);
        logTotal(`   ↳ Salvo em: ${diretorios.base}`);

        // 2. Leitura da Planilha de Entrada (se aplicável)
        // logTotal(`📊 Lendo planilha: ${caminhoExcel}`);
        // const dados = await fileUtils.lerExcelInput(caminhoExcel);
        // logTotal(`   ✅ ${dados.length} linhas encontradas.`);
        const dados = []; // Substituir pela leitura real ou remover se não usar Excel

        // 3. Abrir Navegador
        logTotal('🌍 Abrindo navegador...');
        browser = await puppeteer.launch({ 
            headless: false, 
            defaultViewport: null, 
            args: ['--start-maximized'] 
        });
        const page = (await browser.pages())[0] || await browser.newPage();

        // 4. Login Manual (Handshake) - Padrão de Segurança
        logTotal('🔐 Acedendo ao portal para Login...');
        await page.goto(configPerfil.url_portal, { waitUntil: 'domcontentloaded' });
        
        logTotal('⚠️  AÇÃO NECESSÁRIA: Faça o Login manualmente no navegador.');
        logTotal('👉 O robô aguarda você estar na tela inicial do sistema. ⚠️  Aguardando confirmação do usuário...');

        const respostaUsuario = await dialog.showMessageBox({
            type: 'info',
            title: 'Aguardando Login',
            message: 'Ação Necessária:',
            detail: '1. Faça o login no portal.\n2. Navegue até chegar na tela inicial correta.\n3. Clique em "Iniciar Processamento" abaixo para soltar o robô.',
            buttons: ['Iniciar Processamento', 'Cancelar'],
            defaultId: 0,
            cancelId: 1
        });
        
        if (respostaUsuario.response === 1) {
            throw new Error('Operação cancelada pelo usuário durante o login.');
        }

        logTotal('✅ Confirmação recebida! Iniciando automação...');

        // 5. Loop de Processamento (se aplicável, para cada item da planilha)
        for (let i = 0; i < dados.length; i++) { // Adaptar ou remover se não houver loop
            // --- VERIFICAÇÃO DE PARADA ---
            if (controle && controle.abortar) {
                logTotal('⏹️  Processo interrompido pelo usuário.');
                break; // Sai do loop for
            }

            const linha = dados[i]; // Dados da linha atual
            const numLinha = i + 1;
            const idProcesso = linha[configPerfil.mapeamento_colunas.PROCESSO] || `Linha_${numLinha}`; // Identificador único para logs/evidências
            
            logTotal(`▶️  Processando ${numLinha}/${dados.length} - Processo: ${idProcesso}`);

            try {
                // --- LÓGICA ESPECÍFICA DO BOT AQUI ---
                // Exemplo: Navegação para formulário
                // await page.goto(configPerfil.url_formulario_direto, { waitUntil: 'domcontentloaded' });

                // Exemplo: Interação com campos usando pptUtils
                // let contexto = await pptUtils.aguardarContextoDoCampo(page, 'campoExemplo');
                // await pptUtils.preencherTexto(contexto, 'campoTexto', linha.valor);
                // await pptUtils.marcarOpcao(contexto, 'radioOpcao', 'valorRadio');

                // Exemplo: Submissão de formulário com validação de dialog
                // const seletorBotaoConfirmar = 'input[value="Confirmar"]';
                // const mensagemDoServidor = await pptUtils.submeterFormularioComValidacao(page, seletorBotaoConfirmar);
                // if (mensagemDoServidor.toLowerCase().includes('sucesso')) {
                //     logTotal(`   ✅ Operação realizada com sucesso para ${idProcesso}`);
                //     await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
                // } else {
                //     throw new Error(`Rejeição do servidor: ${mensagemDoServidor}`);
                // }

                // --- FIM DA LÓGICA ESPECÍFICA ---

                // Captura de Evidência de Sucesso
                const screenshotPath = path.join(diretorios.evidencias, `${idProcesso}_SUCESSO.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true });
                
                // Registra Sucesso
                resultados.push({ status: 'SUCESSO',  linha: numLinha, dados: linha, mensagem: 'Processado com sucesso', numeroOP: '' });
                logTotal(`   ✅ Sucesso!`);

            } catch (erroLinha) {
                logTotal(`   ❌ Erro na linha ${numLinha}: ${erroLinha.message}`);
                
                // Captura de Evidência de Erro
                const screenshotPath = path.join(diretorios.evidencias, `${idProcesso}_ERRO.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true }).catch(()=>{});

                resultados.push({ status: 'ERRO', linha: numLinha, dados: linha, mensagem: erroLinha.message, numeroOP: '' });
            }
        }

        // 6. Finalização e Relatórios
        logTotal('💾 Gerando relatórios finais...');
        const resumo = await fileUtils.exportarRelatorios(diretorios.planilhas, resultados);
        
        logTotal('🏁 PROCESSO CONCLUÍDO!');
        logTotal(`   Sucessos: ${resumo.qtdSucesso} | Erros: ${resumo.qtdErro}`);
        logTotal(`   Arquivos salvos em: ${diretorios.base}`);

        return { sucesso: true, resumo };

    } catch (error) {
        logTotal(`❌ ERRO FATAL NO BOT: ${error.message}`);
        return { sucesso: false, erro: error.message };
    } finally {
        if (browser) await browser.close();
    }
}

module.exports = { executarNomeDoBot }; // Renomear para o nome real do bot
```

---

## 4. Padrões de Interação e Robustez

### 4.1. Uso de `puppeteer-utils.js`

Sempre utilize as funções auxiliares de `puppeteer-utils.js` para interagir com a página. Elas encapsulam lógicas de espera, tratamento de frames e manipulação de elementos, tornando o bot mais resiliente a variações de carregamento e estrutura do DOM.

- `pptUtils.aguardarContextoDoCampo(page, 'nomeCampo')`: Espera por um campo em qualquer frame.

- `pptUtils.preencherTexto(contexto, 'nomeCampo', 'valor')`: Preenche campos de texto.

- `pptUtils.marcarOpcao(contexto, 'nomeCampo', 'valor')`: Marca radio buttons ou checkboxes.

- `pptUtils.existeTextoNaPagina(page, 'texto')`: Verifica a presença de texto na página.

- `pptUtils.submeterFormularioComValidacao(page, 'seletorBotao')`: **NOVO PADRÃO** para submissão de formulários que dependem de `dialogs` (alertas) do servidor para feedback. Esta função já inclui o bypass de `verificarCampos` e a captura da mensagem do alerta.

### 4.2. Tratamento de Navegação e Delays

- `page.waitForNavigation({ waitUntil: 'domcontentloaded' })`: Use sempre que um clique ou ação puder resultar em uma nova navegação de página.

- `page.waitForNavigation({ waitUntil: 'networkidle0' })`: Pode ser usado após submissões para garantir que todas as requisições de rede foram concluídas.

- `navUtils.delay(milissegundos)`: Utilize delays estratégicos para aguardar o carregamento visual ou processamento assíncrono do front-end, especialmente antes de interagir com novos elementos.

### 4.3. Tratamento de Erros e Logging

- **Blocos ****`try...catch`**: Essenciais para cada etapa crítica do loop de processamento, permitindo capturar erros específicos de uma linha e continuar o processamento das demais.

- **`logTotal(msg)`**: Utilize este helper para todas as mensagens de log, garantindo que elas sejam exibidas no frontend e persistidas em arquivo.

- **`resultados.push(...)`**: Registre o status (SUCESSO/ERRO) e mensagens detalhadas para cada item processado, que serão compilados no relatório final.

---

## 5. Configuração (`profiles.json`)

Lembre-se que os seletores e URLs devem ser configuráveis via `profiles.json` sempre que possível, para facilitar a adaptação do bot a diferentes ambientes ou mudanças no sistema alvo. O bot deve receber `configPerfil` como argumento e utilizá-lo para acessar essas configurações.

```json
// Exemplo de estrutura em profiles.json
{
    "nome": "Bot Exemplo",
    "url_portal": "https://exemplo.com.br/login",
    "url_formulario_direto": "https://exemplo.com.br/cadastro",
    "mapeamento_colunas": {
        "PROCESSO": "ID Processo",
        "CAMPO_DADOS": "Coluna Excel"
    },
    "configuracoes_fixas": {
        "campo_tipo_pessoa": "tipoPessoa",
        "campo_cpf_cnpj": "cpfCnpj",
        "botao_incluir": "Incluir",
        "pessoa_fisica": {
            "value": "F",
            "campo_nome_cadastro": "nomePessoaFisica",
            "msg_nao_encontrado": "Nenhuma pessoa física encontrada"
        },
        "pessoa_juridica": {
            "value": "J",
            "campo_nome_cadastro": "nomePessoaJuridica",
            "msg_nao_encontrado": "Nenhuma pessoa jurídica encontrada"
        }
    }
}
```

---

## 6. Considerações Finais

- **Comentários**: Mantenha o código bem comentado, explicando a lógica de negócio e as decisões técnicas.

- **Reuso**: Priorize o reuso de funções existentes em `puppeteer-utils.js`, `file-utils.js`, `navigation-utils.js` e `logger.js`.

- **Testes**: Sempre que possível, teste o bot em um ambiente de homologação antes de implantar em produção.

Ao seguir este blueprint, garantimos que cada novo bot seja desenvolvido com a mesma qualidade e profissionalismo dos bots existentes, facilitando a manutenção e a escalabilidade do projeto.

