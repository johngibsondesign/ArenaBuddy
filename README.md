## ArenaBuddy

Electron + React + Tailwind desktop app with Riot summoner & champion lookup via a secure Supabase Edge Function.

### Architecture
- Electron main process exposes IPC (riot:search) that calls your deployed Supabase Edge Function instead of embedding the Riot API key.
- Renderer (React) requests summoner data through IPC; champions & assets come directly from Data Dragon.
- Auto‑updates handled by electron-updater + GitHub Releases.

### Supabase Edge Function (riot-search)
Location: `supabase/functions/riot-search/index.ts`

Environment variables (set in Supabase Project Settings → Functions → Environment Variables):
- `RIOT_API_KEY` (required)
- `RIOT_REGION` (e.g. europe | americas | asia | sea) – default: europe
- `RIOT_PLATFORM` (e.g. euw1, na1, etc.) – default: euw1
- Optional: `LOG_LEVEL=debug`

Deploy:
```
supabase functions deploy riot-search --no-verify-jwt
```

Copy the Functions URL (looks like: `https://<project>.functions.supabase.co`) and add it to your GitHub repository secrets as `SUPABASE_FUNCTIONS_URL`.

### GitHub Workflow
The release workflow uses the secret `GH_TOKEN` (PAT with `public_repo` or appropriate scopes) and `SUPABASE_FUNCTIONS_URL` only. The Riot key lives exclusively in Supabase.

At build time the value of `SUPABASE_FUNCTIONS_URL` is embedded into a generated file (`src/main/generatedConfig.ts`) so the packaged app still knows the endpoint even though runtime environment variables are not present on end-user machines.

### Local Development
Create a local `.env` with:
```
SUPABASE_FUNCTIONS_URL=https://<project>.functions.supabase.co
```
All summoner lookups go through the remote Supabase function even in dev. The previous local Express dev proxy has been removed.

### Environment Example
See `.env.example` for variables.

### Error Handling & Retry
Profile lookups include exponential backoff (up to 3 attempts) for transient network / function errors and a manual Retry button.

### Removing Obsolete Artifacts
Legacy key embedding & proxy code were removed (`scripts/embed-riot-key.js`, `proxy/server.js`).

### Future Ideas
- Cache function responses (KV / Deno durable object)
- Add ranked stats, match history
- Improved champion detail (abilities, stats)

### Voice / Signaling Production Checklist

1. Supabase Project:
	- Create project, copy Project URL and anon public key.
	- Deploy the `riot-search` function with your Riot API key in Supabase environment variables.
	- (Optional) Enable Realtime logs to monitor channel usage.
2. GitHub Secrets (for build + auto-update):
	- `SUPABASE_FUNCTIONS_URL`
	- `VITE_SUPABASE_URL`
	- `VITE_SUPABASE_ANON_KEY`
	- Optionally TURN credentials: `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`.
3. TURN Server (recommended for NAT traversal):
	- Quick test (temporary) using a managed service (e.g. Twilio/Numb Cloud STUN/TURN). For full control:
	  - Install coturn on a public VM (Ubuntu example):
		 ```bash
		 sudo apt update && sudo apt install coturn -y
		 sudo sed -i 's/#TURNSERVER_ENABLED=0/TURNSERVER_ENABLED=1/' /etc/default/coturn
		 cat <<EOF | sudo tee /etc/turnserver.conf
		 listening-port=3478
		 fingerprint
		 realm=yourdomain.com
		 total-quota=100
		 bps-capacity=0
		 stale-nonce
		 no-loopback-peers
		 no-multicast-peers
		 no-cli
		 # Static auth user
		 user=turnuser:turnpassword
		 # Recommended security
		 no-tlsv1
		 no-tlsv1_1
		 # (Add certificates + listening on TLS port 5349 if needed)
		 EOF
		 sudo systemctl enable coturn --now
		 ```
	  - Open UDP/TCP 3478 (and 5349 if TLS) in firewall.
	  - Put `turn:your.server:3478` into `VITE_TURN_URLS` along with any additional `turns:` entries for TLS.
4. Build Embedding:
	- The build picks up `VITE_*` vars for renderer and `SUPABASE_FUNCTIONS_URL` for function calls.
5. Testing Matrix:
	- Two machines behind different NAT types (home vs mobile hotspot) to confirm TURN fallback.
	- Simulate packet loss or disconnect; ensure rejoin logic (future enhancement) restores call.
6. Security Hardening:
	- Randomize/obfuscate voice channel name (currently `voice_<riotId>` pattern). Consider hashing with a shared secret.
	- Add server rule (edge function) to issue signed short-lived token for channel join (Supabase Realtime can use JWT claims).

### TURN Notes
If you provide a TURN server & credentials via environment variables, the app automatically includes them in the ICE server list (`rtcConfig`). Without TURN, some peers will fail to connect (symmetrical NAT / corporate networks).

### Environment Variables Summary
See `.env.example` for all required and optional vars.

---
MIT License.

### LCU Detection Library

The app includes a lightweight League Client (LCU) detector under `src/lcu` that:

- Watches the League lockfile to know when the client is up/down
- Parses auth (port/password/protocol) and exposes status events
- Fetches current summoner and Riot ID by merging `/lol-summoner/v1/current-summoner` and `/lol-chat/v1/me`.

Public API:

```ts
import * as lcu from './src/lcu';

const offUp = lcu.on('up', async () => {
	try {
		const me = await lcu.getCurrentUser({ timeoutMs: 2500 });
		console.log('LCU user:', me.displayName, me.gameName ? `${me.gameName}#${me.tagLine}` : '');
	} catch (e) {
		console.error('Failed to fetch current user:', e);
	}
});

const offDown = lcu.on('down', () => console.log('LCU down'));
```

Run the demo:

```
npx ts-node scripts/lcu-demo.ts
```

