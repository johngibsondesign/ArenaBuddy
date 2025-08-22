export {};

declare global {
  interface Window {
    api?: {
      ping: () => string;
      searchSummoner: (query: string) => Promise<{
        ok: boolean;
        error?: string;
        riotId?: string;
        tagLine?: string;
        profileIconId?: number;
        summonerName?: string;
      }>;
      lcu?: {
        isDetected: () => Promise<{ detected: boolean }>;
        getCurrentSummoner: () => Promise<{
          riotId: string; tagLine?: string; profileIconId?: number; level?: number; summonerId?: number; puuid?: string; displayName?: string; gameName?: string; error?: string;
        } | { error: string } | null>;
      }
    }
  }
}
