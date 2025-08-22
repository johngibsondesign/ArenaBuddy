// Expose Supabase URL & anon key to renderer (placeholder). Replace with secure injection.
import { embedded } from '../main/generatedConfig';

// Attempt to derive project base URL from a variety of supplied forms:
// 1. Full functions domain: https://<ref>.functions.supabase.co -> https://<ref>.supabase.co
// 2. Project base with functions path appended: https://<ref>.supabase.co/functions/v1 -> https://<ref>.supabase.co
// 3. Already correct base URL is returned unchanged.
function deriveBaseUrl(funcUrl?: string) {
  if (!funcUrl) return '';
  try {
    // Case 1: functions subdomain
    const m = funcUrl.match(/^https?:\/\/([a-z0-9-]+)\.functions\.supabase\.co/i);
    if (m) return `https://${m[1]}.supabase.co`;
    // Case 2: strip trailing /functions/... path
    if (/\.supabase\.co\//i.test(funcUrl) && /\/functions\//i.test(funcUrl)) {
      return funcUrl.replace(/\/functions\/.+$/i, '');
    }
    return funcUrl;
  } catch {
    return '';
  }
}

export const SUPABASE_URL = (window as any).SUPABASE_URL || deriveBaseUrl(embedded.supabaseFunctionsUrl) || (import.meta as any).env?.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = (window as any).SUPABASE_ANON_KEY || (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

// Attach to window for VoiceManager consumption
if (typeof window !== 'undefined') {
  (window as any).SUPABASE_URL = SUPABASE_URL;
  (window as any).SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
}
