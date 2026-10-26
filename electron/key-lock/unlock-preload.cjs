// The unlock window's only doors: try a Recovery Kit code, or quit.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('keyLock', {
  unlock: (code) => ipcRenderer.invoke('keyLock:unlock', code),
  quit: () => ipcRenderer.send('keyLock:quit'),
});
