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
  const prevTeammateRef = React.useRef<string | null>(null);
  const puuidCacheRef = React.useRef<Record<string, { gameName?: string; tagLine?: string; fetched: number }>>({});
  const lastSelectionResolveRef = React.useRef<number>(0);

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
        // Manual override (developer/debug) e.g. localStorage.setItem('voice.manualTeammate','Name#TAG')
        try {
          const manual = localStorage.getItem('voice.manualTeammate');
          if (manual && /.+#.+/.test(manual)) {
            const [mn, mt] = manual.split('#');
            teammate = { gameName: mn, tagLine: mt };
            dlog('Manual teammate override applied', manual);
          }
        } catch {}
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
              else {
                dlog('Session teammate resolution ambiguous', {
                  me: mePlayer.gameName + '#' + (mePlayer.gameTag || ''),
                  side,
                  teamMateCount: teamMates.length,
                  teamMates: teamMates.map(t => ({ name: t.gameName + '#' + (t.gameTag||''), puuid: (t.puuid||'').slice(0,8), teamType: t.teamType })),
                  allPlayers: players.map(p => ({ name: p.gameName + '#' + (p.gameTag||''), puuid: (p.puuid||'').slice(0,8), teamType: p.teamType }))
                });
              }
            } else {
              dlog('Me not found in session players', { myNorm, players: players.map(p => p.gameName + '#' + (p.gameTag||'')) });
            }
        }
        // NEW: During InProgress we may only have playerChampionSelections (no names). We can fetch names via summoner API if needed later.
        if (!teammate && phaseStr === 'InProgress' && session?.gameData?.playerChampionSelections && Array.isArray(session.gameData.playerChampionSelections)) {
          const selections = session.gameData.playerChampionSelections as any[];
          dlog('InProgress selections detected', { count: selections.length, sample: selections.slice(0,3).map(s => ({ champ: s.championId, puuid: (s.puuid||'').slice(0,8) })) });
          // Attempt lightweight enrichment every 15s max to avoid hammering LCU
          const now = Date.now();
          if (now - lastSelectionResolveRef.current > 15000) {
            lastSelectionResolveRef.current = now;
            // Unique PUUIDs
            const puuids = Array.from(new Set(selections.map(s => s.puuid).filter(Boolean)));
            const cache = puuidCacheRef.current;
            const toFetch = puuids.filter(p => !cache[p] || (now - cache[p].fetched) > 5*60*1000).slice(0,5); // cap per cycle
            if (toFetch.length) dlog('Fetching summoners for puuids', toFetch.map(p => p.slice(0,8)));
            for (const p of toFetch) {
              try {
                const info = await api.getSummonerByPuuid(p);
                cache[p] = { gameName: info?.gameName || info?.displayName, tagLine: info?.tagLine, fetched: Date.now() };
              } catch {/* ignore */}
            }
            // Determine my puuid (from me) and find exactly one teammate on same team if possible
            if (me?.puuid) {
              // Need to know sides: playerChampionSelections doesn't include team directly; attempt inference via champion duplicates? Skip if not determinable.
              // Fallback: if exactly 2 cached entries including me (duo in Arena) pick the other.
              if (puuids.includes(me.puuid) && puuids.length === 2) {
                const other = puuids.find(p => p !== me.puuid)!;
                const otherInfo = cache[other];
                if (otherInfo?.gameName) {
                  teammate = { gameName: otherInfo.gameName, tagLine: otherInfo.tagLine };
                  teammatePuuidRef.current = other;
                  dlog('Teammate inferred from champion selections duo', { other: other.slice(0,8), name: otherInfo.gameName + '#' + (otherInfo.tagLine||'') });
                }
              }
            }
          }
        }
        // Additional attempt: some builds may expose players at session.gameData.gameData?.players or session.players
        if (!teammate && session) {
          const playerArrays: any[] = [];
          if (Array.isArray((session as any).players)) playerArrays.push((session as any).players);
          if (session?.gameData?.gameData?.players && Array.isArray(session.gameData.gameData.players)) playerArrays.push(session.gameData.gameData.players);
          for (const arr of playerArrays) {
            try {
              const myNorm = norm(me?.riotId?.split('#')[0]);
              const mePlayer = arr.find((p: any) => norm(p.gameName) === myNorm);
              if (mePlayer) {
                const side = mePlayer.teamType || mePlayer.team || mePlayer.side;
                const mates = arr.filter((p: any) => (p.teamType||p.team||p.side) === side && norm(p.gameName) !== myNorm);
                if (mates.length === 1) { teammate = { gameName: mates[0].gameName, tagLine: mates[0].gameTag }; dlog('Teammate found via alt players array'); break; }
              }
            } catch {}
          }
        }
        if (!teammate) {
          const sessionKeys = session ? Object.keys(session) : [];
          if (lobby?.members?.length) {
            dlog('No teammate determined after lobby + session inspection', { lobbyCount: lobby.members.length, sessionKeys });
          } else if (session?.gameData?.players?.length) {
            dlog('No teammate determined from session players only', { playerCount: session.gameData.players.length, sessionKeys });
          } else {
            dlog('No teammate data sources available (no lobby, no session players)', { sessionKeys });
            if (session && !session?.gameData?.players) dlog('Raw session snapshot (truncated)', JSON.stringify(session).slice(0, 400));
          }
        }
        setState(s => ({ ...s, teammateRiotId: teammate?.gameName, teammateTagLine: teammate?.tagLine, phase: phaseStr, inGame: phaseStr === 'InProgress' }));
  dlog('state updated', { teammate: teammate ? teammate.gameName + '#' + (teammate.tagLine||'') : null, phase: phaseStr });

        // New teammate appeared while staying in same phase (e.g., already in Lobby)
        if (!voice.state.connected && !voice.state.connecting && voice.autoConnectInGame && teammate?.gameName && !prevTeammateRef.current) {
          let lobbyId: string;
          if (teammatePuuidRef.current && me?.puuid) {
            const pair = [teammatePuuidRef.current, me.puuid].sort();
            lobbyId = 'duo_' + pair.map(p => p.slice(0,12)).join('__');
          } else {
            lobbyId = duoChannelId(teammate.gameName, teammate.tagLine, me?.riotId?.split('#')[0], me?.tagLine);
          }
          dlog('Attempt connect (TeammateAppeared)', { lobbyId, teammate: teammate.gameName + '#' + (teammate.tagLine||''), me: me?.riotId + '#' + (me?.tagLine||''), phase: phaseStr });
          voice.connect(lobbyId, 'supabase://voice', { name: me?.riotId, iconId: me?.profileIconId, riotId: me?.riotId, tagLine: me?.tagLine } as any);
        }
        else if (teammate?.gameName && voice.autoConnectInGame && !voice.state.connected && !voice.state.connecting && prevTeammateRef.current) {
          dlog('Skip auto-connect (teammate already processed previously)', { teammate: teammate.gameName });
        } else if (teammate?.gameName && !voice.autoConnectInGame) {
          dlog('Skip auto-connect (autoConnectInGame disabled)');
        } else if (teammate?.gameName && voice.state.connecting) {
          dlog('Skip auto-connect (already connecting)');
        }
        prevTeammateRef.current = teammate?.gameName || null;

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
            } else if (teammate?.gameName && voice.state.connecting) {
              dlog('Already connecting in lobby');
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
            } else if (teammate?.gameName && voice.state.connecting) {
              dlog('Already connecting in-game');
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