# Especificação Técnica de Fluxo: Robô de Restituição (Fiança, ICMS, ITCD)

**Autor:** Manus AI
**Data:** 22 de Janeiro de 2026
**Versão:** 2.0 (Modularizada)
**Arquivos Base:** `restituicao-fianca_icms_itcd.js` e `restituicao-ipva.js`

---

## 1. Visão Geral da Nova Estrutura

O robô foi evoluído de um script monolítico para uma arquitetura modular integrada a uma aplicação Electron. A lógica principal agora reside em `restituicao-fianca_icms_itcd.js` e `restituicao-ipva.js`, que coordena a execução utilizando utilitários especializados. Esta versão expande a funcionalidade original para suportar múltiplos tipos de restituição (Fiança, ICMS e ITCD) através de configurações dinâmicas.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `restituicao-fianca_icms_itcd.js` | **Orquestrador:** Gerencia o loop de dados, fluxo de navegação e lógica de negócio. |
| `puppeteer-utils.js` | **Interação:** Funções de baixo nível para clicar, digitar, injetar valores e buscar IDs. |
| `navigation-utils.js` | **Navegação/Dados:** Delays controlados, tratamento de datas e formatação de moeda. |
| `file-utils.js` | **I/O:** Leitura de Excel (via `exceljs`), criação de pastas e exportação de relatórios. |
| `logger.js` | **Rastreabilidade:** Gravação de logs persistentes em arquivo e console. |

---

## 2. Fluxo Operacional Atualizado

### 2.1. Inicialização e Controle de Sessão
Diferente da versão original, a inicialização é integrada à interface gráfica (Frontend).

1.  **Preparação de Ambiente:** O robô utiliza `fileUtils.prepararDiretorios` para criar uma estrutura organizada de evidências e planilhas de saída.
2.  **Handshake via UI:** O login manual agora é validado através de um `dialog.showMessageBox` do Electron, permitindo que o usuário sinalize quando o portal estiver pronto.
3.  **Controle de Abortagem:** Introduzido um objeto `controle` que permite ao usuário interromper o processamento a qualquer momento (`controle.abortar`).

### 2.2. Processamento de Linhas (Loop Stateless)
O robô mantém a filosofia *stateless*, garantindo que cada linha comece com um formulário limpo via `URL_FORMULARIO_DIRETO`.

#### A. Fase de Pré-Seleção (Finalidade)
*   Utiliza `pptUtils.aguardarContextoDoCampo` para lidar dinamicamente com a presença de frames.
*   Seleciona a finalidade configurada (ex: Fiança, ICMS ou ITCD) e clica em "Continuar".

#### B. Preenchimento do Formulário Principal
O fluxo de preenchimento foi refinado com esperas (`delay`) mais precisas e tratamento de dados centralizado:

| Etapa | Descrição Técnica | Melhoria em relação ao Original |
| :--- | :--- | :--- |
| **Órgão** | Preenche `txtOrgao` e dispara `Tab`. | Espera pós-tab aumentada para 2s para garantir o *reload* do sistema. |
| **Datas** | Preenchimento de Dia, Mês e Ano. | Usa `navUtils.tratarData` e métodos `getUTC*` para evitar problemas de fuso horário. |
| **Beneficiário** | Busca ID em aba oculta e injeta dados. | Adicionada validação crítica: se o ID não for encontrado, a linha é marcada como erro imediatamente. |
| **Débito** | Preenche Receita, Tipo de Conta e DDR. | Utiliza `pptUtils.injetarValor` para preencher Banco, Agência e Conta de uma só vez. |
| **Crédito** | Preenche Banco, Agência e Conta de Crédito. | Lógica modularizada via `pptUtils.preencherTexto`. |
| **Município** | Preenche município para restituição de iPVA | Lógica modularizada via `pptUtils.preencherTexto`. |
| **Histórico** | Preenche campo de histórico. | Lógica modularizada via `pptUtils.preencherTexto`. |
| **Controle** | Marca "Enviar para Banco" e "Rascunho". | Utiliza `pptUtils.marcarOpcao` com seletores de valor exato. |

### 2.3. Submissão e Captura de Resultados
A lógica de tratamento de erros foi mantida e aprimorada com a captura do número da Ordem de Pagamento (OP).

1.  **Listener de Diálogo:** Mantém o monitoramento de `page.on('dialog')` para capturar mensagens de erro do sistema.
2.  **Validação de Inclusão:** Se um alerta for detectado, o robô lança um erro (`throw new Error`) que é capturado pelo `catch` da linha, garantindo o registro correto no relatório.
3.  **Confirmação Final:** Clica em "Sim/Confirmar" e tira *screenshot* da tela de conferência.
4.  **Captura de Número OP:** 
    *   **Inovação:** O robô agora busca o seletor `.titulo2` após a confirmação.
    *   **Regex:** Utiliza a expressão regular `/[\d]{4}\.[\d]{4}\.[\d]{4}/` para extrair o número da OP (ex: 2026.9995.0739) do texto de sucesso.

---

## 3. Tratamento de Erros e Relatórios

*   **Logs Duplos:** Todas as ações são enviadas para a interface do usuário (`enviarLog`) e gravadas em arquivo (`logger.gravarLogSistema`).
*   **Evidências:** Captura automática de *screenshots* em caso de `SUCESSO`, `ERRO` ou `ERRO_INCERTO`, salvando-os com o ID do processo.
*   **Relatório Final:** Ao final do processamento, o `fileUtils.exportarRelatorios` gera uma planilha consolidada com o status de cada linha e os números de OP gerados.

---

## 4. Recomendações para Manutenção

1.  **Seletores de Frame:** O sistema alvo utiliza framesets. Sempre utilize `pptUtils.aguardarContextoDoCampo` para garantir que o comando seja executado no contexto correto (Page ou Frame).
2.  **Delays:** O sistema web possui tempos de resposta variáveis. Os `navUtils.delay()` espalhados pelo código são essenciais para a estabilidade e devem ser ajustados se o sistema apresentar lentidão.
3.  **Regex da OP:** Se o formato do número da OP mudar no sistema, a expressão regular na linha 286 do script principal precisará ser atualizada.
