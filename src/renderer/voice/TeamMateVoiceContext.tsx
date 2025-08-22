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
  const lastLobbyMembersRef = React.useRef<string[]>([]);
  const debugEnabledRef = React.useRef<boolean>(false);
  const teammatePuuidRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    debugEnabledRef.current = localStorage.getItem('voice.debugLobby') === '1';
    const id = window.setInterval(() => {
      const cur = localStorage.getItem('voice.debugLobby') === '1';
      if (cur !== debugEnabledRef.current) debugEnabledRef.current = cur;
    }, 5000);
    return () => clearInterval(id);
  }, []);

  function dlog(...args: any[]) { if (debugEnabledRef.current) { try { console.log('[TeamMateVoice]', ...args); } catch {} } }

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
  dlog('poll start', { ts: Date.now(), prevPhase: lastPhaseRef.current });
        const phaseStr = typeof phase === 'string' ? phase : undefined;
        let teammate: { gameName: string; tagLine?: string } | null = null;
        // From lobby
        const selfNames: string[] = [];
        if (me?.riotId) selfNames.push(me.riotId.split('#')[0]);
        if (me?.displayName) selfNames.push(me.displayName);
        // Normalize & unique
        const selfSet = new Set(selfNames.map(n => norm(n)));
  if (lobby?.members && Array.isArray(lobby.members)) {
          const members = lobby.members as any[];
          const resolved = members.map((m, idx) => {
            let rawName = m.gameName || m.summonerName || m.name || m.displayName || m.internalName;
            if (!rawName && m.puuid) rawName = 'p_' + String(m.puuid).slice(0, 8);
            if (!rawName) rawName = 'unknown_' + idx;
            const tag = m.gameTag || m.tagLine || m.tag || '';
            return {
              raw: m,
              name: rawName,
              tag,
              norm: norm(rawName),
              isSelf: Boolean((me?.puuid && m.puuid && me.puuid === m.puuid) || (me?.summonerId && m.summonerId && me.summonerId === m.summonerId) || selfSet.has(norm(rawName)))
            };
          });
          const othersResolved = resolved.filter(r => !r.isSelf);
          const last = lastLobbyMembersRef.current;
          const currentOthersKeys = othersResolved.map(o => norm(o.name + (o.tag || '')));
          const joined = currentOthersKeys.filter(k => !last.includes(k));
          if (joined.length) {
            lastLobbyMembersRef.current = currentOthersKeys;
            dlog('Lobby member joined', { joined, others: othersResolved.map(o => o.name + '#' + o.tag) });
          }
          if (othersResolved.length === 1) {
            const o = othersResolved[0];
            teammate = { gameName: o.name, tagLine: o.tag };
            teammatePuuidRef.current = o.raw?.puuid || null;
          }
          lastLobbyMembersRef.current = currentOthersKeys;
          dlog('Lobby snapshot', {
            phase: phaseStr,
            self: selfNames,
            members: resolved.map(r => r.name + '#' + (r.tag || '')),
            othersCount: othersResolved.length,
            teammate: teammate ? teammate.gameName + '#' + (teammate.tagLine||'') : null
          });
          if (!othersResolved.length) dlog('No other lobby members detected');
          if (resolved.some(r => r.name.startsWith('unknown_'))) {
            dlog('Raw lobby members (unresolved names present)', members.map(m => ({ keys: Object.keys(m), sample: { gameName: m.gameName, summonerName: m.summonerName, name: m.name, displayName: m.displayName, internalName: m.internalName, gameTag: m.gameTag, tagLine: m.tagLine, tag: m.tag, puuid: m.puuid, summonerId: m.summonerId } })));
          }
        }
        // From game session (post champ select / in game)
        if (!teammate && session?.gameData?.players) {
          const myNorm = norm(me?.riotId?.split('#')[0]);
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
  dlog('state updated', { teammate: teammate ? teammate.gameName + '#' + (teammate.tagLine||'') : null, phase: phaseStr });

        // Voice lifecycle logic
        if (phaseStr && phaseStr !== lastPhaseRef.current) {
          lastPhaseRef.current = phaseStr;
          if (phaseStr === 'Lobby' && teammate?.gameName) {
            lobbyJoinedRef.current = true; // mark we were together pre-game
          }
          if (phaseStr === 'Lobby') {
            // Connect immediately in lobby if teammate present and not connected
            if (voice.autoConnectInGame && teammate?.gameName && !voice.state.connected && me?.riotId) {
              let lobbyId: string;
              if (teammatePuuidRef.current && me?.puuid) {
                const pair = [teammatePuuidRef.current, me.puuid].sort();
                lobbyId = 'duo_' + pair.map(p => p.slice(0,12)).join('__');
              } else {
                lobbyId = duoChannelId(teammate.gameName, teammate.tagLine, me.riotId.split('#')[0], me.tagLine);
              }
              dlog('Attempt connect (Lobby)', { lobbyId, teammate: teammate.gameName + '#' + (teammate.tagLine||''), me: me.riotId + '#' + (me.tagLine||''), puuids: { self: me?.puuid, teammate: teammatePuuidRef.current } });
              voice.connect(lobbyId, 'supabase://voice', { name: me.riotId, iconId: me.profileIconId, riotId: me.riotId, tagLine: me.tagLine } as any);
            } else if (teammate?.gameName && voice.state.connected) {
              dlog('Already connected in lobby');
            } else if (teammate?.gameName && !voice.autoConnectInGame) {
              dlog('Teammate present but autoConnect disabled');
            }
          } else if (phaseStr === 'InProgress') {
            // If we did not meet in lobby (solo queue then matched) connect now using deterministic duo id
            if (voice.autoConnectInGame && teammate?.gameName && !voice.state.connected && me?.riotId) {
              let lobbyId: string;
              if (teammatePuuidRef.current && me?.puuid) {
                const pair = [teammatePuuidRef.current, me.puuid].sort();
                lobbyId = 'duo_' + pair.map(p => p.slice(0,12)).join('__');
              } else {
                lobbyId = duoChannelId(teammate.gameName, teammate.tagLine, me.riotId.split('#')[0], me.tagLine);
              }
              dlog('Attempt connect (InGame)', { lobbyId, teammate: teammate.gameName + '#' + (teammate.tagLine||''), me: me.riotId + '#' + (me.tagLine||''), puuids: { self: me?.puuid, teammate: teammatePuuidRef.current } });
              voice.connect(lobbyId, 'supabase://voice', { name: me.riotId, iconId: me.profileIconId, riotId: me.riotId, tagLine: me.tagLine } as any);
            } else if (teammate?.gameName && voice.state.connected) {
              dlog('Already connected in-game');
            } else if (teammate?.gameName && !voice.autoConnectInGame) {
              dlog('In game teammate present but autoConnect disabled');
            }
          }
          if (phaseStr === 'EndOfGame') {
            // Leave if we met only in game (not lobby). If we were lobby duo keep call.
            if (voice.autoLeavePostGame && !lobbyJoinedRef.current && voice.state.connected) {
              voice.leave();
              dlog('Leaving post game (no prior lobby)');
            }
          }
          if (phaseStr === 'None') { // fully out
            lobbyJoinedRef.current = false; // reset for next cycle
            dlog('Reset lobbyJoinedRef due to phase None');
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