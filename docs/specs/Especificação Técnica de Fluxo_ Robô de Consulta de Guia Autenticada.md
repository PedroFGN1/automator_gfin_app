# Especificação Técnica de Fluxo: Robô de Consulta de Guia Autenticada

**Autor:** Manus AI
**Data:** 18 de Maio de 2026
**Versão:** 1.0
**Arquivos Base:** `consultar-guia-autenticada.js`, `angular-utils.js`, `puppeteer-extra`

---

## 1. Visão Geral

O Robô de Consulta de Guia Autenticada é especializado na recuperação de comprovantes de depósito judicial no portal da Caixa Econômica Federal. Diferente dos outros bots, este lida com elementos em **Angular** e uma proteção robusta de **Captcha**, além de capturar arquivos PDF gerados dinamicamente em memória (Blob URLs), garantindo que o documento seja salvo localmente sem a necessidade de diálogos de impressão do navegador.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `consultar-guia-autenticada.js` | **Orquestrador:** Gerencia a detecção de Captcha, a espionagem de memória para PDFs e o ciclo de vida das abas Blob. |
| `angular-utils.js` | **Interação Angular:** Utilitários para preencher campos que utilizam o framework Angular, disparando os eventos necessários para validação. |
| `puppeteer-extra-plugin-stealth` | **Evasão:** Utilizado para reduzir a detecção do robô por sistemas de segurança e WAF. |
| `file-utils.js` | **I/O:** Leitura de IDs de depósito e exportação de relatórios com metadados dos arquivos capturados. |

---

## 2. Fluxo Operacional

### 2.1. Inicialização
1.  **Configuração de Perfil:** Carrega URLs e seletores específicos, com suporte a timeouts estendidos para resolução de Captcha.
2.  **Preparação de Memória:** Instala um "espião" na função `URL.createObjectURL` do navegador para interceptar a criação de documentos PDF.

### 2.2. Ciclo de Processamento

#### A. Preenchimento e Consulta
*   **Input Angular:** O ID do depósito é preenchido utilizando `preencherCampoAngular`, garantindo que o sistema reconheça a entrada de dados.
*   **Detecção de Captcha:** O robô verifica se um desafio de Captcha está visível. Se estiver, aguarda a resolução manual pelo usuário. Caso contrário, prossegue automaticamente com o clique em "Consultar ID".

#### B. Validação de Resultado
*   **Guia Não Paga:** O robô monitora mensagens de erro específicas como "Não consta pagamento...". Se encontrada, a linha é marcada como erro com a justificativa do sistema.
*   **Liberação de Visualização:** Aguarda a habilitação do botão "Visualizar Comprovante".

#### C. Captura do PDF (Blob)
1.  **Intercepção:** Ao clicar em visualizar, o robô captura o conteúdo binário do PDF diretamente da memória do navegador através do espião instalado.
2.  **Persistência:** O buffer binário é convertido e salvo como um arquivo `.pdf` no diretório de evidências, nomeado com o ID do depósito.
3.  **Limpeza:** Fecha automaticamente abas temporárias (`blob:`) para manter a performance do navegador.

---

## 3. Especificações Técnicas Avançadas

| Técnica | Descrição |
| :--- | :--- |
| **Espião de Blob** | Sobrescrita da API nativa `URL.createObjectURL` para armazenar referências a objetos `application/pdf` criados pelo sistema. |
| **Extração em Base64** | Conversão do `ArrayBuffer` do PDF em memória para Base64 para transferência segura entre o contexto da página e o processo Node.js. |
| **Race Conditions de Captcha** | Uso de `Promise.race` para aguardar simultaneamente pelo botão de visualização, mensagem de erro ou timeout, evitando travamentos. |

---

## 4. Tratamento de Erros e Relatórios

*   **Metadados no Relatório:** O relatório final inclui o tamanho do arquivo capturado e o caminho completo, facilitando a conferência.
*   **Tratamento de Captcha:** Logs detalhados informam se a intervenção humana foi necessária.
*   **Falhas de Comunicação:** Erros de timeout ou indisponibilidade do portal da Caixa são registrados por linha, permitindo o reprocessamento posterior.
