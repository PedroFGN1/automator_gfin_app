# Especificação Técnica de Fluxo: Robô de Análise de Honorários Periciais

**Autor:** Manus AI
**Data:** 08 de Junho de 2026
**Versão:** 1.0
**Arquivos Base:** `analise-honorarios-periciais.js`, `ai-service.js`, `honorarios-exporter.js`

---

## 1. Visão Geral

O Robô de Análise de Honorários Periciais automatiza a extração e consolidação de dados financeiros e processuais contidos em documentos PDF (decisões, laudos ou petições). Ele utiliza Inteligência Artificial (IA) integrada via n8n para realizar o reconhecimento de padrões complexos e extrair informações como número do processo, valor dos honorários, perito responsável e dados bancários. O bot gera tanto uma planilha Excel para conferência quanto um relatório PDF consolidado para validação.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `analise-honorarios-periciais.js` | **Orquestrador:** Gerencia o fluxo de entrada de arquivos, coordena a chamada ao serviço de IA e dispara a geração de relatórios. |
| `ai-service.js` | **Integração IA:** Realiza a comunicação com o serviço externo (n8n) para processamento dos PDFs e extração de dados estruturados. |
| `honorarios-exporter.js` | **Exportador:** Transforma os dados extraídos em planilhas Excel formatadas e relatórios PDF de alta fidelidade para auditoria. |
| `file-utils.js` | **I/O:** Organiza a estrutura de diretórios para salvar as evidências e os arquivos resultantes. |

---

## 2. Fluxo Operacional

### 2.1. Preparação e Configuração
1.  **Entrada de Arquivos:** O robô recebe uma lista de PDFs selecionados pelo usuário.
2.  **Carga de Perfil:** Lê um arquivo de perfil (`perfil_honorarios.md`) que contém as instruções e regras de negócio para a IA, garantindo que a extração siga os critérios específicos do setor.
3.  **Estrutura de Saída:** Cria diretórios específicos para a execução atual dentro da pasta de resultados.

### 2.2. Processamento Inteligente
1.  **Extração via IA:** Os PDFs são enviados para o serviço de IA. O bot aguarda a resposta estruturada contendo os dados identificados.
2.  **Tratamento de Falhas:** Caso algum arquivo não possa ser processado ou apresente inconsistências, o robô registra a falha individualmente sem interromper o lote.
3.  **Controle de Abortagem:** O robô monitora constantemente o sinal de interrupção do usuário, permitindo parar o processamento entre as fases de extração e exportação.

### 2.3. Consolidação de Resultados
1.  **Geração de Planilha:** Cria um arquivo Excel onde cada linha representa um processo ou honorário identificado, facilitando a importação em outros sistemas.
2.  **Relatório de Validação:** Gera um documento PDF formatado que apresenta os dados extraídos de forma legível para conferência humana rápida.
3.  **Resumo Executivo:** Apresenta ao final da execução a contagem de sucessos, falhas e o caminho dos arquivos gerados.

---

## 3. Especificações Técnicas e Integrações

| Recurso | Descrição |
| :--- | :--- |
| **Extração via n8n** | Utiliza fluxos de automação externos para processar documentos via LLM, garantindo alta precisão em textos não estruturados. |
| **Perfil Dinâmico** | O comportamento da IA pode ser ajustado via `perfil_honorarios.md` sem necessidade de alteração no código fonte. |
| **Dual Export** | Produção simultânea de formatos `XLSX` (para dados) e `PDF` (para conferência visual). |

---

## 4. Tratamento de Erros e Logs

*   **Logs de Auditoria:** Cada etapa (leitura, envio para IA, exportação) é registrada no log do sistema com o prefixo `[BOT-Analise-Honorarios]`.
*   **Gestão de Erros Críticos:** Erros de rede ou de API são capturados e informados ao usuário, com gravação de stack trace para depuração.
*   **Relatório de Inconsistências:** Arquivos que falharam na extração são listados explicitamente no relatório final para ação manual.
