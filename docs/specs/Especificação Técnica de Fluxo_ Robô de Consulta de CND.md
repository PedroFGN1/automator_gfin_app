# Especificação Técnica de Fluxo: Robô de Consulta de CND

**Autor:** Manus AI
**Data:** 26 de Maio de 2026
**Versão:** 1.0
**Arquivos Base:** `consultar-cnd.js`, `certidaoExtractor.js`, `puppeteer-extra`

---

## 1. Visão Geral

O Robô de Consulta de Certidão Negativa de Débitos (CND) automatiza a emissão e validação de certidões no portal da SEFAZ-GO. Ele processa arquivos PDF de entrada (certidões prévias), extrai os CPFs/CNPJs e realiza a consulta oficial no portal, capturando a nova certidão emitida. O bot possui uma lógica sofisticada para lidar com o visualizador de PDF do Chrome e garantir a captura do binário correto via fetch interno.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `consultar-cnd.js` | **Orquestrador:** Gerencia a extração de dados dos PDFs, o preenchimento do formulário da SEFAZ e a captura da nova certidão. |
| `certidaoExtractor.js` | **Extrator de Dados:** Realiza o parsing dos PDFs de entrada para identificar CPFs, CNPJs e o status atual das certidões. |
| `puppeteer-extra-plugin-stealth` | **Evasão:** Garante que a automação não seja bloqueada por mecanismos de segurança do portal. |
| `file-utils.js` | **I/O:** Organiza os diretórios de saída e gera os relatórios finais de execução. |

---

## 2. Fluxo Operacional

### 2.1. Inicialização e Extração
1.  **Leitura de PDFs:** O robô recebe uma lista de arquivos PDF como entrada.
2.  **Extração de Metadados:** Utiliza o `extrairCertidoes` para obter os documentos e nomes contidos nos arquivos.
3.  **Consolidação:** Agrupa documentos únicos e classifica certidões como Positivas ou Negativas antes de iniciar a consulta.

### 2.2. Ciclo de Processamento (Loop de Documentos)

#### A. Preenchimento do Formulário
*   **Seleção de Tipo:** Escolhe o tipo de certidão (ex: Dívida Ativa) no portal.
*   **Detecção Automática:** Identifica se o documento é CPF ou CNPJ e preenche o campo correspondente.
*   **Configuração de Espólio:** Define automaticamente a opção de não espólio conforme padrão.

#### B. Emissão e Confirmação
*   **Disparo de Emissão:** Clica no botão "Emitir".
*   **Confirmação de Contribuinte:** Caso o sistema solicite a confirmação do nome do contribuinte, o robô valida e clica em "Sim".

#### C. Captura Técnica do PDF
*   **Monitoramento de Rede:** O robô intercepta a criação de novas abas e requisições de rede para detectar o fluxo do PDF.
*   **Bypass do PDF Viewer:** Se o Chrome retornar um buffer inválido (HTML do visualizador), o robô executa um `fetch` assíncrono dentro do contexto da página para capturar o binário real do PDF com a sessão do usuário.
*   **Persistência:** Salva a nova certidão com nome formatado (ex: `certidao-[DOCUMENTO].pdf`) no diretório de evidências.

---

## 3. Especificações Técnicas de Interface

| Desafio Técnico | Solução Implementada |
| :--- | :--- |
| **Parsing de PDF** | Integração com `certidaoExtractor.js` para leitura de documentos estruturados em arquivos PDF. |
| **Magic Bytes Check** | Verificação dos primeiros 4 bytes (`%PDF`) para garantir que o arquivo capturado é um PDF válido. |
| **Fetch Injetado** | Uso de `FileReader` e `fetch` via `page.evaluate` para extrair documentos binários protegidos por sessão. |
| **Tratamento de Alertas** | Captura e registro de mensagens de erro do portal (ex: contribuinte não encontrado). |

---

## 4. Tratamento de Erros e Relatórios

*   **Relatório de Consolidação:** O Excel final detalha o status extraído originalmente e o resultado da nova consulta.
*   **Evidências de Erro:** Captura screenshots em caso de falha no preenchimento ou resposta negativa do portal.
*   **Logs de Diagnóstico:** Sistema de logs com prefixo `[DBG]` para rastreamento detalhado de requisições e respostas de rede.
