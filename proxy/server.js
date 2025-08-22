// Minimal Riot proxy (Express) to keep API key off clients.
// Deploy this separately (Render, Fly.io, Railway, Cloudflare Workers (rewrite), etc.)
// Expects env: RIOT_API_KEY, RIOT_REGION (americas|europe|asia|sea), RIOT_PLATFORM (euw1, na1, etc.)

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());

const API_KEY = process.env.RIOT_API_KEY;
const REGION = process.env.RIOT_REGION || 'europe';
const PLATFORM = process.env.RIOT_PLATFORM || 'euw1';

if (!API_KEY) {
  console.error('RIOT_API_KEY missing');
  process.exit(1);
}

function sanitizeKey(k) { return k ? k.slice(0,5) + '…' + k.slice(-4) : ''; }

app.get('/health', (_req,res)=>res.json({ ok:true, region: REGION, platform: PLATFORM }));

app.get('/riot/search', async (req,res) => {
  const q = (req.query.q||'').toString().trim();
  const m = q.match(/^(.*?)[\s]*#[\s]*([A-Za-z0-9]{2,10})$/);
  if (!m) return res.status(400).json({ ok:false, error:'Format must be RiotID#TAG' });
  const riotId = m[1].trim();
  const tag = m[2].trim();
  try {
    const accountUrl = `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotId)}/${encodeURIComponent(tag)}`;
    let accountRes = await fetch(accountUrl, { headers: { 'X-Riot-Token': API_KEY } });
    if (accountRes.status === 401 || accountRes.status === 403) {
      accountRes = await fetch(accountUrl + `?api_key=${API_KEY}`);
    }
    if (!accountRes.ok) {
      const text = await accountRes.text();
      return res.status(accountRes.status).json({ ok:false, stage:'account', error:`Account lookup failed (${accountRes.status})`, details:text });
    }
    const accountData = await accountRes.json();
    if (!accountData.puuid) return res.status(500).json({ ok:false, error:'No PUUID' });
    const summonerUrl = `https://${PLATFORM}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${accountData.puuid}`;
    let sumRes = await fetch(summonerUrl, { headers: { 'X-Riot-Token': API_KEY } });
    if (sumRes.status === 401 || sumRes.status === 403) {
      sumRes = await fetch(summonerUrl + `?api_key=${API_KEY}`);
    }
    if (!sumRes.ok) {
      const text = await sumRes.text();
      return res.status(sumRes.status).json({ ok:false, stage:'summoner', error:`Summoner lookup failed (${sumRes.status})`, details:text });
    }
    const summonerData = await sumRes.json();
    return res.json({ ok:true, riotId, tagLine: tag, summonerName: accountData.gameName || summonerData.name || riotId, profileIconId: summonerData.profileIconId, level: summonerData.summonerLevel });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'Proxy exception', details: e.message });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log('[riot-proxy] listening', { port, region: REGION, platform: PLATFORM, key: sanitizeKey(API_KEY) }));
