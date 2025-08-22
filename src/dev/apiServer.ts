import express from 'express';
import cors from 'cors';
import 'dotenv/config';
// Ensure fetch exists (Node <18 fallback)
// @ts-ignore
if (typeof fetch === 'undefined') {
  // dynamic import to avoid bundling issues
  import('node-fetch').then(mod => {
    // @ts-ignore
    global.fetch = mod.default as any;
  });
}

const app = express();
app.use(cors());

const apiKey = process.env.RIOT_API_KEY;
const region = process.env.RIOT_REGION || 'europe';
const platform = process.env.RIOT_PLATFORM || 'euw1';

if (!apiKey) {
  console.warn('[dev-api] Missing RIOT_API_KEY; requests will fail.');
}

app.get('/api/riot/search', async (req, res) => {
  const raw = (req.query.q as string || '').trim();
  const match = raw.match(/^(.*?)[\s]*#[\s]*([A-Za-z0-9]{2,10})$/);
  if (!match) return res.status(400).json({ ok: false, error: 'Format must be RiotID#TAG' });
  const riotId = match[1].trim();
  const tagLine = match[2].trim();
  try {
    const accountBase = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotId)}/${encodeURIComponent(tagLine)}`;
    let accountRes = await fetch(accountBase, { headers: { 'X-Riot-Token': apiKey! } });
    if (accountRes.status === 401 || accountRes.status === 403) {
      accountRes = await fetch(`${accountBase}?api_key=${apiKey}`);
    }
    if (!accountRes.ok) {
      const text = await accountRes.text();
      return res.status(accountRes.status).json({ ok: false, stage: 'account', error: `Account lookup failed (${accountRes.status})`, details: text });
    }
    const accountData: any = await accountRes.json();
    if (!accountData?.puuid) return res.status(500).json({ ok: false, error: 'No PUUID in account response' });

    const summonerBase = `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${accountData.puuid}`;
    let summonerRes = await fetch(summonerBase, { headers: { 'X-Riot-Token': apiKey! } });
    if (summonerRes.status === 401 || summonerRes.status === 403) {
      summonerRes = await fetch(`${summonerBase}?api_key=${apiKey}`);
    }
    if (!summonerRes.ok) {
      const text = await summonerRes.text();
      return res.status(summonerRes.status).json({ ok: false, stage: 'summoner', error: `Summoner lookup failed (${summonerRes.status})`, details: text });
    }
    const summonerData: any = await summonerRes.json();
    res.json({
      ok: true,
      riotId,
      tagLine,
      summonerName: accountData.gameName || summonerData.name || riotId,
      profileIconId: summonerData.profileIconId,
      level: summonerData.summonerLevel
    });
  } catch (e: any) {
    console.error('[dev-api] exception', e);
    res.status(500).json({ ok: false, error: e.message || 'Server error' });
  }
});

const port = Number(process.env.DEV_API_PORT || 5174);
app.listen(port, () => {
  console.log(`[dev-api] listening on :${port}`);
});
