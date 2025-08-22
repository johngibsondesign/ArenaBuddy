import React from 'react';
import { useVoice } from '../../voice/VoiceContext';
import { useSummoner } from '../../summoner/SummonerContext';
import { useDataDragon } from '../../ddragon/DataDragonContext';

interface VoiceBarProps { variant?: 'default' | 'minimal'; }
export const VoiceBar: React.FC<VoiceBarProps> = ({ variant = 'default' }) => {
  const { state, connect, leave, mute, deafen, autoJoin, setAutoJoin, setInputGain, setOutputGain } = useVoice();
  const { me } = useSummoner();
  const [expanded, setExpanded] = React.useState(false);
  const toggleMute = () => mute(!state.muted);
  const toggleDeafen = () => deafen(!state.deafened);
  const { version } = useDataDragon();

  const vertical = variant === 'minimal';
  return (
    <div className={vertical ? 'flex flex-col items-center gap-1 no-drag' : 'flex items-center gap-2 no-drag'}>
  {!state.connected && !state.connecting && !autoJoin && (
        <button
          onClick={() => {
            const lobbyId = me?.riotId ? `${me.riotId.replace(/[^A-Za-z0-9_-]/g,'')}_${(me.tagLine||'NA1').toUpperCase()}` : 'default';
            connect(lobbyId, 'supabase://voice', { name: me?.riotId || 'You', iconId: me?.profileIconId });
          }}
          className={vertical ? 'w-10 h-10 rounded-md bg-gray-800 hover:bg-gray-700 text-[9px] text-gray-300 border border-gray-700 flex items-center justify-center text-center leading-tight' : 'px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-[11px] text-gray-300 border border-gray-700'}
        >{vertical ? 'Join' : 'Join Voice'}</button>
      )}
      {state.connecting && <span className="text-[11px] text-sky-400">Connecting…</span>}
      {state.connected && (
        <div className={vertical ? 'flex flex-col items-center gap-1' : 'flex items-center gap-1'}>
          <button onClick={toggleMute} className={`${vertical ? 'w-10 h-10 text-[9px]' : 'px-2 py-1 text-[11px]'} rounded border ${state.muted ? 'bg-red-600/70 border-red-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}>{vertical ? (state.muted ? 'Unm' : 'Mute') : (state.muted ? 'Unmute' : 'Mute')}</button>
          <button onClick={toggleDeafen} className={`${vertical ? 'w-10 h-10 text-[9px]' : 'px-2 py-1 text-[11px]'} rounded border ${state.deafened ? 'bg-red-600/70 border-red-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}>{vertical ? (state.deafened ? 'Und' : 'Deaf') : (state.deafened ? 'Undeafen' : 'Deafen')}</button>
          <button onClick={() => leave()} className={`${vertical ? 'w-10 h-10 text-[9px]' : 'px-2 py-1 text-[11px]'} rounded bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700`}>{vertical ? 'Leave' : 'Leave'}</button>
          <button onClick={() => setExpanded(e=>!e)} className={`${vertical ? 'w-10 h-10 text-[9px]' : 'px-2 py-1 text-[11px]'} rounded bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700`}>{expanded ? (vertical ? 'Less' : '▴') : (vertical ? 'More' : '▾')}</button>
        </div>
      )}
      {expanded && state.connected && (
        <div className="absolute top-9 right-2 z-50 bg-gray-900 border border-gray-700 rounded-md p-3 w-72 shadow-lg no-drag">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">Participants</div>
          <ul className="space-y-1 max-h-48 overflow-auto">
            {state.participants.length === 0 && <li className="text-[11px] text-gray-500">No remote peers yet</li>}
            {state.participants.map(p => (
              <li key={p.id} className="flex items-center gap-2 text-[11px] text-gray-300">
                <div className="w-6 h-6 rounded bg-gray-700 flex items-center justify-center text-[10px]">{p.iconId ? <img src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${p.iconId}.png`} className="w-6 h-6 rounded"/> : '◎'}</div>
                <span className="truncate">{p.name || p.id}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-gray-700 pt-3 space-y-3">
            <label className="flex items-center justify-between text-[11px] text-gray-300 gap-2">
              <span>Auto Join</span>
              <input type="checkbox" checked={autoJoin} onChange={e => setAutoJoin(e.target.checked)} />
            </label>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Input Gain ({(state.inputGain ?? 1).toFixed(2)})</label>
              <input type="range" min={0} max={2} step={0.05} value={state.inputGain ?? 1} onChange={e => setInputGain(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Output Gain ({(state.outputGain ?? 1).toFixed(2)})</label>
              <input type="range" min={0} max={2} step={0.05} value={state.outputGain ?? 1} onChange={e => setOutputGain(Number(e.target.value))} className="w-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
