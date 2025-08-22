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

---
MIT License.

