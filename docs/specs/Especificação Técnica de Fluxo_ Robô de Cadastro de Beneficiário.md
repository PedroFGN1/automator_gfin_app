# Especificação Técnica de Fluxo: Robô de Cadastro de Beneficiário

**Autor:** Manus AI
**Data:** 30 de Março de 2026
**Versão:** 1.0
**Arquivos Base:** `cadastro-beneficiario.js`, `puppeteer-utils.js`

---

## 1. Visão Geral

O Robô de Cadastro de Beneficiário automatiza o processo de inclusão de novos beneficiários (Pessoa Física e Pessoa Jurídica) em um sistema web. Ele é projetado para ler dados de uma planilha Excel, navegar até o formulário de cadastro, realizar a consulta inicial do beneficiário e, caso não encontrado, proceder com o preenchimento dos dados e a submissão do formulário, com tratamento robusto de validações e alertas do servidor. A principal melhoria desta versão é a unificação da lógica de submissão para CPF e CNPJ, garantindo um tratamento consistente dos `dialogs` do sistema.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `cadastro-beneficiario.js` | **Orquestrador:** Coordena o loop de processamento, navegação entre páginas e lógica de negócio específica para o cadastro de beneficiários. |
| `puppeteer-utils.js` | **Utilitários de Interação:** Contém funções genéricas para interação com o navegador (Puppeteer), incluindo `aguardarContextoDoCampo`, `preencherTexto`, `marcarOpcao`, `existeTextoNaPagina` e a nova função `submeterFormularioComValidacao`. |
| `file-utils.js` | **I/O:** Leitura de planilhas Excel e exportação de relatórios finais. |
| `navigation-utils.js` | **Auxiliares:** Funções de atraso (`delay`) e outras utilidades de navegação. |
| `logger.js` | **Rastreabilidade:** Registro de logs persistentes em arquivo e console. |

---

## 2. Fluxo Operacional

### 2.1. Inicialização e Segurança
O robô segue o padrão de segurança do projeto para acesso a sistemas governamentais:

1.  **Estrutura de Pastas:** Cria diretórios para `evidencias` (prints) e `planilhas` de saída.
2.  **Carga de Dados:** Lê a planilha de entrada, contendo os dados dos beneficiários (CPF/CNPJ, Nome, Tipo, etc.).
3.  **Login Humano:** Abre o portal e aguarda o login manual do usuário. O processamento só inicia após o usuário confirmar na interface do robô que o sistema está pronto.

### 2.2. Ciclo de Processamento (Loop de Dados)
Para cada linha da planilha, o robô executa as seguintes etapas:

#### A. Navegação e Consulta Inicial
*   **Navegação Direta:** Acessa a URL do formulário de cadastro de beneficiários.
*   **Pré-seleção de Tipo:** Seleciona o tipo de pessoa (Física ou Jurídica) com base nos dados da planilha.
*   **Preenchimento de Consulta:** Preenche o campo de CPF/CNPJ e um campo auxiliar de nome (com um caractere genérico, como ".") para realizar a busca inicial.
*   **Submissão da Consulta:** Clica no botão "Continuar" ou "Avançar" e aguarda a navegação para a próxima etapa.

#### B. Verificação e Cadastro do Beneficiário
1.  **Verificação de Existência:** O robô verifica se o beneficiário já está cadastrado, procurando por uma mensagem específica de "não encontrado" na página.
2.  **Início do Cadastro (se não encontrado):** Se o beneficiário não for encontrado, o robô clica no botão "Incluir" para iniciar o formulário de cadastro.
3.  **Preenchimento de Dados:** Preenche o campo de nome do beneficiário com os dados da planilha.
4.  **Submissão Unificada:** Utiliza a função `submeterFormularioComValidacao` (do `puppeteer-utils.js`) para clicar no botão "Confirmar". Esta função é responsável por:
    *   Fazer o bypass de validações de front-end (`window.verificarCampos = () => true;`).
    *   Configurar o parâmetro de operação (`document.Navegacao.op.value = "IncluirRegistro";`).
    *   Capturar e retornar a mensagem do `dialog` (alerta) do servidor, que indica o sucesso ou falha do cadastro.
5.  **Tratamento da Resposta do Servidor:** Analisa a mensagem retornada pelo `dialog`:
    *   Se a mensagem indicar sucesso, registra o cadastro como bem-sucedido e aguarda a estabilização da rede.
    *   Se a mensagem indicar erro ou rejeição, lança uma exceção com a mensagem do servidor.

#### C. Captura de Evidências e Relatórios
*   **Screenshot de Sucesso/Erro:** Captura a tela do sistema após cada processamento (sucesso ou erro) para fins de evidência.
*   **Logs Detalhados:** Registra todas as ações e mensagens (incluindo erros) no console e em um arquivo de log.
*   **Relatório Final:** Ao término do processamento de todas as linhas, gera uma planilha Excel com o status (SUCESSO/ERRO), dados da linha e a mensagem detalhada de cada item processado.

---

## 3. Especificações Técnicas de Interface

O bot interage com o sistema web utilizando seletores CSS e manipulação direta do DOM via Puppeteer. A função `submeterFormularioComValidacao` é crucial para lidar com as particularidades do sistema:

| Desafio Técnico | Solução Implementada |
| :--- | :--- |
| **Validações de Front-end** | Sobrescrita da função `window.verificarCampos` para `() => true` para permitir a submissão direta. |
| **Parâmetros de Operação** | Definição do `document.Navegacao.op.value = "IncluirRegistro"` via `page.evaluate` para indicar a ação desejada ao servidor. |
| **Alertas/Dialogs do Servidor** | Utilização de `page.once("dialog", ...)` para capturar a mensagem do alerta do servidor de forma assíncrona e `dialog.accept()` para fechar o alerta automaticamente. |
| **IDs e Nomes de Campos** | Uso de seletores CSS baseados em `name` e `value` dos elementos HTML, configuráveis via `configPerfil`. |

---

## 4. Tratamento de Erros e Relatórios

*   **Logs Duplos:** Mensagens enviadas em tempo real para o frontend e gravadas em arquivo TXT via `logger.js`.
*   **Relatório Excel:** Gera uma planilha com o status (SUCESSO/ERRO), a linha processada, os dados e a mensagem detalhada (incluindo rejeições do servidor) de cada item.
*   **Captura de Tela em Erro:** Em caso de falha no processamento de uma linha, uma captura de tela é feita para auxiliar na depuração.
*   **Abortagem:** Permite ao usuário interromper o loop de processamento a qualquer momento de forma segura.
