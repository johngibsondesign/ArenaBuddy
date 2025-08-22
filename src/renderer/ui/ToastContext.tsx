import React from 'react';

export interface ToastItem { id: string; message: string; actionLabel?: string; onAction?: () => void; timeout?: number; kind?: 'info'|'warn'|'error'|'success'; }

interface ToastCtx { toasts: ToastItem[]; push: (t: Omit<ToastItem,'id'>) => void; dismiss: (id: string) => void; }

const Ctx = React.createContext<ToastCtx>({ toasts: [], push: () => {}, dismiss: () => {} });

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const dismiss = React.useCallback((id: string) => setToasts(ts => ts.filter(t => t.id !== id)), []);
  const push = React.useCallback((t: Omit<ToastItem,'id'>) => {
    const id = crypto.randomUUID();
    const item: ToastItem = { id, timeout: 5000, kind: 'info', ...t };
    setToasts(ts => [...ts, item]);
    if (item.timeout) setTimeout(() => dismiss(id), item.timeout);
  }, [dismiss]);
  return <Ctx.Provider value={{ toasts, push, dismiss }}>
    {children}
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-[999] w-72">
      {toasts.map(t => (
        <div key={t.id} className={`rounded-md border p-3 text-xs shadow bg-gray-900/95 backdrop-blur border-gray-700 text-gray-200 flex flex-col gap-2 animate-fade-in`}> 
          <div>{t.message}</div>
          <div className="flex justify-between items-center gap-2">
            {t.actionLabel && <button onClick={() => { t.onAction?.(); dismiss(t.id); }} className="px-2 py-1 rounded bg-gradient-to-br from-sky-500 to-violet-600 text-white text-[11px] hover:from-sky-400 hover:to-violet-500">{t.actionLabel}</button>}
            <button onClick={() => dismiss(t.id)} className="ml-auto text-gray-400 hover:text-gray-200 text-[11px]">Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  </Ctx.Provider>;
};

export const useToasts = () => React.useContext(Ctx);