import { contextBridge, ipcRenderer } from 'electron';

// Expose safe APIs
contextBridge.exposeInMainWorld('api', {
  ping: () => 'pong',
  searchSummoner: async (query: string) => {
    return ipcRenderer.invoke('riot:search', query);
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  }
});
