import React from 'react';
import { useVoice } from './VoiceContext';
import { useSummoner } from '../summoner/SummonerContext';

interface TeamMateState {
  teammateRiotId?: string;
  teammateTagLine?: string;
  phase?: string;
  inGame: boolean;
}

const TeamMateCtx = React.createContext<TeamMateState>({ inGame: false });

// Simple hash to normalize RiotID (remove spaces, case-insensitive)
function norm(id?: string) { return (id||'').replace(/\s+/g,'').toLowerCase(); }

function sanitizeName(name?: string) { return (name||'').replace(/[^A-Za-z0-9_-]/g,'').toLowerCase(); }
function sanitizeTag(tag?: string) { return (tag||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase(); }
function duoChannelId(aName?: string, aTag?: string, bName?: string, bTag?: string) {
  const token = (n?: string, t?: string) => `${sanitizeName(n)}-${sanitizeTag(t||'NA1')}`;
  const parts = [token(aName, aTag), token(bName, bTag)].sort();
  return parts.join('__');
}

export const TeamMateVoiceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { me } = useSummoner();
  const voice = useVoice();
  const [state, setState] = React.useState<TeamMateState>({ inGame: false });
  const lastPhaseRef = React.useRef<string | undefined>(undefined);
  const lobbyJoinedRef = React.useRef(false); // were we together in lobby pre-game
  const intervalRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const api: any = (window as any).api?.lcu;
    if (!api) return;
    async function poll() {
      try {
        const [phase, lobby, session] = await Promise.all([
          api.getGameflowPhase(),
          api.getLobby(),
          api.getGameflowSession()
        ]);
        const phaseStr = typeof phase === 'string' ? phase : undefined;
        let teammate: { gameName: string; tagLine?: string } | null = null;
        // From lobby
        const myNorm = norm(me?.riotId);
        if (lobby?.members && Array.isArray(lobby.members)) {
          const members = lobby.members as any[];
          const others = members.filter(m => norm(m.gameName) !== myNorm);
          if (others.length === 1) teammate = { gameName: others[0].gameName, tagLine: others[0].gameTag }; // duo
        }
        // From game session (post champ select / in game)
        if (!teammate && session?.gameData?.players) {
          const players = session.gameData.players as any[];
          // Side with me
          const mePlayer = players.find(p => norm(p.gameName) === myNorm);
            if (mePlayer) {
              const side = mePlayer.teamType; // BLUE / RED
              const teamMates = players.filter(p => p.teamType === side && norm(p.gameName) !== myNorm);
              if (teamMates.length === 1) teammate = { gameName: teamMates[0].gameName, tagLine: teamMates[0].gameTag }; // duo inside ranked flex/arena scenario
            }
        }
        setState(s => ({ ...s, teammateRiotId: teammate?.gameName, teammateTagLine: teammate?.tagLine, phase: phaseStr, inGame: phaseStr === 'InProgress' }));

        // Voice lifecycle logic
        if (phaseStr && phaseStr !== lastPhaseRef.current) {
          lastPhaseRef.current = phaseStr;
          if (phaseStr === 'Lobby' && teammate?.gameName) {
            lobbyJoinedRef.current = true; // mark we were together pre-game
          }
          if (phaseStr === 'Lobby') {
            // Connect immediately in lobby if teammate present and not connected
            if (voice.autoConnectInGame && teammate?.gameName && !voice.state.connected && me?.riotId) {
              const lobbyId = duoChannelId(teammate.gameName, teammate.tagLine, me.riotId.split('#')[0], me.tagLine);
              voice.connect(lobbyId, 'supabase://voice', { name: me.riotId, iconId: me.profileIconId, riotId: me.riotId, tagLine: me.tagLine } as any);
            }
          } else if (phaseStr === 'InProgress') {
            // If we did not meet in lobby (solo queue then matched) connect now using deterministic duo id
            if (voice.autoConnectInGame && teammate?.gameName && !voice.state.connected && me?.riotId) {
              const lobbyId = duoChannelId(teammate.gameName, teammate.tagLine, me.riotId.split('#')[0], me.tagLine);
              voice.connect(lobbyId, 'supabase://voice', { name: me.riotId, iconId: me.profileIconId, riotId: me.riotId, tagLine: me.tagLine } as any);
            }
          }
          if (phaseStr === 'EndOfGame') {
            // Leave if we met only in game (not lobby). If we were lobby duo keep call.
            if (voice.autoLeavePostGame && !lobbyJoinedRef.current && voice.state.connected) {
              voice.leave();
            }
          }
          if (phaseStr === 'None') { // fully out
            lobbyJoinedRef.current = false; // reset for next cycle
          }
        }
      } catch {/* ignore */}
    }
    poll();
    intervalRef.current = window.setInterval(poll, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [me, voice.state.connected, voice.autoConnectInGame, voice.autoLeavePostGame]);

  return <TeamMateCtx.Provider value={state}>{children}</TeamMateCtx.Provider>;
};

export const useTeamMateVoice = () => React.useContext(TeamMateCtx);