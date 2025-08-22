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
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    checkForUpdate: () => ipcRenderer.invoke('app:checkForUpdate'),
    startUpdateDownload: () => ipcRenderer.invoke('app:startUpdateDownload'),
    quitAndInstall: () => ipcRenderer.invoke('app:quitAndInstall'),
    onUpdateEvent: (cb: (event: string, payload?: any) => void) => {
      const forward = (channel: string) => (_: any, data: any) => cb(channel, data);
      ipcRenderer.on('update:available', forward('update:available'));
      ipcRenderer.on('update:not-available', forward('update:not-available'));
      ipcRenderer.on('update:download-progress', forward('update:download-progress'));
      ipcRenderer.on('update:downloaded', forward('update:downloaded'));
      ipcRenderer.on('update:error', forward('update:error'));
    }
  }
});
