const { app, BrowserWindow, ipcMain, nativeTheme, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('fs');
const logger = require('../backend/utils/logger');

const botRestituicao_Fianca_ICMS_ITCD = require('../backend/bots/restituicao-fianca_icms_itcd');
const botRestituicaoIPVA = require('../backend/bots/restituicao-ipva');
const botMarcacaoTerminal = require('../backend/bots/marcacao-terminal');
const botMarcacaoARR = require('../backend/bots/marcacao-arr');
const botCadastroBeneficiario = require('../backend/bots/cadastro-beneficiario');
const botConsultaOPEQuitada = require('../backend/bots/consultar-ope-quitada');
const botConsultaOPQuitada = require('../backend/bots/consultar-op-quitada');
const botEmissaoGuiaDeposito = require('../backend/bots/emissao-guia-deposito');
const botCadastroDocumento = require('../backend/bots/cadastro-documento');
const botConsultaGuiaAutenticada = require('../backend/bots/consultar-guia-autenticada');
const botConsultaCND = require('../backend/bots/consultar-cnd');
const botAnaliseHonorarios = require('../backend/bots/analise-honorarios-periciais');
const botAnaliseRestituicoes = require('../backend/bots/analise-restituicoes');


let mainWindow;

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit() // Fecha a segunda instância imediatamente
} else {
  app.on('second-instance', () => {
    // Foca na janela principal se alguém tentar abrir outra
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// Caminho absoluto para o profiles.json (o real) ou o exemplo sanitizado
const caminhoProfilesReal = path.join(__dirname, '../../config/profiles.json');
const caminhoProfilesExemplo = path.join(__dirname, '../../config/profiles.example.json');

let caminhoProfiles;
if (fs.existsSync(caminhoProfilesReal)) {
  caminhoProfiles = caminhoProfilesReal;
} else if (fs.existsSync(caminhoProfilesExemplo)) {
  caminhoProfiles = caminhoProfilesExemplo;
  console.warn('[AVISO] Usando profiles.example.json. Copie-o para profiles.json e configure com seus dados reais.');
} else {
  console.error('[ERRO] Nenhum arquivo de configuração encontrado em config/. Copie profiles.example.json para profiles.json.');
  app.quit();
}

let profiles = JSON.parse(fs.readFileSync(caminhoProfiles, 'utf-8'));

// Objeto de controle global para o bot
let controleExecucao = { abortar: false };

// Estado compartilhado para sinais entre frontend e bot
let sharedState = { continuarSignal: false };

ipcMain.on('acao-continuar', () => {
    sharedState.continuarSignal = true;
});

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.loadFile(path.join(__dirname, '../frontend/index.html'));
  //mainWindow.webContents.openDevTools(); // Descomente para debug
  mainWindow.removeMenu()
}

ipcMain.handle('dark-mode:toggle', () => {
  if (nativeTheme.shouldUseDarkColors) {
    nativeTheme.themeSource = 'light'
  } else {
    nativeTheme.themeSource = 'dark'
  }
  return nativeTheme.shouldUseDarkColors
})

ipcMain.handle('dark-mode:system', () => {
  nativeTheme.themeSource = 'system'
})

app.whenReady().then(() => {
  // 1. Handler para Selecionar Arquivo
  ipcMain.handle('dialog:openFile', async (event, perfilId) => {
      const isEntradaPdf = perfilId === 'consultar-cnd' || perfilId === 'analise-honorarios-periciais' || perfilId === 'analise-restituicoes';
      const { canceled, filePaths } = await dialog.showOpenDialog({
          properties: isEntradaPdf ? ['openFile', 'multiSelections'] : ['openFile'],
          filters: isEntradaPdf
            ? [{ name: 'PDF', extensions: ['pdf'] }]
            : [{ name: 'Excel', extensions: ['xlsx'] }]
      });
      if (canceled) return null;
      return isEntradaPdf ? filePaths : filePaths[0];
  });

  // 2. Handler para Iniciar o Bot
  ipcMain.handle('bot:iniciar', async (event, dadosExecucao) => {
      // Garante que o estado de abortamento e sinalização seja reiniciado a cada nova execução
      controleExecucao.abortar = false;
      sharedState.continuarSignal = false;

      const { perfilId, caminhoArquivo } = dadosExecucao;
      
      // Encontra a configuração do perfil selecionado
      const configPerfil = profiles.perfis.find(p => p.id === perfilId);
      const dirSaida = profiles.diretorio_saida_padrao;

      if (!configPerfil) return { sucesso: false, erro: 'Perfil não encontrado' };

      // Função de callback para enviar logs para a janela
      const enviarLog = (mensagem) => {
          event.sender.send('bot:log', mensagem);
      };

      // Roda o Bot
      if (perfilId === 'restituicao-fianca' || perfilId === 'restituicao-icms' || perfilId === 'restituicao-itcd') {
          return await botRestituicao_Fianca_ICMS_ITCD.executarRestituicao_Fianca_ICMS_ITCD(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao);
      }
      if (perfilId === 'restituicao-ipva') {
          return await botRestituicaoIPVA.executarRestituicaoIPVA(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao);
      }
      if (perfilId === 'marcacao-terminal') {
          return await botMarcacaoTerminal.executarMarcacaoTerminal(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao, mainWindow, sharedState);
      }
      if (perfilId === 'marcacao-arr') {
          return await botMarcacaoARR.executarMarcacaoARR(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao);
      }
      if (perfilId === 'cadastro-beneficiario') {
          return await botCadastroBeneficiario.executarCadastroBeneficiario(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao);
      }
      if (perfilId === 'cadastro-documento') {
          return await botCadastroDocumento.executarCadastroDocumento(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao);
      }
      if (perfilId === 'consultar-ope-quitada') {
          return await botConsultaOPEQuitada.executarConsultaOPEQuitada(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao);
      }
      if (perfilId === 'consultar-op-quitada') {
          return await botConsultaOPQuitada.executarConsultaOPQuitada(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao);
      }
      if (perfilId === 'emissao-guia-deposito') {
          return await botEmissaoGuiaDeposito.executarEmissaoGuiaDeposito(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao, mainWindow, sharedState);
      }
      if (perfilId === 'consultar-guia-autenticada') {
          return await botConsultaGuiaAutenticada.executarConsultaGuiaAutenticada(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao);
      }
      if (perfilId === 'consultar-cnd') {
          return await botConsultaCND.executarConsultaCND(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao);
      }
      if (perfilId === 'analise-honorarios-periciais') {
          return await botAnaliseHonorarios.executarAnaliseHonorariosPericiais(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao);
      }
      if (perfilId === 'analise-restituicoes') {
          return await botAnaliseRestituicoes.executarAnaliseRestituicoes(configPerfil, caminhoArquivo, dirSaida, enviarLog, controleExecucao);
      }
      return { sucesso: false, erro: 'Bot não implementado para este perfil' };
  });

  // Handler: PARAR
  ipcMain.handle('bot:parar', async () => {
      controleExecucao.abortar = true;
      logger.gravarLogSistema('Solicitação de parada recebida.');
      return true;
  });

  // Handler: LER CONFIG (Para a tela de edição)
  ipcMain.handle('config:ler', async () => {
      return fs.readFileSync(caminhoProfiles, 'utf-8');
  });

  // Handler: SALVAR CONFIG
  ipcMain.handle('config:salvar', async (event, novoConteudoJSON) => {
      try {
          // Valida se é JSON válido antes de salvar
          JSON.parse(novoConteudoJSON); 
          fs.writeFileSync(caminhoProfiles, novoConteudoJSON, 'utf-8');
          return { sucesso: true };
      } catch (e) {
          return { sucesso: false, erro: 'JSON Inválido: ' + e.message };
      }
  });

  // Handler: ABRIR CAMINHO DE ARQUIVO
  ipcMain.handle('shell:abrirCaminho', async (event, caminhoArquivo) => {
      try {
          if (!caminhoArquivo) return { sucesso: false, erro: 'Caminho não informado.' };
          const res = await shell.openPath(caminhoArquivo);
          if (res) {
              return { sucesso: false, erro: res };
          }
          return { sucesso: true };
      } catch (e) {
          return { sucesso: false, erro: e.message };
      }
  });

  // Handler: EXIBIR DIALOG DE CONTINUAÇÃO
  ipcMain.handle('dialog:exibir-continuacao', async (event, params) => {
    const { tipoMensagem, numLinha, idProcesso, ultimoErro, tentativaAtual, maxTentativas, tipoUsuarioTerminal } = params;

    // Restaura e foca a janela se estiver minimizada
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();

    let message = '';
    let buttons = [];
    let defaultId = 0;

    if (tipoMensagem === 'primeira_tentativa') {
      message = `Pronto para processar linha ${numLinha} (Processo: ${idProcesso}).\n\nClique em "Voltar à Tela" para continuar.`;
      buttons = ['Voltar à Tela'];
    } else if (tipoMensagem === 'erro') {
      message = `❌ Erro na linha ${numLinha} (Processo: ${idProcesso})\nTentativa ${tentativaAtual}/${maxTentativas}\n\nErro: ${ultimoErro}\n\nO que deseja fazer?`;
      buttons = ['Ver Instruções', 'Continuar Mesmo Assim', 'Pular para Próxima', 'Abortar Tudo'];
      defaultId = 0;
    }

    const resposta = await dialog.showMessageBox(mainWindow, {
      type: tipoMensagem === 'erro' ? 'error' : 'info',
      title: 'Automator GFIN - Confirmação Necessária',
      message: message,
      buttons: buttons,
      defaultId: defaultId,
      cancelId: 3 // Último botão (Abortar) é cancel
    });

    // Mapeia resposta para ação
    let acao = '';
    if (tipoMensagem === 'primeira_tentativa') {
      acao = 'continuar';
    } else {
      switch (resposta.response) {
        case 0: 
          acao = 'ver_instruções';
          // Envia evento para frontend abrir modal
          event.sender.send('abrir-modal-instrucoes', { tipoUsuarioTerminal });
          break;
        case 1: acao = 'continuar'; break;
        case 2: acao = 'proxima'; break;
        case 3: acao = 'abortar'; break;
      }
    }

    return { acao, responseIndex: resposta.response };
  });



  createWindow()

  app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
