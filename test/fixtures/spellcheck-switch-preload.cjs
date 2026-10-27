// The proof page's knock: the same IPC the CONNECTIONS panel sends after a flip (electron/preload.cjs).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('knock', () => ipcRenderer.invoke('connections:changed'));
