const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('darkMode', {
  toggle: () => ipcRenderer.invoke('dark-mode:toggle'),
  system: () => ipcRenderer.invoke('dark-mode:system')
})

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron
})

contextBridge.exposeInMainWorld('api', {
    // Função para abrir seletor de arquivo
    selecionarArquivo: (perfilId) => ipcRenderer.invoke('dialog:openFile', perfilId),
    
    // Funções para controle do bot
    iniciarBot: (dados) => ipcRenderer.invoke('bot:iniciar', dados),
    pararBot: () => ipcRenderer.invoke('bot:parar'),
    continuarExecucao: () => ipcRenderer.send('acao-continuar'),
    lerConfig: () => ipcRenderer.invoke('config:ler'),

    // Função para salvar configuração
    salvarConfig: (json) => ipcRenderer.invoke('config:salvar', json),

    // Função para exibir dialog de continuação
    exibirDialogContinuacao: (params) => ipcRenderer.invoke('dialog:exibir-continuacao', params),

    // Ouvinte de logs (Do backend para o frontend)
    onLog: (callback) => ipcRenderer.on('bot:log', (event, msg) => callback(msg)),

    // Função para abrir arquivo ou pasta via sistema operacional
    abrirCaminho: (caminho) => ipcRenderer.invoke('shell:abrirCaminho', caminho),

    // Ouvinte para modal de instruções
    onAbrirModalInstrucoes: (callback) => ipcRenderer.on('abrir-modal-instrucoes', (_event, payload) => callback(payload))
});
