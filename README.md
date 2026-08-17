# 🤖 Automator GFIN - Robô de Finanças

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)

Ferramenta de automação desktop para processamento de **Restituições**, **Marcações**, **Cadastros** e **Emissão de Guias** no portal SIOFI, SARE, ARR e CAIXA. Desenvolvido com Electron, Node.js e Puppeteer.

## ✨ Funcionalidades

*   **Processamento em Lote:** Lê planilhas Excel e preenche formulários web automaticamente.
*   **Inteligência de Navegação:** Lida com logins, popups, captchas e múltiplas abas.
*   **Relatórios Automáticos:** Gera planilhas de "Sucesso" e "Erro" ao final de cada execução.
*   **Evidências:** Captura screenshots automáticos de erros e salva PDFs de comprovantes/guias.
*   **Logs Detalhados:** Histórico completo de execução salvo em texto para auditoria.

## 🚀 Como Iniciar (Sem Instalação)

Esta versão é **Portátil**. Não requer direitos de administrador.

1.  Baixe a pasta do projeto.
2.  Certifique-se de estar conectado à internet e ter o NodeJS (v18.0 ou superior) instalado.
3.  Configure o arquivo de perfis (veja a seção **Configuração** abaixo).
4.  Clique duas vezes no arquivo **`iniciar.bat`**.
5.  O sistema irá configurar tudo sozinho e abrir a janela do robô.

## 🛠️ Configuração

Antes de usar o aplicativo pela primeira vez:

1.  Copie o arquivo de configuração template:
    ```bash
    cp config/profiles.example.json config/profiles.json
    ```
2.  Edite `config/profiles.json` com as URLs, dados bancários e credenciais do seu ambiente.
3.  Você também pode editar as configurações pela aba de configurações dentro do aplicativo.

> ⚠️ **Importante:** O arquivo `config/profiles.json` contém dados sensíveis e não deve ser commitado no Git. Ele já está no `.gitignore`.

## 📋 Como Usar

1.  Abra o aplicativo.
2.  Selecione o **Tipo de Processo** (Ex: Restituição de Fiança, Emissão de Guia de Depósito).
3.  Carregue a **Planilha de Dados** (.xlsx).
4.  Clique em **INICIAR AUTOMAÇÃO**.
5.  O navegador abrirá. **Faça o Login manualmente** (se necessário) e siga as instruções na janela de aviso.
6.  Aguarde o fim da execução e verifique os relatórios gerados.

## 📁 Estrutura do Projeto

```
automacao_gefin_app/
├── config/                         # Arquivos JSON de configuração
│   └── profiles.example.json       # Template sanitizado de configuração (edite e renomeie)
├── docs/                           # Documentação técnica e especificações
│   ├── blueprint/                  # Padrões para desenvolvimento de novos bots
│   └── specs/                      # Especificações técnicas de cada robô
├── img/                            # Assets visuais da interface
├── src/
│   ├── main/                       # Processo Principal (Electron Backend)
│   ├── backend/                    # Lógica dos Robôs (Puppeteer)
│   │   ├── bots/                   # Scripts específicos de automação
│   │   │   ├── analise-honorarios-periciais.js
│   │   │   ├── analise-restituicoes.js
│   │   │   ├── cadastro-beneficiario.js
│   │   │   ├── cadastro-documento.js
│   │   │   ├── consultar-cnd.js
│   │   │   ├── consultar-guia-autenticada.js
│   │   │   ├── consultar-op-quitada.js
│   │   │   ├── consultar-ope-quitada.js
│   │   │   ├── emissao-guia-deposito.js
│   │   │   ├── marcacao-arr.js
│   │   │   ├── marcacao-terminal.js
│   │   │   ├── restituicao-fianca_icms_itcd.js
│   │   │   └── restituicao-ipva.js
│   │   └── utils/                  # Utilitários compartilhados (Angular, Nav, File)
│   └── frontend/                   # Interface do Usuário (HTML/JS/CSS)
├── .gitignore                      # Regras de exclusão do Git
├── iniciar.bat                     # Script de inicialização rápida
├── LICENSE.md                      # Licença MIT
├── package.json                    # Metadados e dependências do projeto
└── README.md                       # Este arquivo
```

## 🤖 Robôs Disponíveis

| Robô | Descrição | Portal |
| :--- | :--- | :--- |
| **Restituições** | Processa ordens de pagamento para restituições de Fiança, IPVA, ICMS e ITCD. | SIOFI |
| **Marcação Terminal** | Realiza a marcação de documentos de arrecadação para restituições no terminal SEFAZ. | SARE/SEFAZ |
| **Marcação ARR** | Efetua a marcação de documentos de arrecadação para restituições no sistema ARR. | ARR/SEFAZ |
| **Cadastro Beneficiário** | Automatiza a inclusão de favorecidos no sistema. | SIOFI |
| **Cadastro Documento** | Inclusão de documentos via código de barras com validação de duplicidade. | SIOFI |
| **Análise Honorários** | Extração inteligente de dados de honorários periciais via IA (n8n). | PDF/IA |
| **Análise Restituições** | Análise inteligente de processos de restituição com classificação por tipo via IA. | PDF/IA |
| **Consultar CND** | Emissão e validação de Certidão Negativa de Débitos via SEFAZ-GO. | SEFAZ-GO |
| **Consulta Guia Autenticada** | Recuperação de comprovantes de depósito judicial com tratamento de Captcha e Blob. | CAIXA |
| **Consulta OP/OPE** | Consulta e extrai comprovantes de ordens de pagamento. | SIOFI |
| **Emissão de Guia** | Emissão de Guia de Depósito Judicial. | CAIXA |

## 📝 Licença

Este projeto está licenciado sob a [MIT License](LICENSE.md).

Desenvolvido por Pedro Ferreira Galvão Neto para a GFIN (Gerência de Administração Financeira da Subsecretaria do Tesouro Estadual de Goiás).
