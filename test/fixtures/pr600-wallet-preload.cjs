const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('walletProbe', {
  status: () => ipcRenderer.invoke('wallet:status'),
});
