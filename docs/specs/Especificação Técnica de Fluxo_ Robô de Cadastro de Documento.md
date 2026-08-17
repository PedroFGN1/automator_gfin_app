# Especificação Técnica de Fluxo: Robô de Cadastro de Documento

**Autor:** Manus AI
**Data:** 18 de Maio de 2026
**Versão:** 1.0
**Arquivos Base:** `cadastro-documento.js`, `puppeteer-utils.js`, `file-utils.js`, `logger.js`

---

## 1. Visão Geral

O Robô de Cadastro de Documento automatiza o processo de inclusão de documentos em um sistema web através do código de barras. Ele é projetado para ler dados de uma planilha Excel, realizar uma consulta prévia para evitar duplicidades e preencher os dados necessários, incluindo a busca dinâmica do ID do beneficiário em uma aba oculta. O robô possui um tratamento refinado de diálogos do sistema para classificar respostas de sucesso, erro ou documentos já existentes.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `cadastro-documento.js` | **Orquestrador:** Gerencia o loop de processamento, a lógica de três fases (Consulta, Preenchimento, Inclusão) e a integração com o ID do beneficiário. |
| `puppeteer-utils.js` | **Utilitários de Interação:** Fornece funções como `executarComDialogGuardado` e `buscarIdBeneficiario` para lidar com a complexidade do sistema. |
| `file-utils.js` | **I/O:** Responsável pela leitura da planilha de entrada e geração do relatório consolidado de resultados. |
| `logger.js` | **Rastreabilidade:** Registro centralizado de logs para auditoria e acompanhamento em tempo real. |

---

## 2. Fluxo Operacional

### 2.1. Inicialização e Segurança
O robô inicia com a preparação do ambiente:
1.  **Diretórios:** Cria pastas para evidências (screenshots) e relatórios.
2.  **Carga de Dados:** Carrega a planilha Excel com os códigos de barras e observações.
3.  **Login Assistido:** Abre o portal e aguarda a autenticação manual do usuário, prosseguindo apenas após a confirmação via interface Electron.

### 2.2. Ciclo de Processamento (Loop de Dados)

#### FASE 1: Consulta do Código de Barras
*   **Entrada:** Preenche o campo de código de barras obtido da planilha.
*   **Tratamento de Diálogos:** Utiliza `executarComDialogGuardado` para capturar respostas imediatas do sistema.
*   **Validações:** 
    *   `DOCUMENTO_JA_CADASTRADO`: O robô ignora a linha e registra como aviso.
    *   `DIGITO_INVALIDO`: Interrompe a linha com erro específico.

#### FASE 2: Preenchimento de Dados
*   **Dados Fixos:** Preenche órgão e descrição (observação).
*   **ID do Beneficiário:** Realiza uma busca em background (aba oculta) para obter o ID interno do beneficiário associado ao CPF/CNPJ configurado no perfil.
*   **Injeção de Dados:** Insere o ID obtido diretamente no campo oculto (`idPessoa`) via manipulação de DOM.

#### FASE 3: Confirmação e Inclusão
*   **Submissão Final:** Clica em "Incluir" e monitora a resposta do servidor.
*   **Verificação de Sucesso:** Valida se a operação foi concluída através de mensagem de diálogo específica (`SUCESSO_INCLUSAO`) ou por navegação de página bem-sucedida.

---

## 3. Especificações Técnicas de Interface

O robô utiliza técnicas avançadas para garantir a integridade da submissão:

| Desafio Técnico | Solução Implementada |
| :--- | :--- |
| **Race Conditions em Dialogs** | Uso de `executarComDialogGuardado` para sincronizar a detecção de alertas com a navegação. |
| **Busca de ID Externo** | Função `buscarIdBeneficiario` que abre uma nova aba temporária para consultar o ID sem perder o contexto do formulário principal. |
| **Campos Hidden** | Uso de `page.evaluate` para injetar valores em campos que não permitem interação direta via teclado. |

---

## 4. Tratamento de Erros e Relatórios

*   **Relatório Detalhado:** Gera um Excel final com colunas de status (SUCESSO/ERRO/IGNORADO) e a mensagem exata retornada pelo sistema.
*   **Evidências Visuais:** Captura screenshots identificados com a observação da guia para cada item processado.
*   **Logs de Sistema:** Gravação persistente de cada etapa no arquivo de log para depuração técnica.
