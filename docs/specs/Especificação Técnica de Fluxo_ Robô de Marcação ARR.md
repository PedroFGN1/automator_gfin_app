# Especificação Técnica de Fluxo: Robô de Marcação ARR

**Autor:** Manus AI
**Data:** 05 de Março de 2026
**Versão:** 1.0
**Arquivos Base:** `marcacao-arr.js` e `arr-utils.js`

---

## 1. Visão Geral

O Robô de Marcação ARR automatiza a consulta e marcação de restituições no sistema ARR (Arrecadação de Receitas Reais) da SEFAZ-GO. Ele interage com uma interface web moderna (JSF/PrimeFaces), realizando pesquisas de documentos (DARE/GNRE), preenchimento de modais de restituição e captura de comprovantes de pagamento em PDF.

### 1.1. Componentes do Sistema

| Módulo | Responsabilidade |
| :--- | :--- |
| `marcacao-arr.js` | **Orquestrador:** Coordena o loop de processamento, navegação entre páginas e lógica de negócio. |
| `arr-utils.js` | **Interação PrimeFaces:** Utilitários para manipular componentes SelectOneMenu, RadioButtons e tabelas de dados JSF. |
| `file-utils.js` | **I/O:** Leitura de planilhas Excel e exportação de relatórios finais. |
| `navigation-utils.js` | **Auxiliares:** Formatação de datas e moedas, além de delays de sincronização. |
| `logger.js` | **Rastreabilidade:** Registro de logs persistentes em arquivo e console. |

---

## 2. Fluxo Operacional

### 2.1. Inicialização e Segurança
O robô segue o padrão de segurança do projeto para acesso a sistemas governamentais:

1.  **Estrutura de Pastas:** Cria diretórios para `evidencias` (prints/PDFs) e `planilhas` de saída.
2.  **Carga de Dados:** Lê a planilha de entrada, identificando o tipo de documento (DARE ou GNRE), contribuinte e datas.
3.  **Login Humano:** Abre o portal SEFAZ e aguarda o login manual do usuário. O processamento só inicia após o usuário confirmar na interface do robô que o sistema SIOFI está pronto.

### 2.2. Ciclo de Processamento (Loop de Dados)
Para cada linha da planilha, o robô executa as seguintes etapas:

#### A. Consulta de Documento
*   **Navegação Direta:** Acessa a URL do formulário de consulta de histórico de pagamentos.
*   **Seleção Dinâmica:** Marca o rádio correspondente (DARE ou GNRE) e seleciona o tipo de contribuinte e período no componente `PrimeFaces SelectOneMenu`.
*   **Inserção de Dados:** Utiliza a técnica de "Colar" (`inserirValorDireto`) para preencher o documento do contribuinte e as datas, disparando eventos de máscara do sistema.

#### B. Processamento de Resultados
1.  **Pesquisa:** Clica em pesquisar e aguarda a estabilização da rede (`waitForNetworkIdle`).
2.  **Localização na Tabela:** Varre as linhas da tabela `tabelaPagamentos` em busca do número do DARE/GNRE informado.
3.  **Ação de Restituição:** Identificado o registro, o robô aciona o botão de restituição na linha correspondente.

#### C. Preenchimento do Modal de Restituição
O robô abre o modal de detalhes e preenche:
*   Número do processo SEI.
*   Tipo e Forma de restituição (pré-configurados como "Restituição" e "Espécie").
*   Valor a restituir e informações complementares.
*   Em caso de duplicidade, o robô aciona o botão específico de correção.

### 2.3. Captura de Evidências e Comprovantes
*   **Screenshot de Sucesso:** Captura a tela do sistema após o preenchimento do modal.
*   **Comprovante PDF (DARE):** Para documentos do tipo DARE, o robô acessa a URL de visualização do comprovante e salva o PDF original como evidência adicional.
*   **GNRE:** Como o sistema ARR não disponibiliza PDF para GNRE, o robô registra um print da tela como evidência de processamento.

---

## 3. Especificações Técnicas de Interface

O sistema ARR utiliza componentes PrimeFaces, que exigem tratamentos especiais para automação:

| Desafio Técnico | Solução Implementada |
| :--- | :--- |
| **IDs Dinâmicos (JSF)** | Uso de prefixos configuráveis em `profiles.json` para montar seletores CSS escapados. |
| **SelectOneMenu** | Simulação de clique no trigger, espera pelo painel flutuante e seleção via `innerText`. |
| **Máscaras de Input** | Injeção direta de valor via JavaScript seguida de disparos de eventos `input`, `change` e `blur`. |
| **Tabelas de Dados** | Navegação em `tbody` com filtros via `evaluate` para encontrar o DARE exato. |

---

## 4. Tratamento de Erros e Relatórios

*   **Logs Duplos:** Mensagens enviadas em tempo real para o frontend e gravadas em arquivo TXT.
*   **Relatório Excel:** Ao final, gera uma planilha com o status (SUCESSO/ERRO) e a mensagem detalhada de cada item processado.
*   **Abortagem:** Permite ao usuário interromper o loop a qualquer momento de forma segura.
