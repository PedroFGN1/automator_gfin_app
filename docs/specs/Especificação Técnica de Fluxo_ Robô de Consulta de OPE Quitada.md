# Especificação Técnica de Fluxo: Robô de Consulta de OPE Quitada

**Autor:** Manus AI
**Data:** 31 de Março de 2026
**Versão:** 1.0
**Arquivos Base:** `consultar-ope-quitada.js`

---

## 1. Visão Geral

O Robô de Consulta de OPE Quitada automatiza a verificação de Ordens de Pagamento Eletrônicas (OPEs) no sistema financeiro, realizando o download automático do comprovante **Dueof** em formato PDF. Ele processa uma lista de OPEs a partir de uma planilha Excel, extrai o sequencial necessário para a consulta e utiliza técnicas avançadas de interceptação de rede para baixar o arquivo diretamente, ignorando visualizadores de PDF internos do navegador.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `consultar-ope-quitada.js` | **Orquestrador:** Gerencia o loop de consulta, extração de sequenciais de OP e lógica de download de PDFs. |
| `puppeteer-utils.js` | **Interação de Navegador:** Utilizado para `aguardarContextoDoCampo`, `preencherTexto` e captura de elementos em frames. |
| `file-utils.js` | **I/O de Arquivos:** Leitura da planilha de entrada e organização dos diretórios de saída (evidências e PDFs). |
| `navigation-utils.js` | **Sincronização:** Controle de delays para estabilização do DOM após consultas. |
| `logger.js` | **Logs de Sistema:** Registro de todas as etapas do processamento para auditoria. |

---

## 2. Fluxo Operacional

### 2.1. Inicialização e Segurança
O robô segue o padrão de segurança e estrutura de diretórios do projeto:

1.  **Preparação de Ambiente:** Cria a estrutura de pastas para armazenar os comprovantes PDF e os logs da execução.
2.  **Carga de Dados:** Lê a planilha Excel e identifica a coluna contendo o número completo da OP (ex: `2026.9995.2867`).
3.  **Login Humano:** Abre o portal e aguarda o login manual. O robô só inicia o processamento após a confirmação do usuário via `dialog` do Electron.

### 2.2. Ciclo de Processamento (Loop de Dados)
Para cada OP listada na planilha, o robô executa o seguinte ciclo:

#### A. Tratamento de Dados e Navegação
*   **Extração de Sequencial:** O robô isola os últimos 4 dígitos do número da OP (o sequencial) para preenchimento no formulário de consulta.
*   **Navegação Stateless:** Acessa a URL do formulário de consulta diretamente em cada iteração para garantir um estado limpo da aplicação.

#### B. Consulta de Ordem de Pagamento
1.  **Preenchimento:** Localiza os campos de "Órgão" e "Sequencial da OP" dentro do contexto (frame) correto.
2.  **Submissão:** Clica em "Consultar" e aguarda o recarregamento da página (`domcontentloaded`).
3.  **Validação de Quitação:** Verifica a existência do botão de download do PDF Dueof. Caso o botão não seja encontrado, o robô registra que a OP pode não estar quitada e gera um erro específico para a linha.

#### C. Download Inteligente do PDF (Dueof)
Para evitar problemas com visualizadores de PDF que bloqueiam a automação, o robô utiliza uma técnica de download via fetch:
1.  **Extração de URL:** Captura a URL de download contida no atributo `onclick` do botão Dueof.
2.  **Download via Fetch:** Executa um `fetch` dentro do contexto do navegador para manter os cookies de sessão e autenticação.
3.  **Conversão para Base64:** Transforma o binário do PDF em uma string Base64 para transferi-lo do navegador para o ambiente Node.js.
4.  **Salvamento em Disco:** Converte o Base64 de volta para buffer e salva o arquivo PDF com o nome exato da OP (ex: `2026.9995.2867.pdf`).

---

## 3. Especificações Técnicas de Interface

O bot lida com desafios de download de arquivos binários e navegação em frames:

| Desafio Técnico | Solução Implementada |
| :--- | :--- |
| **Download em Automação** | Uso de `fetch` injetado via `page.evaluate` para baixar o arquivo como `blob` e converter para `base64`. |
| **Visualizadores de PDF** | A extração da URL do `onclick` permite acessar o arquivo diretamente sem abrir a aba de visualização do navegador. |
| **Limpeza de URLs** | Tratamento de entidades HTML (`&amp;`) nas URLs extraídas para garantir links válidos. |
| **Persistência de Sessão** | O download é feito "por dentro" do navegador, aproveitando os cookies de login já existentes. |

---

## 4. Tratamento de Erros e Relatórios

*   **Falha na Localização:** Se a OP não for encontrada ou o botão Dueof estiver ausente, o robô captura um print da tela e registra o motivo no relatório.
*   **Relatório Consolidado:** Ao final, gera uma planilha Excel com o status de cada download e o caminho do arquivo salvo.
*   **Logs de Execução:** Todas as tentativas de download e erros de rede são registrados no `logger.js`. 
