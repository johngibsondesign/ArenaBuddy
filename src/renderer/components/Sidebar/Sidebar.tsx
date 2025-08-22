import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHouse, faChessKnight, faGear } from '@fortawesome/free-solid-svg-icons';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSummoner } from '../../summoner/SummonerContext';
import { VoiceBar } from '../VoiceBar/VoiceBar';
import { useDataDragon } from '../../ddragon/DataDragonContext';
import { useVoice } from '../../voice/VoiceContext';

export const Sidebar: React.FC = () => {
  const { me } = useSummoner();
  const { version } = useDataDragon();
  const navigate = useNavigate();
  const voice = useVoice();
  const remotes = voice.state.participants.filter(p => p.id !== 'legacy' && p.id !== voice.state.selfId);
  const [fabOpen, setFabOpen] = React.useState<string | null>(null);

  const goProfile = () => {
    if (!me?.riotId) return;
    const tag = me.tagLine && me.tagLine.length > 0 ? me.tagLine : 'NA1';
    navigate(`/profile/${encodeURIComponent(me.riotId)}/${encodeURIComponent(tag)}`);
  };

  const lcuDetected = !!me?.connected;

  // Debug (can be removed later)
  if (me) {
    // eslint-disable-next-line no-console
    console.debug('[Sidebar] me', me);
  }

  return (
    <div className="flex h-full w-16 flex-col justify-between bg-slate-900 text-gray-300 p-3 gap-2 flex-shrink-0">
      <div>
        <div className="inline-flex items-center justify-center">
          <span className="grid size-10 place-content-center rounded-lg bg-gradient-to-br from-sky-400 to-violet-600 text-xs font-semibold text-white">AB</span>
        </div>
        <div className="px-2 pt-4">
          <nav className="flex flex-col items-center gap-2">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `group relative flex size-10 items-center justify-center rounded-md ${isActive ? 'bg-gradient-to-br from-sky-400 to-violet-600 text-white' : 'bg-highlight/15 text-highlight hover:bg-highlight/25'} transition`}
            >
              <FontAwesomeIcon icon={faHouse} className="text-lg" />
              <span className="invisible absolute start-full top-1/2 ms-3 -translate-y-1/2 rounded-sm bg-gray-900 px-2 py-1.5 text-xs font-medium text-white group-hover:visible">Home</span>
            </NavLink>
            <NavLink
              to="/champions"
              className={({ isActive }) => `group relative flex size-10 items-center justify-center rounded-md ${isActive ? 'bg-gradient-to-br from-sky-400 to-violet-600 text-white' : 'bg-highlight/15 text-highlight hover:bg-highlight/25'} transition`}
            >
              <FontAwesomeIcon icon={faChessKnight} className="text-lg" />
              <span className="invisible absolute start-full top-1/2 ms-3 -translate-y-1/2 rounded-sm bg-gray-900 px-2 py-1.5 text-xs font-medium text-white group-hover:visible">Champions</span>
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) => `group relative flex size-10 items-center justify-center rounded-md ${isActive ? 'bg-gradient-to-br from-sky-400 to-violet-600 text-white' : 'bg-highlight/15 text-highlight hover:bg-highlight/25'} transition`}
            >
              <FontAwesomeIcon icon={faGear} className="text-lg" />
              <span className="invisible absolute start-full top-1/2 ms-3 -translate-y-1/2 rounded-sm bg-gray-900 px-2 py-1.5 text-xs font-medium text-white group-hover:visible">Settings</span>
            </NavLink>
          </nav>
        </div>
        {lcuDetected && (
          <div className="mt-4 flex justify-center">
            <div className="flex flex-col items-center gap-2">
              <VoiceBar variant="minimal" />
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col items-center justify-center mt-2 gap-3">
        {remotes.map(remote => (
          <div key={remote.id} className={`relative ${remote.speaking ? 'ring-2 ring-emerald-500/70 rounded-lg animate-pulse' : ''} ${remote.muted ? 'outline outline-2 outline-red-600 rounded-lg' : ''}`}>
            <button
              type="button"
              onClick={() => setFabOpen(prev => prev === remote.id ? null : remote.id)}
              className="group relative flex items-center justify-center rounded bg-gray-800/70 hover:bg-gray-700 focus:outline-none size-10"
              title={remote.riotId ? `${remote.riotId}#${remote.tagLine}` : (remote.name || 'Participant')}
            >
              <div className="relative w-full h-full">
                {version && remote.iconId ? (
                  <img alt="remote" src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${remote.iconId}.png`} className="w-full h-full object-cover rounded" />
                ) : <span className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-400 font-medium">R</span>}
              </div>
            </button>
            {fabOpen === remote.id && (
              <div className="absolute -top-2 -right-2 translate-x-full bg-gray-900 border border-gray-800 rounded-lg p-2 flex flex-col gap-2 shadow-lg z-50 w-32">
                <button onClick={()=> { if(remote.riotId) navigate('/profile/'+encodeURIComponent(remote.riotId)+'/'+encodeURIComponent(remote.tagLine || 'NA1')); }} className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-left">Profile</button>
                <button onClick={()=> voice.mute(!voice.state.muted)} className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-left">{voice.state.muted ? 'Unmute' : 'Mute'}</button>
                <button onClick={()=> voice.deafen(!voice.state.deafened)} className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-left">{voice.state.deafened ? 'Undeafen' : 'Deafen'}</button>
                <div className="px-2 py-1">
                  <label className="block text-[10px] text-gray-500 mb-1">Volume</label>
                  <input type="range" min={0} max={1} step={0.05} defaultValue={remote.volume ?? 1} onChange={e=> voice.setParticipantVolume(remote.id, Number(e.target.value))} className="w-full" />
                </div>
                <button onClick={()=> setFabOpen(null)} className="text-[11px] px-2 py-1 rounded bg-gray-700 text-gray-300 text-left">Close</button>
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={goProfile}
          disabled={!me}
          className={`group relative flex items-center justify-center rounded bg-gray-800/70 hover:bg-gray-700 focus:outline-none size-10 disabled:opacity-40 disabled:cursor-not-allowed ${voice.state.muted ? 'outline outline-2 outline-red-600' : ''} ${(voice.state as any)._speaking ? 'ring-2 ring-emerald-500/70 animate-pulse' : ''}`}
          title={me ? (me.connected ? 'Click to open profile' : 'Cached profile (client offline)') : 'No summoner detected yet'}
        >
          <div className="relative w-full h-full">
            {version && me?.profileIconId ? (
              <img
              alt="profile"
              src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${me.profileIconId}.png`}
              className="w-full h-full object-cover rounded transition duration-200 ease-in-out filter group-hover:brightness-110"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-400 font-medium">ME</span>
            )}
            {me && (
              <span
                className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border border-gray-900 ${me.connected ? 'bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.4)]' : 'bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.4)]'}`}
                title={me.connected ? 'League Client Connected' : 'League Client Disconnected (cached)'}
              />
            )}
          </div>
          {me?.riotId && (
            <span className="invisible absolute end-full top-1/2 me-3 -translate-y-1/2 rounded-sm bg-gray-900 px-2 py-1.5 text-xs font-medium text-white group-hover:visible whitespace-nowrap">
              {me.riotId}<span className="text-gray-500">#{me.tagLine}</span>
            </span>
          )}
        </button>
  </div>
    </div>
  );
};


