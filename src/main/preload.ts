import { contextBridge, ipcRenderer } from 'electron';

// Version marker to verify preload refreshes in dev
const PRELOAD_VERSION = '2025-08-22-dbg1';

function safeInvoke(channel: string, ...args: any[]) {
  try { return ipcRenderer.invoke(channel, ...args); } catch (e) { return Promise.reject(e); }
}

const lcuApi = {
  isDetected: () => safeInvoke('lcu:isDetected'),
  getCurrentSummoner: () => safeInvoke('lcu:getCurrentSummoner'),
  debugRawUser: () => safeInvoke('lcu:debugRawUser'), // always expose even if handler missing initially
  getLobby: () => safeInvoke('lcu:getLobby'),
  getGameflowPhase: () => safeInvoke('lcu:getGameflowPhase'),
  getGameflowSession: () => safeInvoke('lcu:getGameflowSession'),
  getChampSelectSession: () => safeInvoke('lcu:getChampSelectSession'),
  getSummonerByPuuid: (puuid: string) => safeInvoke('lcu:getSummonerByPuuid', puuid)
};

const api = {
  ping: () => 'pong',
  meta: { preloadVersion: PRELOAD_VERSION },
  ipc: { invoke: safeInvoke },
  searchSummoner: async (query: string) => safeInvoke('riot:search', query),
  windowControls: {
    minimize: () => safeInvoke('window:minimize'),
    maximize: () => safeInvoke('window:maximize'),
    close: () => safeInvoke('window:close')
  },
  app: {
    getVersion: () => safeInvoke('app:getVersion'),
    checkForUpdate: () => safeInvoke('app:checkForUpdate'),
    startUpdateDownload: () => safeInvoke('app:startUpdateDownload'),
    quitAndInstall: () => safeInvoke('app:quitAndInstall'),
    onUpdateEvent: (cb: (event: string, payload?: any) => void) => {
      const forward = (channel: string) => (_: any, data: any) => cb(channel, data);
      ipcRenderer.on('update:available', forward('update:available'));
      ipcRenderer.on('update:not-available', forward('update:not-available'));
      ipcRenderer.on('update:download-progress', forward('update:download-progress'));
      ipcRenderer.on('update:downloaded', forward('update:downloaded'));
      ipcRenderer.on('update:error', forward('update:error'));
    }
  },
  lcu: lcuApi
};

try { console.log('[preload] exposed api keys', Object.keys(api), 'lcu keys', Object.keys(lcuApi), PRELOAD_VERSION); } catch {}

contextBridge.exposeInMainWorld('api', api);
