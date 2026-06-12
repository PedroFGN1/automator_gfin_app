# 🤖 Automator GFIN - Robô de Finanças

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
3.  Clique duas vezes no arquivo **`iniciar.bat`**.
4.  O sistema irá configurar tudo sozinho e abrir a janela do robô.

## 🛠️ Configuração

As configurações de URLs e Mapeamento de Colunas ficam no arquivo:
`config/profiles.json`
Você pode editar este arquivo diretamente ou usar a aba de configurações dentro do aplicativo.

## 📋 Como Usar

1.  Abra o aplicativo.
2.  Selecione o **Tipo de Processo** (Ex: Restituição de Fiança, Emissão de Guia de Depósito).
3.  Carregue a **Planilha de Dados** (.xlsx).
4.  Clique em **INICIAR AUTOMAÇÃO**.
5.  O navegador abrirá. **Faça o Login manualmente** (se necessário) e siga as instruções na janela de aviso.
6.  Aguarde o fim da execução e verifique os relatórios gerados.

## 📁 Estrutura do Projeto

A estrutura do projeto na versão **v1.6** é organizada da seguinte forma:

```
automacao_gefin_app/
├── config/                 # Arquivos JSON de configuração
│   └── profiles.json       # Define perfis, URLs e mapeamento de colunas
├── docs/                   # Documentação técnica e especificações
│   ├── blueprint/          # Padrões para desenvolvimento de novos bots
│   ├── debug/              # Documentos de testes e depuração
│   ├── plans/              # Planos de implementação
│   └── specs/              # Especificações técnicas de cada robô
├── img/                    # Assets visuais da interface
├── logs/                   # Logs de execução do sistema
├── src/
│   ├── main/               # Processo Principal (Electron Backend)
│   ├── backend/            # Lógica dos Robôs (Puppeteer)
│   │   ├── bots/           # Scripts específicos de automação
│   │   │   ├── analise-honorarios-periciais.js 🆕
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
│   │   └── utils/          # Utilitários compartilhados (Angular, Nav, File)
│   └── frontend/           # Interface do Usuário (HTML/JS/CSS)
├── tests/                  # Testes automatizados (Jest)
├── uploads/                # Modelos de planilhas para testes
└── iniciar.bat             # Script de inicialização rápida
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
| **Consultar CND** | Emissão e validação de Certidão Negativa de Débitos via SEFAZ-GO. | SEFAZ-GO |
| **Consulta Guia Autenticada** | Recuperação de comprovantes de depósito judicial com tratamento de Captcha e Blob. | CAIXA |
| **Consulta OP/OPE** | Consulta e extrai comprovantes de ordens de pagamento. | SIOFI |
| **Emissão de Guia** | Emissão de Guia de Depósito Judicial. | CAIXA |


## Tela Inicial
![Tela inicial](img/tela_inicial.png)

## Links de Acesso
[Drive](https://drive.google.com/drive/folders/1-lZU1EYFpA2yV12Lkg4z1i1oERVA2F2A?usp=sharing)

## 📝 Licença

© 2026 Todos os direitos Reservados. **Desenvolvido para uso interno GFIN (Gerência de Administração Financeira da Subsecretaria do Tesouro Estadual de Goiás).**
