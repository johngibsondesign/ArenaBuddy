import { app, BrowserWindow, ipcMain } from 'electron';
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

app.whenReady().then(() => {
  const win = createWindow();

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
