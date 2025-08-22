import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { VoiceProvider } from './voice/VoiceContext';
import { TeamMateVoiceProvider } from './voice/TeamMateVoiceContext';
import { SummonerProvider } from './summoner/SummonerContext';
import { DataDragonProvider } from './ddragon/DataDragonContext';
import { BrowserRouter, HashRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { Sidebar } from './components/Sidebar/Sidebar';
import { useTeamMateVoice } from './voice/TeamMateVoiceContext';
import { useVoice } from './voice/VoiceContext';
import './index.css';
import './supabaseEnv';
import { ToastProvider } from './ui/ToastContext';

// (useState already imported above)

const isElectron = typeof navigator !== 'undefined' && (navigator.userAgent.toLowerCase().includes('electron') || !!(window as any).process?.versions?.electron);
const hasBridge = !!(window as any).api && typeof (window as any).api.searchSummoner === 'function';

interface SummonerResult { ok: true; riotId: string; tagLine: string; summonerName: string; profileIconId?: number; level?: number; }
interface ChampionMeta { id: string; key: string; name: string; title: string; tags: string[]; image: { full: string }; }
interface ChampionResult { ok: true; champion: { id: string; name: string; title: string; tags: string[]; imageFull: string; version: string; }; }
type SearchResult = SummonerResult | ChampionResult | { ok: false; error: string; details?: string } | null;

const SearchPage: React.FC = () => {
	const navigate = useNavigate();
	const [query, setQuery] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [champVersion, setChampVersion] = useState('14.16.1');
	const [champions, setChampions] = useState<ChampionMeta[]>([]);
	const [filtered, setFiltered] = useState<ChampionMeta[]>([]);
	const [showSug, setShowSug] = useState(false);
	const [searchFocused, setSearchFocused] = useState(false);
	const inputRef = React.useRef<HTMLInputElement>(null);

	// Load Data Dragon versions + champion list
	React.useEffect(() => {
		(async () => {
			try {
				const vRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
				if (vRes.ok) {
					const vs: string[] = await vRes.json();
					if (vs.length) setChampVersion(vs[0]);
				}
				const cRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${champVersion}/data/en_US/champion.json`);
				if (cRes.ok) {
					const data = await cRes.json();
					setChampions(Object.values(data.data || {}) as any);
				}
			} catch (e) { console.warn('[champions] load failed', e); }
		})();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Update suggestions
	React.useEffect(() => {
		const q = query.trim();
		if (q.length >= 3 && !q.includes('#')) {
			const lower = q.toLowerCase();
			const list = champions.filter(c => c.name.toLowerCase().includes(lower)).slice(0,12);
			setFiltered(list);
			setShowSug(list.length > 0);
		} else {
			setShowSug(false); setFiltered([]);
		}
	}, [query, champions]);

	const navigateToSummoner = () => {
		const cleaned = query.trim();
		const match = cleaned.match(/^(.*?)[\s]*#[\s]*([A-Za-z0-9]{2,10})$/);
		if (!match) {
			setError('Format must be RiotID#TAG');
			return;
		}
		const riotId = encodeURIComponent(match[1].trim());
		const tagLine = encodeURIComponent(match[2].trim());
		navigate(`/profile/${riotId}/${tagLine}`);
	};

	const performChampion = (c: ChampionMeta) => {
		setShowSug(false);
		navigate(`/champion/${encodeURIComponent(c.id)}`);
	};

	const tryExactChampion = () => {
		const q = query.trim().toLowerCase();
		if (!q || q.includes('#')) return false;
		const match = champions.find(c => c.name.toLowerCase() === q);
		if (match) { performChampion(match); return true; }
		return false;
	};

	const onSubmit: React.FormEventHandler = (e) => {
		e.preventDefault();
		if (!query.trim()) return;
		if (query.includes('#')) { navigateToSummoner(); return; }
		if (tryExactChampion()) return;
		if (filtered.length === 1) { performChampion(filtered[0]); return; }
	};

	return (
		<div className="flex flex-1 items-center justify-center bg-gray-950 text-gray-200 p-8 overflow-auto">
			{/* Overlay */}
			{searchFocused && (
				<div
					className="fixed inset-0 bg-black/60 backdrop-blur-sm z-10"
					onMouseDown={() => { setSearchFocused(false); setShowSug(false); inputRef.current?.blur(); }}
				/>
			)}
			<form
				className="relative z-20 w-full max-w-xl flex flex-col items-stretch gap-6"
				onSubmit={onSubmit}
			>
				<div className="text-center">
					<h1 className="text-3xl font-semibold bg-gradient-to-br from-sky-400 to-violet-600 bg-clip-text text-transparent">Search Summoner</h1>
					<p className="mt-2 text-sm text-gray-500">Enter Riot ID and Tag (e.g. I Skada#2606 or I Skada #2606).</p>
				</div>
				<div className="flex gap-3">
					<div className="relative flex-1">
						<input
							ref={inputRef}
							value={query}
							onChange={e => setQuery(e.target.value)}
							onFocus={() => setSearchFocused(true)}
							onBlur={() => { /* let overlay click handle closing; if tabbing away, close immediately */ setTimeout(() => { if (document.activeElement !== inputRef.current) setSearchFocused(false); }, 0); }}
							type="text"
							placeholder="RiotID#TAG or Champion"
							className="w-full rounded-md bg-gray-900 border border-gray-800 focus:border-sky-400 focus:ring-2 focus:ring-violet-600/40 outline-none px-4 py-3 text-sm placeholder-gray-500 transition"
						/>
						{showSug && filtered.length > 0 && (
							<ul className="absolute z-30 left-0 right-0 top-full mt-1 max-h-64 overflow-auto rounded-md border border-gray-800 bg-gray-900 shadow-lg text-sm">
								{filtered.map(c => (
									<li key={c.id}>
										<button type="button" onClick={() => performChampion(c)} className="w-full text-left px-3 py-2 hover:bg-gray-800 flex items-center gap-2 focus:outline-none">
											<img src={`https://ddragon.leagueoflegends.com/cdn/${champVersion}/img/champion/${c.image.full}`} alt={c.name} className="w-6 h-6 rounded object-cover" />
											<span className="font-medium">{c.name}</span>
											<span className="text-gray-500 text-[10px]">{c.tags.join(', ')}</span>
										</button>
									</li>
								))}
							</ul>
						)}
						<span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] tracking-wide text-gray-600 select-none border border-gray-700 rounded px-1 py-0.5">Enter</span>
					</div>
					<button
						type="submit"
						disabled={loading || !query.trim()}
						className="relative inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-medium text-white bg-gradient-to-br from-sky-400 to-violet-600 shadow disabled:opacity-40 disabled:cursor-not-allowed hover:from-sky-300 hover:to-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 active:scale-[.98] transition"
					>
						Go
					</button>
				</div>
				{error && <div className="text-sm text-red-400 whitespace-pre-wrap">{error}</div>}
			</form>
		</div>
	);
};

// Profile Page
const ProfilePage: React.FC = () => {
	const { riotId = '', tagLine = '' } = useParams();
	const navigate = useNavigate();
	const BackButton = () => (
		<button
			type="button"
			onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/'); }}
			className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-800/70 hover:bg-gray-700 text-xs font-medium text-gray-200 border border-gray-700 shadow focus:outline-none focus:ring-2 focus:ring-violet-600/40 transition"
		>
			<span className="w-2.5 h-2.5 rotate-180 border-t-2 border-l-2 border-gray-300 inline-block translate-y-[1px]"></span>
			Back
		</button>
	);
	const decodedId = decodeURIComponent(riotId);
	const decodedTag = decodeURIComponent(tagLine);
	const [data, setData] = React.useState<SummonerResult | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(false);
	const [attempt, setAttempt] = React.useState(0);
	const maxAttempts = 3;
	const [version, setVersion] = React.useState('14.16.1');

	React.useEffect(() => {
		(async () => {
			try {
				const vRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
				if (vRes.ok) { const vs: string[] = await vRes.json(); if (vs.length) setVersion(vs[0]); }
			} catch {}
		})();
	}, []);

	React.useEffect(() => {
		const q = `${decodedId}#${decodedTag}`;
		let cancelled = false;
		async function run(at: number) {
			setLoading(true); setError(null); setData(null);
			try {
				if (hasBridge) {
					const bridge = (window as any).api;
					const res = await bridge.searchSummoner(q);
					if (!res || !res.ok) {
						if (!cancelled) setError(formatError(res?.error));
						if (shouldRetry(res?.error) && at < maxAttempts - 1) {
							setTimeout(() => !cancelled && run(at + 1), 500 * Math.pow(2, at));
						} else if (!shouldRetry(res?.error)) {
							// no retry
						}
					} else if (!cancelled) setData(res);
				} else {
					const params = new URLSearchParams({ q });
					const res = await fetch(`http://localhost:${(window as any).__DEV_API_PORT__ || 5174}/api/riot/search?${params}`);
					const json = await res.json();
					if (!json.ok) {
						if (!cancelled) setError(formatError(json.error));
						if (shouldRetry(json.error) && at < maxAttempts - 1) {
							setTimeout(() => !cancelled && run(at + 1), 500 * Math.pow(2, at));
						}
					} else if (!cancelled) setData(json);
				}
			} catch (e:any) {
				if (!cancelled) {
					setError(formatError(e.message || 'Error'));
					if (shouldRetry(e.message) && at < maxAttempts - 1) {
						setTimeout(() => !cancelled && run(at + 1), 500 * Math.pow(2, at));
					}
				}
			} finally { if (!cancelled) setLoading(false); }
		}
		function shouldRetry(msg?: string) {
			if (!msg) return false;
			return /network|fetch failed|timeout|edge function error/i.test(msg) && !/not configured/i.test(msg);
		}
		function formatError(msg?: string) {
			if (!msg) return 'Lookup failed';
			if (/SUPABASE_FUNCTIONS_URL not configured/i.test(msg)) return msg + '\nConfigure SUPABASE_FUNCTIONS_URL secret in your build environment.';
			if (/Edge function error/i.test(msg)) return 'Service temporarily unavailable. Please retry.';
			return msg;
		}
		setAttempt(0);
		run(0);
		return () => { cancelled = true; };
	}, [riotId, tagLine]);

	const manualRetry = () => {
		setAttempt(a => a + 1);
		// trigger effect by changing key (riotId/tagLine havent changed) => call run again manually
		const q = `${decodedId}#${decodedTag}`; // call via bridge directly
		// Force re-run by duplicating logic minimal
		if (hasBridge) {
			( window as any).api.searchSummoner(q).then((res:any) => {
				if (!res || !res.ok) setError(res?.error || 'Lookup failed'); else setError(null), setData(res);
			}).catch((e:any)=> setError(e.message||'Error'));
		} else {
			const params = new URLSearchParams({ q });
			fetch(`http://localhost:${(window as any).__DEV_API_PORT__ || 5174}/api/riot/search?${params}`).then(r=>r.json()).then(json => {
				if (!json.ok) setError(json.error||'Lookup failed'); else { setError(null); setData(json); }
			}).catch(e=> setError(e.message||'Error'));
		}
	};

	return (
		<div className="flex flex-1 flex-col p-8 text-gray-200 overflow-auto bg-gray-950">
				<div className="flex items-center justify-between mb-6">
					<h1 className="text-2xl font-semibold"><span className="bg-gradient-to-br from-sky-400 to-violet-600 bg-clip-text text-transparent">Profile</span></h1>
					<BackButton />
				</div>
			{loading && <div className="text-sm text-gray-400">Loading…</div>}
			{error && (
				<div className="text-sm text-red-400 whitespace-pre-wrap mb-4 flex flex-col gap-2">
					<span>{error}</span>
					<button onClick={manualRetry} className="self-start inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-gray-800 border border-gray-700 hover:bg-gray-700 text-[11px] font-medium text-gray-200">Retry</button>
				</div>
			)}
			{data && (
				<div className="flex items-center gap-6 bg-gray-900/60 rounded-lg p-6 border border-gray-800 w-full max-w-xl">
					<div className="w-24 h-24 rounded-lg bg-gray-800 flex items-center justify-center overflow-hidden">
						{data.profileIconId ? <img alt="icon" className="w-full h-full object-cover" src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${data.profileIconId}.png`} /> : <span className="text-gray-500 text-xs">N/A</span>}
					</div>
					<div>
						<div className="text-xl font-semibold flex items-center gap-2">{data.summonerName}<span className="text-gray-500 text-sm">#{data.tagLine}</span></div>
						{data.level && <div className="text-xs text-gray-400 mt-1">Level {data.level}</div>}
					</div>
				</div>
			)}
		</div>
	);
};

// Champion Page
const ChampionPage: React.FC = () => {
	const { champId = '' } = useParams();
	const navigate = useNavigate();
	const BackButton = () => (
		<button
			type="button"
			onClick={() => { if (window.history.length > 1) navigate(-1); else navigate('/'); }}
			className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-800/70 hover:bg-gray-700 text-xs font-medium text-gray-200 border border-gray-700 shadow focus:outline-none focus:ring-2 focus:ring-violet-600/40 transition"
		>
			<span className="w-2.5 h-2.5 rotate-180 border-t-2 border-l-2 border-gray-300 inline-block translate-y-[1px]"></span>
			Back
		</button>
	);
	const decoded = decodeURIComponent(champId);
	const [data, setData] = React.useState<ChampionResult | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(false);
	const [version, setVersion] = React.useState('14.16.1');

	React.useEffect(() => {
		(async () => {
			try {
				const vRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
				if (vRes.ok) { const vs: string[] = await vRes.json(); if (vs.length) setVersion(vs[0]); }
			} catch {}
		})();
	}, []);

	React.useEffect(() => {
		setLoading(true); setError(null); setData(null);
		(async () => {
			try {
				const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion/${decoded}.json`);
				if (!res.ok) { setError('Champion not found'); }
				else {
					const json = await res.json();
					const champ = json.data?.[decoded];
					if (!champ) setError('Champion data missing');
					else setData({ ok: true, champion: { id: champ.id, name: champ.name, title: champ.title, tags: champ.tags, imageFull: champ.image.full, version } });
				}
			} catch (e:any) { setError(e.message || 'Error'); }
			finally { setLoading(false); }
		})();
	}, [decoded, version]);

	return (
		<div className="flex flex-1 flex-col p-8 text-gray-200 overflow-auto bg-gray-950">
				<div className="flex items-center justify-between mb-6">
					<h1 className="text-2xl font-semibold"><span className="bg-gradient-to-br from-sky-400 to-violet-600 bg-clip-text text-transparent">Champion</span></h1>
					<BackButton />
				</div>
			{loading && <div className="text-sm text-gray-400">Loading…</div>}
			{error && <div className="text-sm text-red-400 whitespace-pre-wrap mb-4">{error}</div>}
			{data && (
				<div className="flex items-center gap-6 bg-gray-900/60 rounded-lg p-6 border border-gray-800 w-full max-w-xl">
					<div className="w-28 h-28 rounded-lg bg-gray-800 flex items-center justify-center overflow-hidden">
						<img alt={data.champion.name} className="w-full h-full object-cover" src={`https://ddragon.leagueoflegends.com/cdn/${data.champion.version}/img/champion/${data.champion.imageFull}`} />
					</div>
					<div>
						<div className="text-xl font-semibold">{data.champion.name}</div>
						<div className="text-xs text-gray-400 mb-2">{data.champion.title}</div>
						<div className="flex flex-wrap gap-1">
							{data.champion.tags.map(t => <span key={t} className="px-2 py-0.5 rounded-full bg-gray-800 text-[10px] tracking-wide text-gray-300 border border-gray-700">{t}</span>)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

// Settings Page
const SettingsPage: React.FC = () => {
	const [version, setVersion] = React.useState<string>('');
	const [status, setStatus] = React.useState<string>('idle');
	const [info, setInfo] = React.useState<any>(null);
	const [progress, setProgress] = React.useState<any>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
	const [selectedDevice, setSelectedDevice] = React.useState<string>(() => localStorage.getItem('voice.inputDevice') || '');
	const [selectedOutput, setSelectedOutput] = React.useState<string>(() => localStorage.getItem('voice.outputDevice') || '');
	const [inputGain, setInputGain] = React.useState<number>(() => Number(localStorage.getItem('voice.inputGain')||'1'));
	const [outputGain, setOutputGain] = React.useState<number>(() => Number(localStorage.getItem('voice.outputGain')||'1'));
	const [autoJoin, setAutoJoin] = React.useState<boolean>(() => localStorage.getItem('voice.autoJoin') === 'true');
	const [echoCancellation, setEchoCancellation] = React.useState(localStorage.getItem('voice.echoCancellation') !== 'false');
	const [noiseSuppression, setNoiseSuppression] = React.useState(localStorage.getItem('voice.noiseSuppression') !== 'false');
	const [autoGainControl, setAutoGainControl] = React.useState(localStorage.getItem('voice.autoGainControl') !== 'false');
	const [autoConnectInGame, setAutoConnectInGame] = React.useState(localStorage.getItem('voice.autoConnectInGame') !== 'false');
	const [autoLeavePostGame, setAutoLeavePostGame] = React.useState(localStorage.getItem('voice.autoLeavePostGame') !== 'false');
	const testToneRef = React.useRef<HTMLAudioElement | null>(null);
	const api: any = (window as any).api;

	React.useEffect(() => { (async () => { try { const v = await api?.app?.getVersion(); if (v) setVersion(v); } catch {} })(); }, []);

	React.useEffect(() => {
		api?.app?.onUpdateEvent?.((evt: string, payload: any) => {
			if (evt === 'update:available') { setStatus('update-available'); setInfo(payload); }
			if (evt === 'update:not-available') { setStatus('up-to-date'); setInfo(payload); }
			if (evt === 'update:download-progress') { setStatus('downloading'); setProgress(payload); }
			if (evt === 'update:downloaded') { setStatus('downloaded'); setInfo(payload); }
			if (evt === 'update:error') { setStatus('error'); setError(payload); }
		});
	}, []);

	React.useEffect(() => {
		(async () => {
			try {
				const devs = await navigator.mediaDevices.enumerateDevices();
				setDevices(devs.filter(d => d.kind === 'audioinput' || d.kind === 'audiooutput'));
			} catch {}
		})();
	}, []);

	const onSelectDevice = (id: string) => { setSelectedDevice(id); localStorage.setItem('voice.inputDevice', id); };
	const onSelectOutput = (id: string) => { setSelectedOutput(id); localStorage.setItem('voice.outputDevice', id); };
	const onInputGain = (v: number) => { setInputGain(v); localStorage.setItem('voice.inputGain', String(v)); };
	const onOutputGain = (v: number) => { setOutputGain(v); localStorage.setItem('voice.outputGain', String(v)); };
	const toggleAutoJoin = () => {
		setAutoJoin(a => { const next = !a; localStorage.setItem('voice.autoJoin', String(next)); return next; });
	};
	const toggleEcho = () => setEchoCancellation(v => { const next = !v; localStorage.setItem('voice.echoCancellation', String(next)); return next; });
	const toggleNoise = () => setNoiseSuppression(v => { const next = !v; localStorage.setItem('voice.noiseSuppression', String(next)); return next; });
	const toggleAgc = () => setAutoGainControl(v => { const next = !v; localStorage.setItem('voice.autoGainControl', String(next)); return next; });
	const toggleAutoConnectInGame = () => setAutoConnectInGame(v => { const next = !v; localStorage.setItem('voice.autoConnectInGame', String(next)); return next; });
	const toggleAutoLeavePostGame = () => setAutoLeavePostGame(v => { const next = !v; localStorage.setItem('voice.autoLeavePostGame', String(next)); return next; });
	const playTestTone = () => {
		if (!testToneRef.current) {
			const ctx = new AudioContext();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine'; osc.frequency.value = 440; gain.gain.value = 0.15; osc.connect(gain).connect(ctx.destination); osc.start();
			setTimeout(() => { osc.stop(); ctx.close(); }, 1200);
		} else {
			try { testToneRef.current.currentTime = 0; testToneRef.current.play(); } catch {}
		}
	};

	const manualCheck = async () => {
		setError(null); setStatus('checking');
		const r = await api?.app?.checkForUpdate();
		if (r?.error) { setStatus('error'); setError(r.error); }
		else {
			setInfo(r.release || r);
			setStatus(r.hasUpdate ? 'update-available' : 'up-to-date');
		}
	};
	const startDownload = async () => { setError(null); setStatus('starting-download'); const r = await api?.app?.startUpdateDownload(); if (r?.error) { setStatus('error'); setError(r.error); } };
	const installNow = async () => { await api?.app?.quitAndInstall(); };


	return (
		<div className="flex flex-1 flex-col p-8 text-gray-200 overflow-auto bg-gray-950">
			<h1 className="text-2xl font-semibold mb-6"><span className="bg-gradient-to-br from-sky-400 to-violet-600 bg-clip-text text-transparent">Settings</span></h1>
			<div className="space-y-6 max-w-xl">
				<section className="bg-gray-900/60 border border-gray-800 rounded-lg p-5">
					<h2 className="text-sm font-semibold tracking-wide text-gray-300 mb-3">Application</h2>
					<div className="text-xs text-gray-400 mb-4">Current Version: <span className="text-gray-200 font-medium">{version || '—'}</span></div>
					<div className="flex gap-3 flex-wrap mb-4">
						<button onClick={manualCheck} disabled={status==='checking'} className="px-4 py-2 rounded-md bg-gradient-to-br from-sky-400 to-violet-600 text-white text-xs font-medium shadow hover:from-sky-300 hover:to-violet-500 disabled:opacity-40">{status==='checking' ? 'Checking…' : 'Check for Updates'}</button>
						{status==='update-available' && <button onClick={startDownload} className="px-4 py-2 rounded-md bg-gray-800 border border-sky-500/40 text-xs font-medium hover:bg-gray-700">Download Update</button>}
						{status==='downloaded' && <button onClick={installNow} className="px-4 py-2 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500">Install & Restart</button>}
					</div>
					<div className="text-[11px] text-gray-400 space-y-1">
						<div>Status: <span className="text-gray-300">{status}</span></div>
						{progress && status==='downloading' && (
							<div className="w-full bg-gray-800 rounded h-2 overflow-hidden">
								<div className="bg-gradient-to-r from-sky-400 to-violet-600 h-full transition-all" style={{width: `${Math.round(progress.percent||0)}%`}} />
							</div>
						)}
						{info?.releaseNotes && status!=='downloading' && (
							<details className="bg-gray-800/60 rounded p-3 border border-gray-700">
								<summary className="cursor-pointer select-none text-gray-300">Release Notes</summary>
								<pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-gray-400 max-h-60 overflow-auto">{info.releaseNotes}</pre>
							</details>
						)}
						{error && <div className="text-red-400 whitespace-pre-wrap">{error}</div>}
					</div>
				</section>
				<section className="bg-gray-900/60 border border-gray-800 rounded-lg p-5">
					<h2 className="text-sm font-semibold tracking-wide text-gray-300 mb-3">Voice</h2>
					<div className="space-y-4 text-xs text-gray-300">
						<div>
							<label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Input Device</label>
							<select value={selectedDevice} onChange={e => onSelectDevice(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-sky-400">
								<option value="">Default</option>
								{devices.filter(d=>d.kind==='audioinput').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
							</select>
						</div>
						<div>
							<label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Output Device</label>
							<select value={selectedOutput} onChange={e => onSelectOutput(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs focus:outline-none focus:border-sky-400">
								<option value="">System Default</option>
								{devices.filter(d=>d.kind==='audiooutput').map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
							</select>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Mic Gain ({inputGain.toFixed(2)}x)</label>
								<input type="range" min={0.2} max={2} step={0.05} value={inputGain} onChange={e=> onInputGain(Number(e.target.value))} className="w-full" />
							</div>
							<div>
								<label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Output Volume ({outputGain.toFixed(2)}x)</label>
								<input type="range" min={0} max={2} step={0.05} value={outputGain} onChange={e=> onOutputGain(Number(e.target.value))} className="w-full" />
							</div>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<label className="flex items-center gap-2 cursor-pointer">
								<button type="button" onClick={toggleAutoJoin} className={`w-9 h-5 rounded-full relative transition ${autoJoin ? 'bg-emerald-500/70' : 'bg-gray-700'}`}>
									<span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-gray-900 transition ${autoJoin ? 'translate-x-4' : ''}`}></span>
								</button>
								<span className="text-[11px] text-gray-400">Auto Join Lobby</span>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<button type="button" onClick={toggleEcho} className={`w-9 h-5 rounded-full relative transition ${echoCancellation ? 'bg-emerald-500/70' : 'bg-gray-700'}`}>
									<span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-gray-900 transition ${echoCancellation ? 'translate-x-4' : ''}`}></span>
								</button>
								<span className="text-[11px] text-gray-400">Echo Cancel</span>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<button type="button" onClick={toggleNoise} className={`w-9 h-5 rounded-full relative transition ${noiseSuppression ? 'bg-emerald-500/70' : 'bg-gray-700'}`}>
									<span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-gray-900 transition ${noiseSuppression ? 'translate-x-4' : ''}`}></span>
								</button>
								<span className="text-[11px] text-gray-400">Noise Suppress</span>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<button type="button" onClick={toggleAgc} className={`w-9 h-5 rounded-full relative transition ${autoGainControl ? 'bg-emerald-500/70' : 'bg-gray-700'}`}>
									<span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-gray-900 transition ${autoGainControl ? 'translate-x-4' : ''}`}></span>
								</button>
								<span className="text-[11px] text-gray-400">Auto Gain</span>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<button type="button" onClick={toggleAutoConnectInGame} className={`w-9 h-5 rounded-full relative transition ${autoConnectInGame ? 'bg-emerald-500/70' : 'bg-gray-700'}`}>
									<span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-gray-900 transition ${autoConnectInGame ? 'translate-x-4' : ''}`}></span>
								</button>
								<span className="text-[11px] text-gray-400">Auto Connect In-Game</span>
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<button type="button" onClick={toggleAutoLeavePostGame} className={`w-9 h-5 rounded-full relative transition ${autoLeavePostGame ? 'bg-emerald-500/70' : 'bg-gray-700'}`}>
									<span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-gray-900 transition ${autoLeavePostGame ? 'translate-x-4' : ''}`}></span>
								</button>
								<span className="text-[11px] text-gray-400">Leave Post-Game</span>
							</label>
						</div>
						<div className="flex items-center gap-3 pt-2">
							<button type="button" onClick={playTestTone} className="px-3 py-1.5 rounded bg-gray-800 border border-gray-700 text-[11px] hover:bg-gray-700">Test Tone</button>
							<p className="text-[10px] text-gray-500">Plays a short 440Hz tone to verify output path.</p>
						</div>
						<p className="text-[11px] text-gray-500 leading-relaxed">Auto-join will attempt to connect you automatically when a voice-enabled lobby is detected. You can disable to receive a join prompt instead.</p>
					</div>
				</section>
			</div>
		</div>
	);
};

// Champions Listing Page
const ChampionsPage: React.FC = () => {
	const navigate = useNavigate();
	const [version, setVersion] = React.useState('14.16.1');
	const [champions, setChampions] = React.useState<ChampionMeta[]>([]);
	const [filter, setFilter] = React.useState('');
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		(async () => {
			try {
				setLoading(true);
				const vRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
				if (vRes.ok) { const vs: string[] = await vRes.json(); if (vs.length) setVersion(vs[0]); }
				const cRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`);
				if (!cRes.ok) { setError('Failed to load champions'); }
				else {
					const json = await cRes.json();
					setChampions(Object.values(json.data || {}) as any);
				}
			} catch (e:any) { setError(e.message || 'Error'); }
			finally { setLoading(false); }
		})();
	}, []);

	const filtered = React.useMemo(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return champions;
		return champions.filter(c => c.name.toLowerCase().includes(q));
	}, [filter, champions]);

		return (
			<div className="flex flex-1 flex-col p-6 text-gray-200 overflow-auto bg-gray-950">
			<div className="flex items-center justify-between mb-4">
				<h1 className="text-2xl font-semibold"><span className="bg-gradient-to-br from-sky-400 to-violet-600 bg-clip-text text-transparent">Champions</span></h1>
				<input
					value={filter}
					onChange={e => setFilter(e.target.value)}
					placeholder="Filter"
					className="px-3 py-1.5 text-sm rounded-md bg-gray-900 border border-gray-800 focus:border-sky-400 focus:outline-none"
				/>
			</div>
			{loading && <div className="text-sm text-gray-400">Loading…</div>}
			{error && <div className="text-sm text-red-400 whitespace-pre-wrap mb-4">{error}</div>}
			{!loading && !error && (
				<div className="grid gap-4 auto-rows-fr" style={{gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))'}}>
					{filtered.map(c => (
						<button
							key={c.id}
							type="button"
							onClick={() => navigate(`/champion/${encodeURIComponent(c.id)}`)}
							className="group flex flex-col items-center gap-2 p-3 rounded-lg bg-gray-900/60 border border-gray-800 hover:border-sky-500/50 hover:bg-gray-900 transition"
						>
							<div className="w-20 h-20 rounded-md overflow-hidden bg-gray-800">
								<img src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.image.full}`} alt={c.name} className="w-full h-full object-cover group-hover:scale-[1.05] transition" />
							</div>
							<span className="text-xs font-medium text-gray-300 text-center leading-tight">{c.name}</span>
							<span className="text-[10px] text-gray-500 line-clamp-1">{c.tags.join(', ')}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
};

const TitleBar: React.FC = () => {
	const [max, setMax] = React.useState(false);
	const api: any = (window as any).api;
	const { phase } = useTeamMateVoice();
	const voice = useVoice();
	const toggleMax = async () => {
		if (!api?.windowControls) return;
		const state = await api.windowControls.maximize();
		setMax(state);
	};
	function phaseLabel(p?: string) {
		if (!p) return 'Idle';
		if (p === 'ChampSelect') return 'Champ Select';
		if (p === 'InProgress') return 'In Game';
		if (p === 'EndOfGame') return 'Post Game';
		return p;
	}
	const pillColor = !phase ? 'bg-gray-800 text-gray-400' : (
		phase === 'Lobby' ? 'bg-sky-600/70 text-sky-100' :
		phase === 'ChampSelect' ? 'bg-violet-600/70 text-violet-100' :
		phase === 'InProgress' ? 'bg-emerald-600/70 text-emerald-100' :
		phase === 'EndOfGame' ? 'bg-amber-600/70 text-amber-100' : 'bg-gray-700 text-gray-200'
	);
	return (
		<div className="h-9 flex items-center justify-between pl-3 pr-1 select-none bg-gray-900 border-b border-gray-800 drag relative">
			<div className="flex items-center gap-3 text-xs tracking-wide font-semibold text-gray-300">
				<span className={`px-2 py-0.5 rounded-md text-[10px] font-medium leading-none border border-gray-700/60 no-drag ${pillColor}`}>{phaseLabel(phase)}</span>
				{voice.state.connected && (
					<span className="px-2 py-0.5 rounded-md text-[10px] font-medium leading-none bg-emerald-600/70 text-emerald-50 border border-emerald-500/40 no-drag">Voice Live</span>
				)}
			</div>
			<div className="flex items-center gap-4 no-drag pr-2">
				<div className="flex items-center gap-1">
					<button onClick={() => api?.windowControls?.minimize()} className="w-9 h-7 grid place-content-center rounded hover:bg-gray-800 text-gray-400 hover:text-sky-400" aria-label="Minimize">&#x2212;</button>
					<button onClick={toggleMax} className="w-9 h-7 grid place-content-center rounded hover:bg-gray-800 text-gray-400 hover:text-sky-400" aria-label="Maximize">{max ? '🗗' : '🗖'}</button>
					<button onClick={() => api?.windowControls?.close()} className="w-9 h-7 grid place-content-center rounded hover:bg-red-600/80 text-gray-300 hover:text-white" aria-label="Close">&#x2715;</button>
				</div>
			</div>
		</div>
	);
};

// Inject scrollbar styles once
const ScrollbarStyles: React.FC = () => (
	<style>{`/* Scrollbars */
	* { scrollbar-width: thin; scrollbar-color: #334155 #0f172a; }
	*::-webkit-scrollbar { width: 10px; height:10px; }
	*::-webkit-scrollbar-track { background: #0f172a; }
	*::-webkit-scrollbar-thumb { background: linear-gradient(180deg,#38bdf8,#7c3aed); border-radius: 6px; border:2px solid #0f172a; }
	*::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg,#7dd3fc,#a78bfa); }
	.drag { -webkit-app-region: drag; }
	.no-drag { -webkit-app-region: no-drag; }
	`}</style>
);

const App: React.FC = () => {
	const Router: any = isElectron ? HashRouter : BrowserRouter;
	return (
	<Router>
		<ScrollbarStyles />
		<div className="flex flex-col h-screen w-full overflow-hidden">
			<TitleBar />
			<div className="flex flex-1 min-h-0">
				<Sidebar />
				<div className="flex-1 min-h-0 overflow-auto">
					<Routes>
						<Route path="/" element={<SearchPage />} />
						<Route path="/profile/:riotId/:tagLine" element={<ProfilePage />} />
						<Route path="/champion/:champId" element={<ChampionPage />} />
						<Route path="/settings" element={<SettingsPage />} />
						<Route path="/champions" element={<ChampionsPage />} />
						<Route path="*" element={<SearchPage />} />
					</Routes>
				</div>
			</div>
		</div>
	</Router>
	);
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: any }> {
	constructor(props: any) { super(props); this.state = { error: null }; }
	static getDerivedStateFromError(error: any) { return { error }; }
	componentDidCatch(error: any, info: any) { console.error('[Renderer ErrorBoundary]', error, info); }
	render() {
		if (this.state.error) {
			return <div style={{padding:40,fontFamily:'monospace',color:'#f87171'}}>
				<h2>Renderer Error</h2>
				<pre style={{whiteSpace:'pre-wrap'}}>{String(this.state.error?.message||this.state.error)}</pre>
				<p>Check DevTools console for stack trace.</p>
			</div>;
		}
		return this.props.children as any;
	}
}

console.log('[ArenaBuddy] mounting renderer, isElectron=', isElectron);
const rootEl = document.getElementById('root');
if (!rootEl) {
	document.body.innerHTML = '<pre style="color:#f87171">Root element not found</pre>';
} else {
			ReactDOM.createRoot(rootEl).render(
				<ErrorBoundary>
					<ToastProvider>
						<DataDragonProvider>
							<SummonerProvider>
																<VoiceProvider>
																	<TeamMateVoiceProvider>
																		<App />
																	</TeamMateVoiceProvider>
																</VoiceProvider>
							</SummonerProvider>
						</DataDragonProvider>
					</ToastProvider>
				</ErrorBoundary>
			);
}
