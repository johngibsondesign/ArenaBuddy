// @ts-nocheck
// Supabase Edge Function: riot-search
// Deploy with: supabase functions deploy riot-search --no-verify-jwt
// Environment variables required (set in Supabase project settings):
//   RIOT_API_KEY - your Riot API key (never expose to clients)
//   RIOT_REGION  - regional routing domain (europe | americas | asia | sea)
//   RIOT_PLATFORM - platform shard (euw1, na1, etc.)
// Optional: LOG_LEVEL=debug to enable verbose logs.

// This file runs in Deno. Use global fetch & Deno.serve.

interface SummonerResponse {
  ok: boolean;
  error?: string;
  details?: string;
  riotId?: string;
  tagLine?: string;
  summonerName?: string;
  profileIconId?: number;
  level?: number;
}

function json(body: any, init: number | ResponseInit = 200) {
  const status = typeof init === 'number' ? init : (init as ResponseInit).status || 200;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': '*'
    }
  });
}

const API_KEY = Deno.env.get('RIOT_API_KEY') || '';
const REGION = Deno.env.get('RIOT_REGION') || 'europe';
const PLATFORM = Deno.env.get('RIOT_PLATFORM') || 'euw1';
const LOG_LEVEL = Deno.env.get('LOG_LEVEL') || 'info';

function log(...args: any[]) { if (LOG_LEVEL === 'debug') console.log('[riot-search]', ...args); }

if (!API_KEY) {
  console.warn('[riot-search] RIOT_API_KEY missing – all requests will fail');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({}, 200);
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const match = q.match(/^(.*?)[\s]*#[\s]*([A-Za-z0-9]{2,10})$/);
  if (!match) return json({ ok: false, error: 'Format must be RiotID#TAG' }, 400);
  const riotId = match[1].trim();
  const tag = match[2].trim();
  if (!API_KEY) return json({ ok: false, error: 'Server misconfigured: missing RIOT_API_KEY' }, 500);
  try {
    const accountUrl = `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotId)}/${encodeURIComponent(tag)}`;
    log('account fetch', accountUrl);
    let accountRes = await fetch(accountUrl, { headers: { 'X-Riot-Token': API_KEY } });
    if (accountRes.status === 401 || accountRes.status === 403) accountRes = await fetch(accountUrl + `?api_key=${API_KEY}`);
    if (!accountRes.ok) {
      const text = await accountRes.text();
      return json({ ok: false, stage: 'account', error: `Account lookup failed (${accountRes.status})`, details: text }, accountRes.status);
    }
    const accountData: any = await accountRes.json();
    if (!accountData?.puuid) return json({ ok: false, error: 'No PUUID in account response' }, 500);

    const summonerUrl = `https://${PLATFORM}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${accountData.puuid}`;
    log('summoner fetch', summonerUrl);
    let sumRes = await fetch(summonerUrl, { headers: { 'X-Riot-Token': API_KEY } });
    if (sumRes.status === 401 || sumRes.status === 403) sumRes = await fetch(summonerUrl + `?api_key=${API_KEY}`);
    if (!sumRes.ok) {
      const text = await sumRes.text();
      return json({ ok: false, stage: 'summoner', error: `Summoner lookup failed (${sumRes.status})`, details: text }, sumRes.status);
    }
    const summonerData: any = await sumRes.json();

    const out: SummonerResponse = {
      ok: true,
      riotId,
      tagLine: tag,
      summonerName: accountData.gameName || summonerData.name || riotId,
      profileIconId: summonerData.profileIconId,
      level: summonerData.summonerLevel
    };
    return json(out, 200);
  } catch (e: any) {
    console.error('[riot-search] exception', e);
    return json({ ok: false, error: 'Edge function exception', details: e.message }, 500);
  }
});
