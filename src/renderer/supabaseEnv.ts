// Expose Supabase URL & anon key to renderer (placeholder). Replace with secure injection.
import { embedded } from '../main/generatedConfig';

// Attempt to derive base URL from functions URL if provided (strip /functions/v1)
function deriveBaseUrl(funcUrl?: string) {
  if (!funcUrl) return '';
  return funcUrl.replace(/\/functions\/.+$/, '');
}

export const SUPABASE_URL = (window as any).SUPABASE_URL || deriveBaseUrl(embedded.supabaseFunctionsUrl) || (import.meta as any).env?.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = (window as any).SUPABASE_ANON_KEY || (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

// Attach to window for VoiceManager consumption
if (typeof window !== 'undefined') {
  (window as any).SUPABASE_URL = SUPABASE_URL;
  (window as any).SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
}
