import { app, BrowserWindow, ipcMain } from 'electron';
import * as lcu from './lcu';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import 'dotenv/config';
import path from 'node:path';
// Generated at build time (contains supabaseFunctionsUrl). Optional during dev.
let embeddedSupabaseUrl: string | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  embeddedSupabaseUrl = require('./generatedConfig').embedded?.supabaseFunctionsUrl;
} catch {}

const isDev = process.env.NODE_ENV === 'development';

// Register LCU IPC handlers using new library
try { ipcMain.removeHandler('lcu:isDetected'); } catch {}
try { ipcMain.removeHandler('lcu:getCurrentSummoner'); } catch {}
try { ipcMain.removeHandler('lcu:getLobby'); } catch {}
try { ipcMain.removeHandler('lcu:getGameflowPhase'); } catch {}
try { ipcMain.removeHandler('lcu:getGameflowSession'); } catch {}
try { ipcMain.removeHandler('lcu:getChampSelectSession'); } catch {}
try { ipcMain.removeHandler('lcu:getSummonerByPuuid'); } catch {}
try { ipcMain.removeHandler('lcu:getLiveGameData'); } catch {}
try { ipcMain.removeHandler('lcu:getLivePlayerList'); } catch {}
ipcMain.handle('lcu:isDetected', () => ({ detected: lcu.getStatus() === 'UP' }));
ipcMain.handle('lcu:getCurrentSummoner', async () => {
  if (lcu.getStatus() !== 'UP') return null;
  try {
    const user = await lcu.getCurrentUser({ timeoutMs: 2000 });
    console.log('[lcu] fetched user', {
      displayName: user.displayName,
      gameName: user.gameName,
      tagLine: user.tagLine,
      summonerId: user.summonerId,
      puuid: user.puuid,
      profileIconId: user.profileIconId,
      summonerLevel: user.summonerLevel
    });
    const riotId = user.gameName || user.displayName || 'Player';
    const tagLine = (user.tagLine && user.tagLine.length > 0) ? user.tagLine : '';
    if (!user.gameName || !user.tagLine) {
      console.warn('[lcu] missing riotId components', { resolvedRiotId: riotId, tagLine, raw: user });
    }
    return {
      riotId,
      tagLine,
      profileIconId: user.profileIconId,
      level: user.summonerLevel,
      summonerId: user.summonerId,
      puuid: user.puuid,
      displayName: user.displayName,
      gameName: user.gameName
    };
  } catch (e:any) {
    console.warn('[lcu] getCurrentSummoner error', e?.message);
    return { error: e?.message || 'fetch-failed' };
  }
});
ipcMain.handle('lcu:getLobby', () => lcu.getLobby());
ipcMain.handle('lcu:getGameflowPhase', () => lcu.getGameflowPhase());
ipcMain.handle('lcu:getGameflowSession', () => lcu.getGameflowSession());
ipcMain.handle('lcu:getChampSelectSession', () => lcu.getChampSelectSession());
ipcMain.handle('lcu:getSummonerByPuuid', (_evt, puuid: string) => lcu.getSummonerByPuuid(puuid));
ipcMain.handle('lcu:getLiveGameData', () => (lcu as any).getLiveGameData?.());
ipcMain.handle('lcu:getLivePlayerList', () => (lcu as any).getLivePlayerList?.());

// Raw debug fetch of underlying endpoints
ipcMain.handle('lcu:debugRawUser', async () => {
  try { return await (lcu as any).debugRawUser(); } catch (e:any) { return { status: 'ERROR', error: e?.message }; }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    frame: false, // custom title bar
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (isDev) {
    const devUrl = 'http://localhost:5173';
    const tryLoad = (attempt = 0) => {
      fetch(devUrl, { method: 'HEAD' }).then(() => {
        win.loadURL(devUrl);
        win.webContents.openDevTools();
      }).catch(() => {
        if (attempt < 25) setTimeout(() => tryLoad(attempt + 1), 200);
        else win.loadURL(devUrl); // final attempt anyway
      });
    };
    tryLoad();
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  return win;
}

function setupAutoUpdater(win: BrowserWindow) {
  autoUpdater.autoDownload = false; // manual download trigger
  autoUpdater.on('error', (err: Error) => {
    console.error('[update] error', err);
    win.webContents.send('update:error', err?.message || String(err));
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[update] available', info.version);
    win.webContents.send('update:available', info);
  });
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log('[update] not-available', info.version);
    win.webContents.send('update:not-available', info);
  });
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    win.webContents.send('update:download-progress', p);
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log('[update] downloaded', info.version);
    win.webContents.send('update:downloaded', info);
  });
}

// Simple semver compare: returns -1 if a<b, 0 equal, 1 if a>b
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10));
  const pb = b.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0; const y = pb[i] || 0;
    if (x < y) return -1; if (x > y) return 1;
  }
  return 0;
}

app.whenReady().then(() => {
  const win = createWindow();
  setupAutoUpdater(win);
  setTimeout(() => { autoUpdater.checkForUpdates().catch((e: any) => console.error('initial check error', e)); }, 3000);

  ipcMain.handle('window:minimize', () => {
    win.minimize();
  });
  ipcMain.handle('window:maximize', () => {
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('window:close', () => {
    win.close();
  });

  ipcMain.handle('riot:search', async (_evt, raw: string) => {
    // Parse formats: "Name#TAG" or "Name #TAG" (allow extra spaces)
    const cleaned = (raw || '').trim();
  const match = cleaned.match(/^(.*?)[\s]*#[\s]*([A-Za-z0-9]{2,10})$/);
    if (!match) {
      return { ok: false, error: 'Format must be RiotID#TAG', input: raw };
    }
    const riotId = match[1].trim();
    const tagLine = match[2].trim();
  const functionsBase = (process.env.SUPABASE_FUNCTIONS_URL || embeddedSupabaseUrl || '').replace(/\/$/, '');
    if (!functionsBase) {
      return { ok: false, error: 'SUPABASE_FUNCTIONS_URL not configured. Cannot perform search.' };
    }
    const url = `${functionsBase}/riot-search?q=${encodeURIComponent(`${riotId}#${tagLine}`)}`;
    try {
      const headers: Record<string,string> = { 'Accept': 'application/json' };
      if (process.env.SUPABASE_ANON_KEY) headers['apikey'] = process.env.SUPABASE_ANON_KEY;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, error: `Edge function error (${res.status})`, details: text };
      }
      const json = await res.json();
      return json;
    } catch (err: any) {
      return { ok: false, error: 'Edge function fetch failed', details: err.message };
    }
  });

  // App version retrieval
  ipcMain.handle('app:getVersion', () => app.getVersion());
  // LCU handlers already registered above (avoid duplicate registration on hot reload)

  // Use electron-updater for unified update check
  ipcMain.handle('app:checkForUpdate', async () => {
    try {
      const r = await autoUpdater.checkForUpdates();
      if (!r) return { current: app.getVersion(), hasUpdate: false };
      const latest = r.updateInfo.version;
      const current = app.getVersion();
      const hasUpdate = compareSemver(current, latest) < 0;
      return { current, latest, hasUpdate, release: r.updateInfo };
    } catch (e: any) {
      // Fallback: parse Atom feed for latest tag if GitHub API returns 406 / parsing issue
      const msg = e?.message || '';
      if (/406/.test(msg) || /Unable to find latest version/i.test(msg)) {
        try {
          const feedRes = await fetch('https://github.com/johngibsondesign/ArenaBuddy/releases.atom', { headers: { 'Accept': 'application/atom+xml,application/xml' } });
          const xml = await feedRes.text();
          const m = xml.match(/<title>(v?\d+\.\d+\.\d+)<\/title>/); // first title after feed title is latest release
          if (m) {
            const latest = m[1].replace(/^v/, '');
            const current = app.getVersion();
            const hasUpdate = compareSemver(current, latest) < 0;
            return { current, latest, hasUpdate, fallback: true };
          }
        } catch (fe) {
          return { error: msg, fallbackError: (fe as any)?.message };
        }
      }
      return { error: msg || 'Update check failed' };
    }
  });
  ipcMain.handle('app:startUpdateDownload', async () => {
    try { await autoUpdater.downloadUpdate(); return { started: true }; } catch (e: any) { return { error: e.message || 'Download failed' }; }
  });
  ipcMain.handle('app:quitAndInstall', () => { autoUpdater.quitAndInstall(); return { quitting: true }; });


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
