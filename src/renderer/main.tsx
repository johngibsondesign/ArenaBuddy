import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { Sidebar } from './components/Sidebar/Sidebar';
import './index.css';

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
			<form
				className="w-full max-w-xl flex flex-col items-stretch gap-6"
				onSubmit={onSubmit}
			>
				<div className="text-center">
					<h1 className="text-3xl font-semibold bg-gradient-to-br from-sky-400 to-violet-600 bg-clip-text text-transparent">Search Summoner</h1>
					<p className="mt-2 text-sm text-gray-500">Enter Riot ID and Tag (e.g. I Skada#2606 or I Skada #2606).</p>
				</div>
				<div className="flex gap-3">
					<div className="relative flex-1">
						<input
							value={query}
							onChange={e => setQuery(e.target.value)}
							type="text"
							placeholder="RiotID#TAG or Champion"
							className="w-full rounded-md bg-gray-900 border border-gray-800 focus:border-sky-400 focus:ring-2 focus:ring-violet-600/40 outline-none px-4 py-3 text-sm placeholder-gray-500 transition"
						/>
						{showSug && filtered.length > 0 && (
							<ul className="absolute z-20 left-0 right-0 top-full mt-1 max-h-64 overflow-auto rounded-md border border-gray-800 bg-gray-900 shadow-lg text-sm">
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
		setLoading(true); setError(null); setData(null);
		(async () => {
			try {
				if (hasBridge) {
					const bridge = (window as any).api;
					const res = await bridge.searchSummoner(q);
					if (!res || !res.ok) setError(res?.error || 'Lookup failed'); else setData(res);
				} else {
					const params = new URLSearchParams({ q });
						const res = await fetch(`http://localhost:${(window as any).__DEV_API_PORT__ || 5174}/api/riot/search?${params}`);
						const json = await res.json();
						if (!json.ok) setError(json.error || 'Lookup failed'); else setData(json);
				}
			} catch (e:any) { setError(e.message || 'Error'); }
			finally { setLoading(false); }
		})();
	}, [riotId, tagLine]);

	return (
		<div className="flex flex-1 flex-col p-8 text-gray-200 overflow-auto bg-gray-950">
				<div className="flex items-center justify-between mb-6">
					<h1 className="text-2xl font-semibold"><span className="bg-gradient-to-br from-sky-400 to-violet-600 bg-clip-text text-transparent">Profile</span></h1>
					<BackButton />
				</div>
			{loading && <div className="text-sm text-gray-400">Loading…</div>}
			{error && <div className="text-sm text-red-400 whitespace-pre-wrap mb-4">{error}</div>}
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
	const toggleMax = async () => {
		if (!api?.windowControls) return;
		const state = await api.windowControls.maximize();
		setMax(state);
	};
	return (
		<div className="h-9 flex items-center justify-between pl-3 pr-1 select-none bg-gray-900 border-b border-gray-800 drag">
			<div className="text-xs tracking-wide font-semibold text-gray-300"></div>
			<div className="flex items-center gap-1 no-drag">
				<button onClick={() => api?.windowControls?.minimize()} className="w-9 h-7 grid place-content-center rounded hover:bg-gray-800 text-gray-400 hover:text-sky-400" aria-label="Minimize">&#x2212;</button>
				<button onClick={toggleMax} className="w-9 h-7 grid place-content-center rounded hover:bg-gray-800 text-gray-400 hover:text-sky-400" aria-label="Maximize">{max ? '🗗' : '🗖'}</button>
				<button onClick={() => api?.windowControls?.close()} className="w-9 h-7 grid place-content-center rounded hover:bg-red-600/80 text-gray-300 hover:text-white" aria-label="Close">&#x2715;</button>
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

const App: React.FC = () => (
	<BrowserRouter>
		<ScrollbarStyles />
		<div className="flex flex-col h-screen w-full overflow-hidden">
			<TitleBar />
			<div className="flex flex-1">
				<Sidebar />
				<Routes>
					<Route path="/" element={<SearchPage />} />
					<Route path="/profile/:riotId/:tagLine" element={<ProfilePage />} />
					<Route path="/champion/:champId" element={<ChampionPage />} />
					<Route path="/champions" element={<ChampionsPage />} />
				</Routes>
			</div>
		</div>
	</BrowserRouter>
);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
