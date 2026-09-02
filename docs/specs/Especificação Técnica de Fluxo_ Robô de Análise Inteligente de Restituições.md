# Especificação Técnica de Fluxo: Robô de Análise Inteligente de Restituições

**Autor:** Antigravity (Google DeepMind Team)
**Data:** 22 de Julho de 2026
**Versão:** 1.0
**Arquivos Base:** `analise-restituicoes.js`, `restituicao-exporter.js`, `ai-service.js`, `profiles.json`

---

## 1. Visão Geral

O Robô de Análise Inteligente de Restituições automatiza a triagem, extração de dados e registro de processos de restituição financeira (como Restituição de Fiança, IPVA, ICMS e ITCD). Ele recebe PDFs contendo despachos, petições e guias de pagamento, extrai dados estruturados usando Inteligência Artificial integrada (via n8n) e consolida os resultados em três formatos:
1. **Planilha Operacional (`.xlsm`)**: Inserção cirúrgica direta no modelo macro-habilitado do Excel para preservar códigos VBA.
2. **Planilha de Backup (`.xlsx`)**: Arquivo auxiliar com toda a carga processada, estilizada via ExcelJS.
3. **Relatórios de Auditoria (`.pdf`)**: Relatórios visuais gerados dinamicamente via Puppeteer para conferência dos analistas.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `analise-restituicoes.js` | **Orquestrador:** Lê os arquivos PDF de entrada, carrega as diretrizes do perfil e invoca o processamento de IA e a geração de exportações. |
| `ai-service.js` | **Serviço de IA:** Envia os PDFs ao serviço externo (n8n/Gemini) e normaliza a resposta JSON de forma a desaninhar e validar os registros extraídos. |
| `restituicao-exporter.js` | **Exportador:** Resolve o mapeamento dinâmico de colunas e executa a injeção XML direta no arquivo `.xlsm`, além de gerar planilhas de backup e PDFs via Puppeteer. |
| `profiles.json` | **Perfilador de Configurações:** Armazena dados de chaves de extração, cabeçalhos das guias (`guia_fianca`, `guia_ipva`...) e configurações gerais do fluxo do robô. |

---

## 2. Fluxo Operacional

### 2.1. Preparação e Configuração
1. **Seleção de Entradas:** O usuário submete um lote de PDFs para o robô.
2. **Carga do Perfil:** O robô carrega o perfil de configuração `"Análise Inteligente de Restituições"` do arquivo `profiles.json`.
3. **Preparação de Pastas**: São estruturadas pastas de execução organizadas por data (`Planilhas` e `Evidencias`).

### 2.2. Extração via IA
1. **Mapeamento e API**: Os PDFs são enviados em lote para o webhook de extração estruturada do n8n.
2. **Desaninhamento de Dados**: A resposta é normalizada e estruturada em processos e listas de DAREs recolhidos (`dares_recolhidos`).
3. **Controle de Cancelamento**: Sinais de interrupção do usuário (`controle.abortar`) são verificados antes do início do processamento de escrita física.

### 2.3. Consolidação e Injeção de Dados (XLSM / OpenXML)
A escrita na planilha macro-habilitada `.xlsm` utiliza manipulação cirúrgica direta do ZIP da planilha (via `JSZip`), mantendo os binários VBA (`vbaProject.bin`) e controles intactos:
1. **Mapeamento Dinâmico de Colunas**: Identifica os cabeçalhos das guias do Excel usando resolvedor de sinônimos dinâmico para cobrir aliases e placeholders (ex: `"Documento Referência"`, `"DARE"`, `"123"`).
2. **Exclusão de Fórmulas e calcChain**:
   * O robô remove o arquivo `xl/calcChain.xml` dentro do ZIP antes de gravar. Isso faz com que o Excel reconstrua silenciosamente a cadeia de cálculo ao abrir a planilha, eliminando avisos de recuperação de dados.
   * O robô apaga linhas antigas ($\ge 2$) e escreve os dados usando strings inline do OpenXML (`t="inlineStr"` com `<is><t>`).
3. **Ordenação Estrita do OpenXML**: Como o Excel exige que as tags de células `<c>` dentro de uma `<row>` sigam estritamente a ordem alfabética de seus atributos de referência `r` (ex: `A2`, `B2`... `K2`, `L2`, `M2`), o robô calcula o índice da coluna (`colLetterToIndex`) e ordena o vetor de células antes da escrita do XML do arquivo, prevenindo o desaparecimento silencioso de valores como `"Valor autorizado"`.

---

## 3. Regras de Negócio Implementadas

### 3.1. Tratamento Condicional de DAREs (Múltiplos DAREs)
* **Processo com Único DARE**:
  * Os campos `"Documento Referência"` (Número do DARE) e `"Valor autorizado"` (Valor do DARE) são escritos diretamente na aba principal do processo (ex: `Fianca`).
  * Nenhuma linha é escrita na guia `DARE` (`Marcar DARE`) para evitar duplicidade de dados.
* **Processo com Múltiplos DAREs**:
  * Os campos `"Documento Referência"` e `"Valor autorizado"` na aba principal do processo recebem o valor literal **`"multiplos dares"`** e o campo de data fica em branco.
  * O campo de **Município** (`"Código Município"`, comum em restituições de IPVA) **é preservado** na aba principal com o código correspondente do processo/DAREs, garantindo o preenchimento automático pelo robô executor de IPVA.
  * Todas as guias individuais de DARE do processo são detalhadas em linhas separadas na aba `DARE` (`Marcar DARE`), permitindo a conciliação individualizada.

### 3.2. Relatórios de Auditoria em PDF
* **Modo de Exportação**: O robô lê `configuracoes_fixas.modo_exportacao_pdf` do perfil para gerar um PDF consolidado com todos os processos (`"unico"`) ou um arquivo por processo (`"individual"`).
* **Alerta de Baixa Confiança**: O robô destaca registros cujo nível de confiança de extração (`confianca_geral`) seja inferior ao limiar padrão (`0.80`), exibindo uma tarja vermelha de atenção no documento PDF.
* **Estilização Visual Premium**: Os relatórios utilizam design limpo com container `.field` de visualização em cartões, títulos em caixa alta e tipografia moderna (Inter/Roboto), garantindo legibilidade e uma estética corporativa premium.

---

## 4. Tratamento de Erros e Logs

* **Logs**: Todas as etapas registram logs com o prefixo `[BOT-Análise Inteligente de Restituições]`.
* **Tratamento de Inconsistências**: Os erros de processos individuais que falharam na análise de IA são agregados na lista de falhas e exibidos explicitamente na página do resumo executivo do relatório PDF para intervenção humana manual.
* **Preservação de Integridade**: Se o modelo `.xlsm` estiver ausente ou corrompido, o bot emite um alerta informativo no log e avança para gerar o backup `.xlsx` e os relatórios em PDF, evitando interrupções completas da ferramenta.
