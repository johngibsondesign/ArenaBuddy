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
    }
  }
}
