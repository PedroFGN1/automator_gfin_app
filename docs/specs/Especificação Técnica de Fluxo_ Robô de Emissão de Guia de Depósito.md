# Especificação Técnica de Fluxo: Robô de Emissão de Guia de Depósito Judicial

| Atributo | Detalhe |
| :--- | :--- |
| **Autor** | Manus AI |
| **Data** | 08/05/2026 |
| **Versão** | 1.0 |
| **Arquivo Base** | `src/backend/bots/emissao-guia-deposito.js` |
| **Perfil ID** | `emissao-guia-deposito` |

## 1. Visão Geral

O robô **Emissão de Guia de Depósito Judicial** automatiza o processo de geração de guias de depósito no portal da Caixa Econômica Federal. Ele realiza a consulta do processo judicial, preenche os dados das partes (Autor e Réu), identifica o depositante e gera o boleto em PDF, salvando-o como evidência de sucesso.

## 2. Componentes do Sistema

### 2.1. Entradas (Planilha Excel)
O robô espera uma planilha com as seguintes colunas (conforme mapeamento no `profiles.json`):

| Coluna Interna | Nome na Planilha (Padrão) | Descrição |
| :--- | :--- | :--- |
| `PROCESSO` | `Proc. Judicial` | Número do processo judicial (formato CNJ). |
| `CPF_CNPJ_AUTOR` | `CPF/CNPJ Autor` | Documento de identificação do Autor. |
| `CPF_CNPJ_REU` | `CPF/CNPJ Réu` | Documento de identificação do Réu. |
| `MUNICIPIO` | `Município` | Nome do município para a guia (ex: GOIANIA). |
| `VALOR` | `Valor` | Valor do depósito (numérico ou formatado). |
| `DATA_VENCIMENTO`| `Data de Vencimento` | Data limite para pagamento da guia. |
| `OBSERVACAO` | `Observação` | Texto livre que será usado no nome do arquivo PDF. |

### 2.2. Configurações Fixas
Parâmetros definidos no `profiles.json` que não variam por linha:

*   **TELEFONE:** Telefone de contato enviado no formulário.
*   **CPF_CNPJ_DEPOSITANTE:** Documento do órgão depositante (GFIN).
*   **texto_cartao_justica:** Título do cartão de seleção (Padrão: "Justiça Estadual").
*   **estado_value:** Valor interno para seleção do estado (Padrão: "1: Object" para Goiás).

## 3. Fluxo Operacional

1.  **Inicialização:**
    *   Leitura da planilha e validação de campos obrigatórios.
    *   Criação da estrutura de pastas para logs e evidências.
2.  **Acesso ao Portal:**
    *   Navegação para `https://novodepositojudicial.caixa.gov.br/judicial`.
3.  **Consulta de Processo:**
    *   Inserção do número do processo.
    *   **Intervenção Humana (se necessário):** O robô detecta se há desafio de Captcha. Caso haja, aguarda a resolução manual e o clique em "Consultar Processo".
4.  **Seleção de Justiça:**
    *   Identifica e clica no cartão "Justiça Estadual".
5.  **Preenchimento de Partes:**
    *   Preenche CPF/CNPJ do Autor e do Réu.
    *   Seleciona o Depositante como "Outros" e preenche os dados da GFIN.
6.  **Dados do Depósito:**
    *   Preenche telefone, estado e município.
    *   Insere data de vencimento e valor (com tratamento de máscara).
    *   Adiciona a observação.
7.  **Geração e Captura:**
    *   Clica para gerar a guia.
    *   Monitora o console do navegador para capturar o stream do PDF gerado.
    *   Salva o PDF na pasta de evidências com o nome baseado na observação.
8.  **Finalização:**
    *   Clica em "Novo Depósito" para resetar o fluxo para a próxima linha.
    *   Gera relatório consolidado de Sucessos e Erros.

## 4. Tratamento de Erros e Exceções

*   **Campos Ausentes:** Validação inicial impede a execução de linhas com dados incompletos.
*   **Município Inválido:** Se o município da planilha não for encontrado no seletor do portal, a linha é marcada como erro e um print é tirado.
*   **Timeout de PDF:** Se o portal não retornar o PDF no tempo configurado, o erro é registrado.
*   **Interrupção:** O robô respeita o comando de "Parar" da interface Electron em qualquer etapa do loop.

## 5. Requisitos Técnicos

*   **Puppeteer Stealth:** Utilizado para evitar bloqueios de bot no portal da Caixa.
*   **AngularHelper:** Auxilia na interação com campos dinâmicos do framework Angular utilizado no site.
*   **Navigation Utils:** Gerencia formatação de datas e moedas para compatibilidade com os inputs.
