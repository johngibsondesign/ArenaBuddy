import React from 'react';

export interface CurrentSummoner {
  riotId: string; // gameName
  tagLine: string; // tag
  profileIconId?: number;
  level?: number;
  summonerId?: number;
  puuid?: string;
  displayName?: string;
  loading: boolean;
  error?: string | null;
  connected: boolean; // LCU currently detected
  fromCache?: boolean;
}

interface SummonerCtx {
  me: CurrentSummoner | null;
  refresh: () => Promise<void>;
}

export const SummonerContext = React.createContext<SummonerCtx>({ me: null, refresh: async () => {} });

async function fetchLocalLeagueSummoner(): Promise<(Partial<CurrentSummoner> & { connected: boolean }) | { connected: false } | null> {
  try {
    const api: any = (window as any).api;
    if (!api?.lcu) return null;
    const detect = await api.lcu.isDetected();
  if (!detect?.detected) return { connected: false };
  const me = await api.lcu.getCurrentSummoner();
  // Extra debug
  console.debug('[SummonerContext] raw IPC getCurrentSummoner response', me);
  if (!me || (me as any).error) return { connected: false };
  return { riotId: me.riotId, tagLine: me.tagLine || '', profileIconId: me.profileIconId, level: me.level, summonerId: me.summonerId, puuid: me.puuid, displayName: me.displayName, connected: true };
  } catch { return null; }
}

export const SummonerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [me, setMe] = React.useState<CurrentSummoner | null>(null);
  const [loading, setLoading] = React.useState(false);
  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLocalLeagueSummoner();
    if (data && 'riotId' in data) {
  console.log('[SummonerContext] LCU user (post-processed)', data);
        setMe(prev => ({
          riotId: data.riotId || prev?.riotId || 'Player',
          tagLine: data.tagLine || prev?.tagLine || '',
          profileIconId: data.profileIconId,
          level: data.level,
          summonerId: data.summonerId,
          puuid: data.puuid,
          displayName: data.displayName,
          loading: false,
          error: null,
          connected: true,
          fromCache: false
        }));
        try { localStorage.setItem('summoner:last', JSON.stringify({ riotId: data.riotId, tagLine: data.tagLine, profileIconId: data.profileIconId, level: data.level, summonerId: data.summonerId, puuid: data.puuid, displayName: data.displayName })); } catch {}
      } else if (data && 'connected' in data && data.connected === false) {
        console.log('[SummonerContext] LCU disconnected (keeping cache)', data);
        // keep cached data but mark disconnected
        setMe(prev => prev ? { ...prev, connected: false, loading: false } : prev);
      } // else null (no api) => leave state
    } catch (e: any) {
      console.warn('[SummonerContext] refresh error', e);
      setMe(prev => (prev ? { ...prev, error: e.message || 'Error', loading: false } : { riotId: 'Player', tagLine: 'NA1', loading: false, error: e.message || 'Error', connected: false } as any));
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => {
    // hydrate from cache quickly
    try {
      const raw = localStorage.getItem('summoner:last');
      if (raw) {
        const parsed = JSON.parse(raw);
  if (parsed?.riotId && parsed?.tagLine) setMe({ ...parsed, loading: true, connected: false, fromCache: true });
      }
    } catch {}
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  return <SummonerContext.Provider value={{ me: me ? { ...me, loading } : null, refresh }}>{children}</SummonerContext.Provider>;
};

export function useSummoner() { return React.useContext(SummonerContext); }
