# Especificação Técnica de Fluxo: Robô de Dedução de Receita com Restituição de Recursos

**Autor:** Equipe de Automação GFIN  
**Data:** 30 de Agosto de 2026  
**Versão:** 1.0 (Nova Funcionalidade / Novo Bot)  
**Módulo Alvo:** SIOFI / SIAFIC — OP Extra-Orçamentária  
**Finalidade:** `86 - Dedução de Receita com Restituição de Recursos`  
**Arquivo Base Proposto:** `src/backend/bots/restituicao-deducao-receita.js`

---

## 1. Visão Geral da Funcionalidade

Esta especificação técnica detalha o mapeamento e a lógica de automação para a nova esteira **"Dedução de Receita com Restituição de Recursos"** (Finalidade código **`86`**). Esta esteira atenderá à demanda de alta vazão (lote de ~500 processos originados do Tribunal de Justiça - TJ e outras restituições especiais), viabilizando o processamento automatizado, seguro e com rastreabilidade completa.

### 1.1. Arquitetura Modular Integrada

| Módulo / Camada | Arquivo / Componente | Papel na Arquitetura |
| :--- | :--- | :--- |
| **Bot Orquestrador** | `src/backend/bots/restituicao-deducao-receita.js` | Gerencia o loop de processos, validações de campos e regras do formulário. |
| **Perfil de Execução** | `config/profiles.json` (`deducao-receita-restituicao`) | Centraliza URLs, finalidade (`86`), parâmetros de conta padrão e flags. |
| **Utilitários Puppeteer** | `src/backend/utils/puppeteer-utils.js` | Acesso aos frames (`principal`), injeção de valores e busca de beneficiário. |
| **Utilitários de Navegação** | `src/backend/utils/navigation-utils.js` | Delays assíncronos, conversão de datas (DD/MM/AAAA) e valores monetários. |
| **Gestão de Arquivos / I/O** | `src/backend/utils/file-utils.js` | Leitura de planilha base (.xlsx/.xlsm) e exportação do relatório consolidado. |
| **Evidências Visuais** | `img/tela_deducao_receita_restituicao.png` | Print estrutural de referência da tela capturado via DevTools. |

---

## 2. Mapeamento Técnico do Formulário SIOFI

* **URL Direta:** `https://siofi.sistemas.go.gov.br/siofi/servlet/control?cmd=EfetuarOPExtra`
* **Contexto de Execução:** Frame interno denominado `principal`
* **Formulário HTML:** `form[name="Navegacao"]`, método `POST`

### 2.1. Tabela de Seletores e Mapeamento de Campos

| Campo da Tela | Tag / Tipo | Nome no DOM / Seletor | Regra de Preenchimento / Origem dos Dados |
| :--- | :--- | :--- | :--- |
| **Exercício** | `input[type="hidden"]` | `txtExercicio` | Padrão: Ano corrente (`2026`). |
| **Finalidade (Código)** | `input[type="hidden"]` | `txtFinalidade` | Valor fixo: `86`. |
| **Finalidade (Nome)** | `input[type="hidden"]` | `txtNomeFinalidade` | `Dedução de Receita com Restituição de Recursos` |
| **Órgão / Unidade** | `input[type="text"]` | `txtOrgao` | Código do Órgão (ex.: `9995`). Dispara onchange para atualizar fontes. |
| **Data (Dia/Mês/Ano)** | `input[type="text"]` | `txtDiaCredito`, `txtMesCredito`, `txtAnoCredito` | Data da restituição particionada em 2D/2M/4Y com zero à esquerda. |
| **Valor** | `input[type="text"]` | `txtValor` | Valor monetário formatado (ex.: `1.250,00`). |
| **Beneficiário (ID)** | `input[type="hidden"]` | `idPessoa` | ID numérico recuperado via modal `ChamarBrowserBeneficiario()`. |
| **Beneficiário (CPF/CNPJ)** | `input[type="hidden"]` | `cpfCNPJ` | CPF ou CNPJ formatado do favorecido. |
| **Beneficiário (Nome)** | `input[type="text"]` | `nomePessoa` | Nome do favorecido (preenchido como readOnly). |
| **Receita Débito** | `input[type="text"]` | `txtCodigoReceitaDebito` | **Código de receita dinâmico** (definido na planilha ou perfil). |
| **Fonte Débito** | `select` | `cboNomeFonteDebito` | Select carregado dinamicamente após informar a receita e órgão. |
| **Tipo Débito** | `select` | `txtTipoContaDebito` | Ex.: `14` (CUTE), `1` (Movimento), `15` (Convênios), etc. |
| **Banco / Agência / Conta Débito** | `input[type="text"]` | `txtBancoDebito`, `txtAgenciaDebito`, `txtContaDebito` | Dados da conta debitada (injetados conforme perfil/DDR). |
| **Tipo Crédito** | `select` | `txtTipoContaCredito` | Padrão: `1` (Movimento). |
| **Banco Crédito** | `input[type="text"]` | `txtBancoCredito` | Código do banco de destino (3 dígitos). |
| **Agência Crédito** | `input[type="text"]` | `txtAgenciaCredito` | Agência de destino (até 4 dígitos sem dígito verificador). |
| **Conta Crédito** | `input[type="text"]` | `txtContaCredito` | Número da conta corrente / poupança de crédito com DV. |
| **Enviar para Banco** | `input[type="radio"]` | `txtEnviarBanco` (valor: `S`) | Sempre marcado como `Sim` (`S`). |
| **Lista de Credores** | `input[type="checkbox"]` | `txtListaCredores` | **SEMPRE DESMARCADO** (`false` / valor interno `N`). |
| **Histórico** | `textarea` | `txtHistorico` | Texto descritivo da restituição / processo SEI. |
| **Rascunho** | `input[type="radio"]` | `txtIsRascunho` (valor: `N`) | Padrão `Não` (`N`). |

---

## 3. Regras Críticas e Comportamentos Operacionais

1. **Seleção Inicial da Finalidade 86:**
   - Na fase de abertura da OP Extra, o sistema deve selecionar no dropdown de finalidade o item correspondente a `86 - Dedução de Receita com Restituição de Recursos` antes de carregar o formulário completo.

2. **Parametrização Dinâmica da Receita de Débito:**
   - O código da receita débito não deve ficar restrito a um valor hardcoded.
   - O bot deve ler prioritariamente a coluna/parâmetro `"Receita Débito"` (ou a célula configurada na planilha de controle pelo operador), aplicando esse código dinamicamente para o processamento de lotes homogêneos (ex.: lote de Imposto de Renda do TJ).

3. **Validação Estrita da "Lista de Credores":**
   - O campo `txtListaCredores` deve permanecer explicitamente desmarcado. Caso esteja marcado por padrão ou cache, o robô deve forçar seu desmarque (`checked = false`).

4. **Tratamento do Botão "Incluir":**
   - No fluxo de automação, o botão `Incluir` (`input[name="botao"][value="Incluir"]`) só deve ser disparado após validação rigorosa de todos os campos obrigatórios em memória.
   - Captura de confirmação e extração do número da OP através de regex no formato `YYYY.ÓRGÃO.SEQUENCIAL` (ex.: `2026.9995.XXXX`).

---

## 4. Próximos Passos de Desenvolvimento

- [ ] Adicionar o perfil `deducao-receita-restituicao` no arquivo `config/profiles.json`.
- [ ] Criar o arquivo do bot `src/backend/bots/restituicao-deducao-receita.js` baseado no blueprint padrão.
- [ ] Registrar o novo bot no `src/backend/manager.js` e mapeá-lo na UI do Electron (`src/frontend/`).
