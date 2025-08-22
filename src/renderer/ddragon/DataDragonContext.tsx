import React from 'react';

interface DataDragonCtx {
  version: string; // latest known version
  loading: boolean;
  error?: string | null;
  refresh: () => Promise<void>;
}

export const DataDragonContext = React.createContext<DataDragonCtx>({ version: '14.16.1', loading: true, refresh: async () => {} });

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    if (!res.ok) return null;
    const arr: string[] = await res.json();
    return arr?.[0] || null;
  } catch { return null; }
}

export const DataDragonProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [version, setVersion] = React.useState<string>(() => {
    try { return localStorage.getItem('ddragon:lastVersion') || '14.16.1'; } catch { return '14.16.1'; }
  });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true); setError(null);
    const latest = await fetchLatestVersion();
    if (latest) {
      setVersion(latest);
      try { localStorage.setItem('ddragon:lastVersion', latest); } catch {}
    } else {
      setError('Failed to load Data Dragon version');
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  return (
    <DataDragonContext.Provider value={{ version, loading, error, refresh }}>
      {children}
    </DataDragonContext.Provider>
  );
};

export function useDataDragon() { return React.useContext(DataDragonContext); }
