"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatus = getStatus;
exports.on = on;
exports.getCurrentUser = getCurrentUser;
exports.debugRawUser = debugRawUser;
exports.dispose = dispose;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const node_https_1 = __importDefault(require("node:https"));
const handlers = {
    up: new Set(), down: new Set(), change: new Set()
};
let status = 'DOWN';
let currentAuth = null;
let disposed = false;
let backoffMs = 500;
const MAX_BACKOFF = 5000;
const WATCH_DEBOUNCE = 150;
let pollTimer = null;
const watchers = [];
let loggedCandidateExistence = false;
function emit(ev) {
    handlers[ev].forEach(fn => { try {
        fn();
    }
    catch { /* ignore */ } });
}
function getStatus() { return status; }
function on(event, handler) {
    handlers[event].add(handler);
    return () => handlers[event].delete(handler);
}
function expand(p) {
    if (p.startsWith('~'))
        p = node_path_1.default.join(node_os_1.default.homedir(), p.slice(1));
    // Basic env var expansion for %VAR% (Windows style) and $VAR
    p = p.replace(/%([^%]+)%/g, (_, n) => process.env[n] || '')
        .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) => process.env[n] || '');
    return node_path_1.default.normalize(p);
}
// Build a list of candidate lockfile locations. We keep it lightweight (no full recursive scans)
// but broaden coverage for multi-drive installs & user overrides.
// Optional override: set ARENA_LOCKFILE_PATHS as a comma or semicolon separated list of absolute paths to lockfile.
let loggedCandidateSet = false;
let yamlDerivedPaths = null;
function discoverFromRiotYaml(localAppData) {
    if (yamlDerivedPaths !== null)
        return yamlDerivedPaths; // already attempted
    yamlDerivedPaths = [];
    if (!localAppData)
        return yamlDerivedPaths;
    if (process.env.ARENA_DISABLE_RIOT_YAML === '1')
        return yamlDerivedPaths;
    try {
        const yamlPath = node_path_1.default.join(localAppData, 'Riot Games', 'Riot Client', 'Config', 'RiotClientSettings.yaml');
        if (!node_fs_1.default.existsSync(yamlPath))
            return yamlDerivedPaths;
        const raw = node_fs_1.default.readFileSync(yamlPath, 'utf8');
        // Very lightweight parsing: look for lines like key: value (value containing League or LeagueClient)
        const lines = raw.split(/\r?\n/);
        const pathRegex = /:\s*["']?([^"'#]+League[^"'#]+?)["']?\s*(?:#.*)?$/i; // capture path segment containing 'League'
        for (const line of lines) {
            const m = line.match(pathRegex);
            if (m) {
                const candidateDir = m[1].trim();
                // Normalize slashes & trim executable if present
                let dir = candidateDir.replace(/\\/g, '/');
                if (/LeagueClient\.exe$/i.test(dir))
                    dir = node_path_1.default.dirname(dir);
                if (/lockfile$/i.test(dir)) {
                    yamlDerivedPaths.push(dir);
                }
                else {
                    yamlDerivedPaths.push(node_path_1.default.join(dir, 'lockfile'));
                }
            }
        }
        // De-duplicate
        yamlDerivedPaths = Array.from(new Set(yamlDerivedPaths.map(expand)));
        if (yamlDerivedPaths.length) {
            try {
                console.log('[lcu] RiotClientSettings.yaml derived paths', yamlDerivedPaths);
            }
            catch { }
        }
    }
    catch (e) {
        try {
            console.warn('[lcu] failed parsing RiotClientSettings.yaml', e?.message);
        }
        catch { }
    }
    return yamlDerivedPaths;
}
function candidatePaths() {
    const custom = (process.env.ARENA_LOCKFILE_PATHS || '')
        .split(/;|,/)
        .map(s => s.trim())
        .filter(Boolean);
    let list = [];
    if (process.platform === 'win32') {
        const driveLetters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
        const rootVariants = [];
        for (const d of driveLetters) {
            rootVariants.push(`${d}:/Riot Games/League of Legends/lockfile`);
        }
        const programFiles = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)']].filter(Boolean);
        const pfVariants = programFiles.flatMap(pf => [
            node_path_1.default.join(pf, 'Riot Games', 'League of Legends', 'lockfile'),
            node_path_1.default.join(pf, 'League of Legends', 'lockfile')
        ]);
        const localAppData = process.env['LOCALAPPDATA'] || '';
        const riotClientConfig = node_path_1.default.join(localAppData, 'Riot Games', 'Riot Client', 'Config', 'lockfile');
        const yamlPaths = discoverFromRiotYaml(localAppData);
        list = [riotClientConfig, ...rootVariants, ...pfVariants, ...yamlPaths];
    }
    else if (process.platform === 'darwin') {
        list = [
            '~/Library/Application Support/League of Legends/lockfile',
            '~/Library/Application Support/Riot Games/Riot Client/Config/lockfile'
        ];
    }
    else { // linux / proton
        list = [
            '~/.local/share/League of Legends/lockfile',
            '~/.wine/drive_c/Riot Games/League of Legends/lockfile'
        ];
    }
    const finalList = [...custom, ...list].map(expand);
    if (!loggedCandidateSet) {
        loggedCandidateSet = true;
        try {
            console.log('[lcu] candidate lockfile paths', finalList);
        }
        catch { }
    }
    return finalList;
}
async function readLockfile(p) {
    try {
        const raw = (await node_fs_1.default.promises.readFile(p, 'utf8')).trim();
        if (!raw)
            return null; // half-written
        const parts = raw.split(':');
        if (parts.length < 5)
            return null;
        const port = parseInt(parts[2], 10);
        const password = parts[3];
        const protocol = parts[4];
        if (!port || !password || (protocol !== 'https' && protocol !== 'http'))
            return null;
        return { port, password, protocol, pid: parseInt(parts[1], 10) };
    }
    catch {
        return null;
    }
}
let lastLockfilePath = null;
let watchDebounce = null;
async function scan() {
    if (disposed)
        return;
    const candidates = candidatePaths();
    if (!loggedCandidateExistence) {
        loggedCandidateExistence = true;
        try {
            const existence = candidates.map(p => ({ p, exists: node_fs_1.default.existsSync(p) }));
            console.log('[lcu] candidate existence snapshot', existence);
        }
        catch { }
    }
    for (const p of candidates) {
        if (!node_fs_1.default.existsSync(p))
            continue;
        const auth = await readLockfile(p);
        if (auth) {
            const changed = !currentAuth || auth.port !== currentAuth.port || auth.password !== currentAuth.password || auth.protocol !== currentAuth.protocol;
            currentAuth = auth;
            lastLockfilePath = p;
            if (status === 'DOWN') {
                status = 'UP';
                try {
                    console.log('[lcu] lockfile detected at', p, 'port', auth.port);
                }
                catch { }
                emit('up');
            }
            else if (changed) {
                try {
                    console.log('[lcu] lockfile changed (port/password/protocol)');
                }
                catch { }
                emit('change');
            }
            backoffMs = 500; // reset backoff after success
            schedulePoll();
            return;
        }
    }
    // not found
    if (status === 'UP') {
        status = 'DOWN';
        currentAuth = null;
        emit('down');
    }
    schedulePoll();
}
function schedulePoll() {
    if (disposed)
        return;
    if (pollTimer)
        clearTimeout(pollTimer);
    pollTimer = setTimeout(scan, status === 'DOWN' ? 1000 : 2000);
}
function setupWatchers() {
    // Watch parent dirs so new lockfile creation triggers
    const dirs = Array.from(new Set(candidatePaths().map(p => node_path_1.default.dirname(p))));
    dirs.forEach(dir => {
        try {
            if (!node_fs_1.default.existsSync(dir))
                return;
            const w = node_fs_1.default.watch(dir, () => {
                if (watchDebounce)
                    clearTimeout(watchDebounce);
                watchDebounce = setTimeout(() => { scan().catch(() => { }); }, WATCH_DEBOUNCE);
            });
            watchers.push(w);
        }
        catch { /* ignore */ }
    });
}
// HTTP helper
function buildAgent() {
    return new node_https_1.default.Agent({ rejectUnauthorized: false });
}
async function lcuRequest(auth, pathname, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
        const ctrl = new AbortController();
        const to = setTimeout(() => { ctrl.abort(); reject(new Error(`Timed out calling ${pathname}`)); }, timeoutMs);
        const req = node_https_1.default.request({
            host: '127.0.0.1',
            port: auth.port,
            path: pathname,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`riot:${auth.password}`).toString('base64')
            },
            signal: ctrl.signal,
            agent: buildAgent()
        }, res => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                clearTimeout(to);
                if (res.statusCode && res.statusCode >= 400) {
                    if (res.statusCode === 401 || res.statusCode === 403) {
                        return reject(new Error(`Auth not ready (${res.statusCode})`));
                    }
                    return reject(new Error(`LCU ${res.statusCode} ${pathname}`));
                }
                try {
                    resolve(JSON.parse(data));
                }
                catch (e) {
                    reject(new Error(`Parse error for ${pathname}`));
                }
            });
        });
        req.on('error', err => { clearTimeout(to); reject(err); });
        req.end();
    });
}
async function getCurrentUser(opts) {
    if (status === 'DOWN' || !currentAuth)
        throw new Error('LCU down');
    const timeoutMs = opts?.timeoutMs ?? 2500;
    // First summoner info
    const summoner = await lcuRequest(currentAuth, '/lol-summoner/v1/current-summoner', timeoutMs);
    // Chat info (may fail if not fully logged in)
    let chat = null;
    try {
        chat = await lcuRequest(currentAuth, '/lol-chat/v1/me', timeoutMs);
    }
    catch { /* ignore */ }
    // Robust fallback resolution for various field naming differences / readiness states
    const resolvedGameName = chat?.gameName
        ?? summoner?.gameName
        ?? summoner?.displayName
        ?? summoner?.name
        ?? summoner?.internalName
        ?? undefined;
    const resolvedDisplayName = summoner?.displayName
        ?? summoner?.gameName
        ?? summoner?.name
        ?? summoner?.internalName
        ?? resolvedGameName
        ?? 'Unknown';
    const resolvedTag = chat?.tagLine
        ?? summoner?.tagLine
        ?? '';
    const user = {
        summonerId: summoner?.summonerId,
        puuid: summoner?.puuid,
        displayName: resolvedDisplayName,
        gameName: resolvedGameName,
        tagLine: resolvedTag,
        profileIconId: summoner?.profileIconId,
        summonerLevel: summoner?.summonerLevel
    };
    if (!user.gameName && !user.displayName) {
        // eslint-disable-next-line no-console
        console.warn('[lcu] unresolved user names – raw summoner/chat:', { summoner, chat });
    }
    return user;
}
// Debug helper: expose raw JSON for UI troubleshooting
async function debugRawUser() {
    if (status === 'DOWN' || !currentAuth)
        return { status: 'DOWN' };
    try {
        const summoner = await lcuRequest(currentAuth, '/lol-summoner/v1/current-summoner', 2000);
        let chat = null;
        try {
            chat = await lcuRequest(currentAuth, '/lol-chat/v1/me', 1500);
        }
        catch (e) {
            chat = { error: e?.message };
        }
        return { status, lockfile: lastLockfilePath || undefined, summoner, chat };
    }
    catch (e) {
        return { status, lockfile: lastLockfilePath || undefined, error: e?.message || String(e) };
    }
}
function dispose() {
    disposed = true;
    if (pollTimer)
        clearTimeout(pollTimer);
    watchers.forEach(w => { try {
        w.close();
    }
    catch { } });
    handlers.up.clear();
    handlers.down.clear();
    handlers.change.clear();
}
// Initialize immediately
setupWatchers();
scan().catch(() => { });
