# Especificação Técnica de Fluxo: Robô de Marcação Terminal

**Autor:** Manus AI
**Data:** 05 de Março de 2026
**Versão:** 1.0
**Arquivos Base:** `marcacao-terminal.js` e `terminal-utils.js`

---

## 1. Visão Geral

O Robô de Marcação Terminal é responsável por automatizar o processo de marcação de documentos (DARE/GNRE) diretamente no sistema de terminal legado da SEFAZ-GO. Ele opera através de uma interface de terminal emulada em ambiente web, realizando a navegação por menus, preenchimento de campos específicos e confirmações de segurança para registrar restituições.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `marcacao-terminal.js` | **Orquestrador:** Gerencia o loop de dados da planilha, a lógica de fluxo dinâmico e o controle de interface com o usuário. |
| `terminal-utils.js` | **Interação de Terminal:** Utilitários para navegar em framesets, ler texto fragmentado do terminal, localizar inputs ativos e simular comandos de teclado (Enter, F6, etc.). |
| `file-utils.js` | **I/O:** Leitura de dados do Excel e exportação de relatórios de execução. |
| `navigation-utils.js` | **Auxiliares:** Formatação de moedas, tratamento de strings e delays controlados. |
| `logger.js` | **Rastreabilidade:** Registro persistente de logs de sistema e de execução. |

---

## 2. Fluxo Operacional

### 2.1. Inicialização e Preparação
O robô inicia preparando o ambiente e aguardando a intervenção humana para garantir a segurança do acesso:

1.  **Configuração de Diretórios:** Cria pastas para evidências (screenshots) e planilhas de saída.
2.  **Carga de Dados:** Lê a planilha de entrada mapeando colunas como Processo SEI, DARE/GNRE, Data de Pagamento e Valor.
3.  **Acesso e Login:** Abre o navegador no portal SEFAZ e aguarda o usuário realizar o login manual e navegar até a tela do terminal.
4.  **Sincronização:** O processamento só inicia após a confirmação do usuário via interface ("Iniciar Processamento").

### 2.2. Processamento por Linha (Ciclo de Vida)
O robô implementa um controle rigoroso por linha, incluindo uma pausa para validação humana entre cada registro:

#### A. Controle de Fluxo Humano-Máquina
*   **Pausa de Segurança:** Antes de cada linha, o robô pausa e aguarda o clique em "Continuar" no painel. Isso permite que o operador acompanhe o progresso ou intervenha se necessário.
*   **Abortagem:** O usuário pode interromper o ciclo completo a qualquer momento.

#### B. Navegação no Terminal (Lógica de Menus)
A navegação é dinâmica e baseada na leitura do texto da tela:
1.  **Identificação de Menus:** O robô lê a tela, identifica o número correspondente à opção desejada (ex: "RECEITA", "SISTEMA DE ARRECADACAO") e envia o comando.
2.  **Mapeamento de Posições:** Utiliza IDs de posição (ex: `POS1003`, `POS1023`) para injetar dados nos campos corretos do terminal.

#### C. Preenchimento Dinâmico
O robô adapta o preenchimento com base no tipo de documento:
*   **Data de Pagamento:** Tratada para o formato DDMMAAAA, corrigindo fusos horários do Excel.
*   **Valor Restituído:** Injetado sem separadores (pontos/vírgulas) conforme exigência do sistema legado.
*   **Diferenciação DARE/GNRE:** O robô altera o ID do campo de valor (`POS1168` para DARE e `POS928` para GNRE) automaticamente.

### 2.3. Tratamento de Erros e Recuperação
*   **Retry Inteligente (F3):** O fluxo possui uma lógica de correção para a "Parte 3" do processo. Se falhar, o robô tenta enviar um "Enter" de correção e reexecuta a etapa antes de declarar erro.
*   **Captura de Evidências:** Screenshots são tirados em casos de `SUCESSO` ou `ERRO`, nomeados com o ID do processo e número do DARE.

---

## 3. Especificações Técnicas de Interface

O sistema alvo utiliza um `frameset` complexo. O utilitário `terminal-utils.js` resolve isso através da função `obterFrameAtivoPorCols`, que detecta qual frame está visível (Left ou Right) baseando-se no atributo `cols` do elemento `#gx_winFrameSet`.

| Ação | Descrição Técnica |
| :--- | :--- |
| **Leitura de Texto** | Reconstrói o texto da tela ordenando `spans` por posição `top` e `left`. |
| **Localização de Input** | Foca automaticamente no `document.activeElement` ou no primeiro input editável visível. |
| **Navegação Dinâmica** | Busca o número da opção (ex: "4 - RECEITA") via Regex no texto capturado. |

---

## 4. Relatórios e Finalização

Ao concluir o processamento (ou em caso de interrupção), o robô:
1.  Gera uma planilha consolidada com o status de cada linha.
2.  Salva logs detalhados em `logs/sistema-YYYY-MM-DD.log`.
3.  Fecha o navegador automaticamente.
