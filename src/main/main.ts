import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import 'dotenv/config';
import path from 'node:path';

const isDev = process.env.NODE_ENV === 'development';

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
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
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
  const apiKey = process.env.RIOT_API_KEY;
    if (!apiKey) {
      return { ok: false, error: 'Missing RIOT_API_KEY in .env' };
    }
  const region = process.env.RIOT_REGION || 'americas';
  const platform = process.env.RIOT_PLATFORM || 'na1';
  // Safe debug log (does not output full key)
  const safeKey = apiKey ? `${apiKey.slice(0,5)}…${apiKey.slice(-4)}` : null;
  console.log('[riot:search] env config', { apiKey: safeKey, region, platform });
    try {
      console.log('[riot:search] incoming', { riotId, tagLine, region, platform });
      const accountBase = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotId)}/${encodeURIComponent(tagLine)}`;
      let accountRes = await fetch(accountBase, { headers: { 'X-Riot-Token': apiKey } });
      if (accountRes.status === 403 || accountRes.status === 401) {
        // retry with query param style key
        const retryUrl = `${accountBase}?api_key=${apiKey}`;
        console.warn('[riot:search] retrying account lookup with query param');
        accountRes = await fetch(retryUrl);
      }
      if (!accountRes.ok) {
        const text = await accountRes.text();
        console.warn('[riot:search] account lookup failed', accountRes.status, text);
        return { ok: false, stage: 'account', error: `Account lookup failed (${accountRes.status})`, details: text };
      }
      const accountData: any = await accountRes.json();
      if (!accountData?.puuid) {
        return { ok: false, error: 'No PUUID in account response', details: JSON.stringify(accountData).slice(0,400) };
      }
      const summonerBase = `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${accountData.puuid}`;
      let summonerRes = await fetch(summonerBase, { headers: { 'X-Riot-Token': apiKey } });
      if (summonerRes.status === 403 || summonerRes.status === 401) {
        const retrySum = `${summonerBase}?api_key=${apiKey}`;
        console.warn('[riot:search] retrying summoner lookup with query param');
        summonerRes = await fetch(retrySum);
      }
      if (!summonerRes.ok) {
        const text = await summonerRes.text();
        console.warn('[riot:search] summoner lookup failed', summonerRes.status, text);
        return { ok: false, stage: 'summoner', error: `Summoner lookup failed (${summonerRes.status})`, details: text };
      }
      const summonerData: any = await summonerRes.json();
      return {
        ok: true,
        riotId,
        tagLine,
        summonerName: accountData.gameName || summonerData.name || riotId,
        profileIconId: summonerData.profileIconId,
        level: summonerData.summonerLevel,
      };
    } catch (err: any) {
      console.error('[riot:search] exception', err);
      return { ok: false, error: err.message || 'Request error' };
    }
  });

  // App version retrieval
  ipcMain.handle('app:getVersion', () => app.getVersion());

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
      return { error: e.message || 'Update check failed' };
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
