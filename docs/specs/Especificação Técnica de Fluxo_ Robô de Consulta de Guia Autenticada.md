# Especificação Técnica de Fluxo: Robô de Consulta de Guia Autenticada

**Autor:** Manus AI
**Data:** 08 de Setembro de 2026
**Versão:** 1.1
**Arquivos Base:** `consultar-guia-autenticada.js`, `pdf-guia-parser.js`, `angular-utils.js`, `puppeteer-extra`

---

## 1. Visão Geral

O Robô de Consulta de Guia Autenticada é especializado na recuperação de comprovantes de depósito judicial no portal da Caixa Econômica Federal. Ele possui entrada híbrida: processa **planilhas Excel (`.xlsx`)** tradicionais com a coluna `ID_DEPOSITO` ou **guias de depósito em PDF (`.pdf`)** diretamente (inclusive seleções múltiplas), extraindo de forma 100% nativa o ID do depósito, o número SEI/observação e o processo judicial.

Lida com formulários reativos em **Angular**, proteção de **Captcha** e captura arquivos PDF gerados dinamicamente em memória (Blob URLs), salvando os comprovantes de pagamento localmente com nomenclatura padronizada e gerando relatório consolidado.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `consultar-guia-autenticada.js` | **Orquestrador:** Gerencia a entrada híbrida (PDFs ou Excel), detecção de Captcha, espionagem de memória para PDFs e ciclo de vida das abas Blob. |
| `pdf-guia-parser.js` | **Parser Nativo de Guias:** Extrai ID do depósito (`txtTedJudicialId`), observação (`txtObservacao`) e processo judicial (`txtProcesso`) diretamente dos streams e AcroForms dos PDFs usando `zlib` nativo. |
| `angular-utils.js` | **Interação Angular:** Utilitários para preencher campos que utilizam o framework Angular, disparando os eventos necessários para validação. |
| `puppeteer-extra-plugin-stealth` | **Evasão:** Utilizado para reduzir a detecção do robô por sistemas de segurança e WAF. |
| `file-utils.js` | **I/O:** Leitura de dados e exportação de relatórios consolidados em Excel. |

---

## 2. Entrada de Dados Híbrida

O robô suporta duas modalidades de entrada sem necessidade de alterar o `profiles.json`:

1.  **Planilha Excel (`.xlsx`):** Lê os registros da planilha mapeando a coluna `ID_DEPOSITO` e `Observação`.
2.  **Guias de Depósito em PDF (`.pdf`):** Processa um ou múltiplos arquivos PDF emitidos anteriormente pela Caixa. O extrator nativo identifica:
    *   `ID_DEPOSITO`: Código de 18 dígitos localizado nos campos do formulário PDF.
    *   `OBSERVACAO` / `Observação`: Descrição livre ou código do processo SEI extraído do PDF ou do nome do arquivo.
    *   `Proc. Judicial`: Número CNJ formatado associado à guia.

---

## 3. Fluxo Operacional

### 3.1. Inicialização
1.  **Carregamento de Dados:** Identifica se a entrada é planilha Excel ou lista de PDFs e unifica os registros em memória.
2.  **Preparação de Memória:** Instala um "espião" na função `URL.createObjectURL` do navegador para interceptar a criação de documentos PDF de comprovante.

### 3.2. Ciclo de Processamento

#### A. Preenchimento e Consulta
*   **Input Angular:** O ID do depósito é preenchido utilizando `preencherCampoAngular`, garantindo que o sistema reconheça a entrada de dados.
*   **Detecção de Captcha:** O robô verifica se um desafio de Captcha está visível. Se estiver, aguarda a resolução manual pelo operador. Caso contrário, prossegue automaticamente com o clique em "Consultar ID".

#### B. Validação de Resultado
*   **Guia Não Paga:** O robô monitora mensagens de erro específicas como "Não consta pagamento para o ID informado". Se encontrada, a linha é marcada como erro com a justificativa do sistema.
*   **Liberação de Visualização:** Aguarda a habilitação do botão "Visualizar Comprovante".

#### C. Captura do PDF (Blob)
1.  **Intercepção:** Ao clicar em visualizar, o robô captura o conteúdo binário do PDF diretamente da memória do navegador através do espião instalado.
2.  **Persistência:** O comprovante é salvo no diretório de evidências, nomeado prioritariamente como `comprovante-${observacao}.pdf` (ou `comprovante-${idDeposito}.pdf`).
3.  **Limpeza:** Fecha automaticamente abas temporárias (`blob:`) para manter a performance do navegador.

---

## 4. Especificações Técnicas Avançadas

| Técnica | Descrição |
| :--- | :--- |
| **Parser Nativo Zlib** | Descompressão direta de streams PDF sem bibliotecas externas pesadas ou dependência de OCR. |
| **Espião de Blob** | Sobrescrita da API nativa `URL.createObjectURL` para armazenar referências a objetos `application/pdf` criados pelo sistema. |
| **Extração em Base64** | Conversão do `ArrayBuffer` do PDF em memória para Base64 para transferência segura entre a página e o Node.js. |
| **Race Conditions de Captcha** | Uso de `Promise.race` para aguardar simultaneamente pelo botão de visualização, mensagem de erro ou timeout, evitando travamentos. |

---

## 5. Tratamento de Erros e Relatórios

*   **Metadados no Relatório:** O relatório final em Excel consolida o status da consulta, o ID consultado, o caminho do arquivo salvo e o arquivo de origem (guia PDF ou linha do Excel).
*   **Tratamento de Captcha:** Logs detalhados informam se a intervenção humana foi necessária.
*   **Falhas de Comunicação:** Erros de timeout ou indisponibilidade do portal da Caixa são registrados por linha, permitindo o reprocessamento posterior.
