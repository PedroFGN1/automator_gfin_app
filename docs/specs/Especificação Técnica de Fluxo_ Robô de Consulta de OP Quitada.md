# Especificação Técnica de Fluxo: Robô de Consulta de OP Quitada

**Autor:** Manus AI
**Data:** 24 de Abril de 2026
**Versão:** 1.0
**Arquivos Base:** `consultar-op-quitada.js`

---

## 1. Visão Geral

O robô `consultar-op-quitada` foi desenvolvido para automatizar a consulta de Ordens de Pagamento (OP) no portal SIAFIC/SIOFI, verificar seu status de quitação e realizar o download nativo do PDF (Dueof). Ele desmembra o número completo da OP em seus cinco componentes para preenchimento nos campos específicos do formulário de consulta, garantindo a precisão da busca e a obtenção do comprovante de quitação.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `consultar-op-quitada.js` | **Orquestrador:** Gerencia o fluxo principal de consulta, leitura da planilha, interação com o navegador e salvamento de PDFs. |
| `puppeteer-utils.js` | **Interação:** Funções de baixo nível para clicar, digitar, injetar valores e aguardar elementos no contexto do navegador. |
| `navigation-utils.js` | **Navegação/Dados:** Funções auxiliares para controle de delays e navegação. |
| `file-utils.js` | **I/O:** Leitura de planilhas Excel, criação de diretórios e exportação de relatórios. |
| `logger.js` | **Rastreabilidade:** Gravação de logs persistentes em arquivo e console. |

---

## 2. Fluxo Operacional

### 2.1. Inicialização e Controle de Sessão

1.  **Preparação de Ambiente:** O robô utiliza `fileUtils.prepararDiretorios` para criar uma estrutura organizada de evidências e planilhas de saída no diretório especificado.
2.  **Leitura da Planilha:** Lê o arquivo Excel fornecido pelo usuário, esperando uma coluna contendo o número completo da OP, conforme configurado em `mapeamento_colunas.OP` no `profiles.json`.
3.  **Inicialização do Navegador:** Abre uma instância do navegador Chromium em modo não-headless e maximizado.
4.  **Login Manual:** Navega para a `url_portal` e aguarda a confirmação do usuário via `dialog.showMessageBox` do Electron, indicando que o login manual foi realizado e o portal está pronto para a automação.
5.  **Controle de Abortagem:** Um objeto `controle` permite que o usuário interrompa o processamento a qualquer momento.

### 2.2. Processamento de Linhas (Loop Stateless)

Para cada linha da planilha (cada OP a ser consultada), o robô executa os seguintes passos de forma independente:

1.  **Verificação de Abortagem:** Checa se o usuário solicitou o abortamento do processo.
2.  **Navegação Stateless:** Recarrega a `url_formulario_direto` para garantir que o formulário de consulta esteja limpo para cada nova OP.

### 2.3. Preenchimento dos Campos da OP

1.  **Validação do Formato da OP:** Verifica se o número da OP lido da planilha está no formato esperado (ex: `AAAA.BBBB.CCC.DDDDD.EEE`), com cinco partes separadas por pontos.
2.  **Desmembramento da OP:** Divide o número completo da OP em suas cinco partes constituintes.
3.  **Preenchimento dos Campos:** Utiliza `puppeteer-utils.aguardarContextoDoCampo` para garantir o contexto correto e `puppeteer-utils.preencherTexto` para injetar cada parte da OP nos campos correspondentes do formulário, conforme seletores definidos em `configuracoes_fixas.campos_op` no `profiles.json`:
    *   Exercício (`campo_exercicio`)
    *   Órgão (`campo_orgao`)
    *   Sequencial Dotação (`campo_sequencial_dotacao`)
    *   Empenho (`campo_empenho`)
    *   Sequencial OP (`campo_sequencial_op`)

### 2.4. Submissão da Consulta e Verificação de Quitação

1.  **Submissão:** Clica no botão "Consultar" (`configuracoes_fixas.botao_consultar`) e aguarda a navegação da página.
2.  **Verificação do Botão Dueof:** Após a submissão, o robô verifica a presença do botão "Dueof" (`configuracoes_fixas.botao_dueof`). A ausência deste botão indica que a OP não foi localizada, não está quitada ou houve algum erro na consulta.

### 2.5. Download do PDF

1.  **Extração da URL:** Extrai a URL de download do PDF contida no atributo `onclick` do botão "Dueof". Esta abordagem é utilizada para contornar o visualizador de PDF nativo do portal e realizar o download direto.
2.  **Download via Fetch:** Utiliza a função `fetch` do próprio navegador (executada via `page.evaluate`) para baixar o conteúdo do PDF, garantindo que os cookies da sessão sejam mantidos.
3.  **Conversão e Salvamento:** O conteúdo do PDF é convertido para Base64 no navegador e então para um `Buffer` no Node.js, sendo salvo fisicamente no diretório de evidências com o nome da OP (ex: `AAAA.BBBB.CCC.DDDDD.EEE.pdf`).

---

## 3. Tratamento de Erros e Relatórios

*   **Logs Detalhados:** Todas as ações e eventos (sucesso, erro, abortamento) são registrados tanto no console quanto em arquivos de log persistentes via `logger.gravarLogSistema`.
*   **Evidências Visuais:** Em caso de erro durante o processamento de uma OP, o robô captura um *screenshot* da tela (`page.screenshot`) para documentar a situação, salvando-o no diretório de evidências.
*   **Relatório Final:** Ao término do processamento de todas as OPs, o `fileUtils.exportarRelatorios` gera uma planilha consolidada contendo o status de cada OP processada, mensagens detalhadas de sucesso ou erro, e os dados originais da linha.

---

## 4. Recomendações para Manutenção

1.  **Seletores de Campos:** Os seletores dos campos do formulário de consulta (definidos em `configuracoes_fixas.campos_op` no `profiles.json`) são cruciais. Qualquer alteração na estrutura HTML do formulário exigirá a atualização desses seletores.
2.  **Botão "Dueof":** O seletor e o atributo `onclick` do botão "Dueof" são pontos sensíveis. Mudanças na forma como o portal gera o link de download do PDF podem quebrar a funcionalidade de download.
3.  **Formato da OP:** O robô espera um formato específico de OP com cinco partes. Se o formato mudar, a lógica de desmembramento e validação precisará ser ajustada.
4.  **Delays e Navegação:** O sistema web pode apresentar tempos de resposta variáveis. Os `navUtils.delay()` e `page.waitForNavigation()` espalhados pelo código são essenciais para a estabilidade e devem ser ajustados se o sistema apresentar lentidão ou mudanças no comportamento de carregamento das páginas.
