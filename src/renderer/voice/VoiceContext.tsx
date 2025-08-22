import React from 'react';
import { voiceManager } from './VoiceManager';
import { VoiceStateSnapshot } from './config';
import { useSummoner } from '../summoner/SummonerContext';
import { useToasts } from '../ui/ToastContext';

interface VoiceCtx {
  state: VoiceStateSnapshot;
  connect: (lobbyId: string, signalingUrl: string, meta?: { name?: string; iconId?: number; riotId?: string; tagLine?: string }) => Promise<void>;
  leave: () => void;
  mute: (m: boolean) => void;
  deafen: (d: boolean) => void;
  setInputGain: (v: number) => void;
  setOutputGain: (v: number) => void;
  setOutputDevice: (id: string) => void;
  setInputDevice: (id: string) => void;
  setParticipantVolume: (id: string, v: number) => void;
  autoJoin: boolean;
  setAutoJoin: (v: boolean) => void;
  processing: { echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean };
  setProcessing: (p: Partial<{ echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean }>) => void;
  autoConnectInGame: boolean;
  setAutoConnectInGame: (v: boolean) => void;
  autoLeavePostGame: boolean;
  setAutoLeavePostGame: (v: boolean) => void;
}

const defaultState: VoiceStateSnapshot = { connected: false, connecting: false, muted: false, deafened: false, pushToTalk: false, participants: [] };
export const VoiceContext = React.createContext<VoiceCtx>({
  state: defaultState,
  connect: async () => {},
  leave: () => {},
  mute: () => {},
  deafen: () => {},
  setInputGain: () => {},
  setOutputGain: () => {},
  setOutputDevice: () => {},
  setInputDevice: () => {},
  setParticipantVolume: () => {},
  autoJoin: false,
  setAutoJoin: () => {},
  processing: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  setProcessing: () => {},
  autoConnectInGame: true,
  setAutoConnectInGame: () => {},
  autoLeavePostGame: true,
  setAutoLeavePostGame: () => {}
});

export const VoiceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = React.useState(defaultState);
  const { me } = useSummoner();
  const toasts = useToasts();
  const [autoJoin, setAutoJoinState] = React.useState(localStorage.getItem('voice.autoJoin') === 'true');
  const attemptedRef = React.useRef<string | null>(null);
  const lastInviteRef = React.useRef<number>(0);
  const [processing, setProcessingState] = React.useState(() => ({
    echoCancellation: localStorage.getItem('voice.echoCancellation') !== 'false',
    noiseSuppression: localStorage.getItem('voice.noiseSuppression') !== 'false',
    autoGainControl: localStorage.getItem('voice.autoGainControl') !== 'false'
  }));
  const [autoConnectInGame, setAutoConnectInGame] = React.useState(localStorage.getItem('voice.autoConnectInGame') !== 'false');
  const [autoLeavePostGame, setAutoLeavePostGame] = React.useState(localStorage.getItem('voice.autoLeavePostGame') !== 'false');
  React.useEffect(() => {
    const off = voiceManager.on(setState);
    return () => { try { off(); } catch {} };
  }, []);
  const api = React.useMemo(() => ({
  state,
  connect: async (lobbyId: string, url: string, meta?: { name?: string; iconId?: number; riotId?: string; tagLine?: string }) => {
      const preferred = localStorage.getItem('voice.inputDevice') || undefined;
      const out = localStorage.getItem('voice.outputDevice') || undefined;
      await voiceManager.initDevices(preferred);
      await voiceManager.connect(lobbyId, url, meta);
    },
    leave: () => voiceManager.leave(),
    mute: (m: boolean) => voiceManager.mute(m),
    deafen: (d: boolean) => voiceManager.deafen(d),
    setInputGain: (v: number) => voiceManager.setInputGain(v),
    setOutputGain: (v: number) => voiceManager.setOutputGain(v),
  setInputDevice: (id: string) => { localStorage.setItem('voice.inputDevice', id); (voiceManager as any).setInputDevice(id); },
  setOutputDevice: (id: string) => voiceManager.setOutputDevice(id),
  setParticipantVolume: (id: string, v: number) => voiceManager.setParticipantVolume(id, v),
  autoJoin,
  setAutoJoin: (v: boolean) => { setAutoJoinState(v); localStorage.setItem('voice.autoJoin', String(v)); },
  processing,
  setProcessing: (p: Partial<{ echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean }>) => {
    const next = { ...processing, ...p };
    setProcessingState(next);
    Object.entries(next).forEach(([k,v]) => localStorage.setItem('voice.'+k, String(v)));
    (voiceManager as any).setProcessing(p);
  },
  autoConnectInGame,
  setAutoConnectInGame: (v: boolean) => { setAutoConnectInGame(v); localStorage.setItem('voice.autoConnectInGame', String(v)); },
  autoLeavePostGame,
  setAutoLeavePostGame: (v: boolean) => { setAutoLeavePostGame(v); localStorage.setItem('voice.autoLeavePostGame', String(v)); }
  }), [state, autoJoin, processing, autoConnectInGame, autoLeavePostGame]);

  // Auto-join effect
  React.useEffect(() => {
  if (!autoJoin) return;
    if (state.connected || state.connecting) return;
    if (!me?.riotId) return;
    const lobbyId = `${me.riotId.replace(/[^A-Za-z0-9_-]/g,'')}_${(me.tagLine||'NA1').toUpperCase()}`;
    if (attemptedRef.current === lobbyId) return;
    attemptedRef.current = lobbyId;
    (async () => {
      try {
        const preferred = localStorage.getItem('voice.inputDevice') || undefined;
        const out = localStorage.getItem('voice.outputDevice') || undefined;
        await voiceManager.initDevices(preferred, out);
  await voiceManager.connect(lobbyId, 'supabase://voice', { name: me.riotId, iconId: me.profileIconId, riotId: me.riotId, tagLine: me.tagLine });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[Voice] auto-join failed', e);
      }
    })();
  }, [me, state.connected, state.connecting, autoJoin]);

  // Invite toast when auto-join disabled and remote presence appears
  React.useEffect(() => {
    if (autoJoin) return; // only when autoJoin off
    if (state.connected || state.connecting) return;
    if (state.participants.length > 0) {
      const now = Date.now();
      if (now - lastInviteRef.current < 30000) return; // dedupe 30s
      lastInviteRef.current = now;
      toasts.push({ message: 'A voice participant is available. Join call?', actionLabel: 'Join', onAction: async () => {
        const preferred = localStorage.getItem('voice.inputDevice') || undefined;
        const out = localStorage.getItem('voice.outputDevice') || undefined;
        const lobbyId = me?.riotId ? `${me.riotId.replace(/[^A-Za-z0-9_-]/g,'')}_${(me.tagLine||'NA1').toUpperCase()}` : 'default';
        await voiceManager.initDevices(preferred, out);
        await voiceManager.connect(lobbyId, 'supabase://voice', { name: me?.riotId, iconId: me?.profileIconId, riotId: me?.riotId, tagLine: me?.tagLine });
      }, timeout: 8000 });
    }
  }, [state.participants.length, state.connected, state.connecting, autoJoin]);

  return <VoiceContext.Provider value={api}>{children}</VoiceContext.Provider>;
};

export const useVoice = () => React.useContext(VoiceContext);
