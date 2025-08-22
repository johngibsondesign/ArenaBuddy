import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { LcuAuth, LcuUser, LcuStatus, InternalAuth } from './types';

// Simple event emitter
type Handler = () => void;
const handlers: Record<'up' | 'down' | 'change', Set<Handler>> = {
  up: new Set(), down: new Set(), change: new Set()
};

let status: LcuStatus = 'DOWN';
let currentAuth: InternalAuth | null = null;
let disposed = false;
let backoffMs = 500;
const MAX_BACKOFF = 5000;
const WATCH_DEBOUNCE = 150;
let pollTimer: NodeJS.Timeout | null = null;
const watchers: fs.FSWatcher[] = [];
let loggedCandidateExistence = false;

function emit(ev: 'up' | 'down' | 'change') {
  handlers[ev].forEach(fn => { try { fn(); } catch {/* ignore */} });
}

export function getStatus(): LcuStatus { return status; }

export function on(event: 'up' | 'down' | 'change', handler: Handler): () => void {
  handlers[event].add(handler);
  return () => handlers[event].delete(handler);
}

function expand(p: string): string {
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  // Basic env var expansion for %VAR% (Windows style) and $VAR
  p = p.replace(/%([^%]+)%/g, (_, n) => process.env[n] || '')
       .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => process.env[n] || '');
  return path.normalize(p);
}

// Build a list of candidate lockfile locations. We keep it lightweight (no full recursive scans)
// but broaden coverage for multi-drive installs & user overrides.
// Optional override: set ARENA_LOCKFILE_PATHS as a comma or semicolon separated list of absolute paths to lockfile.
let loggedCandidateSet = false;
let yamlDerivedPaths: string[] | null = null;

function discoverFromRiotYaml(localAppData: string | undefined) {
  if (yamlDerivedPaths !== null) return yamlDerivedPaths; // already attempted
  yamlDerivedPaths = [];
  if (!localAppData) return yamlDerivedPaths;
  if (process.env.ARENA_DISABLE_RIOT_YAML === '1') return yamlDerivedPaths;
  try {
    const yamlPath = path.join(localAppData, 'Riot Games', 'Riot Client', 'Config', 'RiotClientSettings.yaml');
    if (!fs.existsSync(yamlPath)) return yamlDerivedPaths;
    const raw = fs.readFileSync(yamlPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const pathRegex = /:\s*["']?([^"'#]+League[^"'#]+?)["']?\s*(?:#.*)?$/i;
    for (const line of lines) {
      const m = line.match(pathRegex);
      if (m) {
        const candidateDir = m[1].trim();
        let dir = candidateDir.replace(/\\/g, '/');
        if (/LeagueClient\.exe$/i.test(dir)) dir = path.dirname(dir);
        if (/lockfile$/i.test(dir)) {
          yamlDerivedPaths.push(dir);
        } else {
          yamlDerivedPaths.push(path.join(dir, 'lockfile'));
        }
      }
    }
    yamlDerivedPaths = Array.from(new Set(yamlDerivedPaths.map(expand)));
    if (yamlDerivedPaths.length) {
      try { console.log('[lcu] RiotClientSettings.yaml derived paths', yamlDerivedPaths); } catch {}
    }
  } catch (e) {
    try { console.warn('[lcu] failed parsing RiotClientSettings.yaml', (e as any)?.message); } catch {}
  }
  return yamlDerivedPaths;
}
function candidatePaths(): string[] {
  const custom = (process.env.ARENA_LOCKFILE_PATHS || '')
    .split(/;|,/)
    .map(s => s.trim())
    .filter(Boolean);
  let list: string[] = [];
  if (process.platform === 'win32') {
    const driveLetters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const rootVariants: string[] = [];
    for (const d of driveLetters) rootVariants.push(`${d}:/Riot Games/League of Legends/lockfile`);
    const programFiles = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)']].filter(Boolean) as string[];
    const pfVariants = programFiles.flatMap(pf => [
      path.join(pf, 'Riot Games', 'League of Legends', 'lockfile'),
      path.join(pf, 'League of Legends', 'lockfile')
    ]);
    const localAppData = process.env['LOCALAPPDATA'] || '';
    const riotClientConfig = path.join(localAppData, 'Riot Games', 'Riot Client', 'Config', 'lockfile');
    const yamlPaths = discoverFromRiotYaml(localAppData);
    list = [riotClientConfig, ...rootVariants, ...pfVariants, ...yamlPaths];
  } else if (process.platform === 'darwin') {
    list = [
      '~/Library/Application Support/League of Legends/lockfile',
      '~/Library/Application Support/Riot Games/Riot Client/Config/lockfile'
    ];
  } else {
    list = [
      '~/.local/share/League of Legends/lockfile',
      '~/.wine/drive_c/Riot Games/League of Legends/lockfile'
    ];
  }
  const finalList = [...custom, ...list].map(expand);
  if (!loggedCandidateSet) {
    loggedCandidateSet = true;
    try { console.log('[lcu] candidate lockfile paths', finalList); } catch {}
  }
  return finalList;
}

async function readLockfile(p: string): Promise<InternalAuth | null> {
  try {
    const raw = (await fs.promises.readFile(p, 'utf8')).trim();
    if (!raw) return null;
    const parts = raw.split(':');
    if (parts.length < 5) return null;
    const port = parseInt(parts[2], 10);
    const password = parts[3];
    const protocol = (parts[4] as 'https' | 'http');
    if (!port || !password || (protocol !== 'https' && protocol !== 'http')) return null;
  return { port, password, protocol, pid: parseInt(parts[1],10), name: path.basename(p) };
  } catch { return null; }
}

let lastLockfilePath: string | null = null;
let watchDebounce: NodeJS.Timeout | null = null;

async function scan() {
  if (disposed) return;
  let candidates = candidatePaths();
  // Prefer direct League of Legends install lockfile over Riot Client Config version
  candidates = candidates.sort((a,b) => {
    const aIsLeague = /League of Legends/i.test(a);
    const bIsLeague = /League of Legends/i.test(b);
    if (aIsLeague && !bIsLeague) return -1;
    if (!aIsLeague && bIsLeague) return 1;
    return a.localeCompare(b);
  });
  if (!loggedCandidateExistence) {
    loggedCandidateExistence = true;
    try { console.log('[lcu] candidate existence snapshot', candidates.map(p => ({ p, exists: fs.existsSync(p) }))); } catch {}
  }
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const auth = await readLockfile(p);
    if (auth) {
      const changed = !currentAuth || auth.port !== currentAuth.port || auth.password !== currentAuth.password || auth.protocol !== currentAuth.protocol;
      currentAuth = auth;
      lastLockfilePath = p;
      if (status === 'DOWN') { status = 'UP'; try { console.log('[lcu] lockfile detected at', p, 'port', auth.port); } catch {}; emit('up'); }
      else if (changed) { try { console.log('[lcu] lockfile changed'); } catch {}; emit('change'); }
      backoffMs = 500;
      schedulePoll();
      return;
    }
  }
  if (status === 'UP') { status = 'DOWN'; currentAuth = null; emit('down'); }
  schedulePoll();
}

function schedulePoll() {
  if (disposed) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(scan, status === 'DOWN' ? 1000 : 2000);
}

function setupWatchers() {
  const dirs = Array.from(new Set(candidatePaths().map(p => path.dirname(p))));
  dirs.forEach(dir => {
    try {
      if (!fs.existsSync(dir)) return;
      const w = fs.watch(dir, () => {
        if (watchDebounce) clearTimeout(watchDebounce);
        watchDebounce = setTimeout(() => { scan().catch(()=>{}); }, WATCH_DEBOUNCE);
      });
      watchers.push(w);
    } catch {}
  });
}

function buildAgent() { return new https.Agent({ rejectUnauthorized: false }); }

async function lcuRequest<T>(auth: LcuAuth, pathname: string, timeoutMs = 2500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ctrl = new AbortController();
    const to = setTimeout(() => { ctrl.abort(); reject(new Error(`Timed out calling ${pathname}`)); }, timeoutMs);
    const req = https.request({
      host: '127.0.0.1',
      port: auth.port,
      path: pathname,
      method: 'GET',
      rejectUnauthorized: false,
      headers: { 'Authorization': 'Basic ' + Buffer.from(`riot:${auth.password}`).toString('base64') },
      signal: ctrl.signal,
      agent: buildAgent()
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        clearTimeout(to);
        if (res.statusCode && res.statusCode >= 400) {
          if (res.statusCode === 401 || res.statusCode === 403) return reject(new Error(`Auth not ready (${res.statusCode})`));
          return reject(new Error(`LCU ${res.statusCode} ${pathname}`));
        }
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Parse error for ${pathname}`)); }
      });
    });
    req.on('error', err => { clearTimeout(to); reject(err); });
    req.end();
  });
}

export async function getCurrentUser(opts?: { timeoutMs?: number }): Promise<LcuUser> {
  if (status === 'DOWN' || !currentAuth) throw new Error('LCU down');
  const timeoutMs = opts?.timeoutMs ?? 2500;
  let summoner: any;
  try {
    summoner = await lcuRequest(currentAuth, '/lol-summoner/v1/current-summoner', timeoutMs);
  } catch (e: any) {
    if (/LCU 404 \/lol-summoner/.test(e.message || '')) {
      // Possibly connected to Riot Client lockfile not the League game client; attempt fallback search
      try { console.warn('[lcu] 404 from current lockfile; attempting fallback to other candidates'); } catch {}
      const triedPort = currentAuth.port;
      // Force scan of candidates now
      const cands = candidatePaths().filter(p => /League of Legends/i.test(p));
      for (const p of cands) {
        if (!fs.existsSync(p)) continue;
        const altAuth = await readLockfile(p);
        if (!altAuth || altAuth.port === triedPort) continue;
        try {
          const testSummoner = await lcuRequest(altAuth, '/lol-summoner/v1/current-summoner', timeoutMs);
          // Switch
          currentAuth = altAuth;
          lastLockfilePath = p;
          summoner = testSummoner;
          try { console.log('[lcu] switched to alt lockfile', p, 'port', altAuth.port); } catch {}
          break;
        } catch { /* ignore and continue */ }
      }
      if (!summoner) throw e; // rethrow if no alternative worked
    } else {
      throw e;
    }
  }
  let chat: any = null; try { chat = await lcuRequest(currentAuth, '/lol-chat/v1/me', timeoutMs); } catch {}
  const resolvedGameName = chat?.gameName ?? summoner?.gameName ?? summoner?.displayName ?? summoner?.name ?? summoner?.internalName ?? undefined;
  const resolvedDisplayName = summoner?.displayName ?? summoner?.gameName ?? summoner?.name ?? summoner?.internalName ?? resolvedGameName ?? 'Unknown';
  const resolvedTag = chat?.tagLine ?? summoner?.tagLine ?? '';
  const user: LcuUser = { summonerId: summoner?.summonerId, puuid: summoner?.puuid, displayName: resolvedDisplayName, gameName: resolvedGameName, tagLine: resolvedTag, profileIconId: summoner?.profileIconId, summonerLevel: summoner?.summonerLevel };
  if (!user.gameName && !user.displayName) console.warn('[lcu] unresolved user names – raw summoner/chat:', { summoner, chat });
  return user;
}

export async function debugRawUser(): Promise<{ status: LcuStatus; lockfile?: string; summoner?: any; chat?: any; error?: string; }>{
  if (status === 'DOWN' || !currentAuth) return { status: 'DOWN' };
  try {
    const summoner = await lcuRequest(currentAuth, '/lol-summoner/v1/current-summoner', 2000);
    let chat: any = null; try { chat = await lcuRequest(currentAuth, '/lol-chat/v1/me', 1500); } catch (e:any) { chat = { error: e?.message }; }
    return { status, lockfile: lastLockfilePath || undefined, summoner, chat };
  } catch (e:any) {
    return { status, lockfile: lastLockfilePath || undefined, error: e?.message || String(e) };
  }
}

// Generic JSON GET helper for external endpoints (returns null on failure)
async function tryGet(pathname: string, timeoutMs = 2000): Promise<any|null> {
  try {
    if (status === 'DOWN' || !currentAuth) return null;
    return await lcuRequest(currentAuth, pathname, timeoutMs);
  } catch { return null; }
}

export async function getLobby(): Promise<any|null> { return tryGet('/lol-lobby/v2/lobby'); }
export async function getGameflowPhase(): Promise<string|null> { return tryGet('/lol-gameflow/v1/gameflow-phase'); }
export async function getGameflowSession(): Promise<any|null> { return tryGet('/lol-gameflow/v1/session'); }
export async function getChampSelectSession(): Promise<any|null> { return tryGet('/lol-champ-select/v1/session'); }

export function dispose() {
  disposed = true;
  if (pollTimer) clearTimeout(pollTimer);
  watchers.forEach(w => { try { w.close(); } catch {} });
  handlers.up.clear(); handlers.down.clear(); handlers.change.clear();
}

setupWatchers();
scan().catch(()=>{});
