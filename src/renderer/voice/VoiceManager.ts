import { rtcConfig, SignalingMessage, VoiceStateSnapshot, PeerParticipant } from './config';
// Supabase client (runtime dependency). If types missing, declare minimal interfaces.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

type Listener = (s: VoiceStateSnapshot) => void;

export class VoiceManager {
  private ws: WebSocket | null = null; // legacy / fallback signaling
  private supabase: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private pc: RTCPeerConnection | null = null; // legacy single peer id="legacy"
  private peers: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;
  private outputDeviceId?: string;
  private inputGainNode?: GainNode;
  private outputGain = 1;
  private inputGain = 1;
  private inputAudioCtx?: AudioContext;
  private speakingLastValue = false;
  private speakingLastSent = 0;
  private presenceSet: Set<string> = new Set();
  private processing = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  private listeners = new Set<Listener>();
  private state: VoiceStateSnapshot = { connected: false, connecting: false, muted: false, deafened: false, pushToTalk: false, participants: [], selfId: '' };
  private lobbyId?: string;
  private selfId: string = crypto.randomUUID();
  private pendingMeta: any = null;
  private metaFlushTimer: any = null;
  private identity: { name?: string; iconId?: number; riotId?: string; tagLine?: string } = {};
  private pendingIce: Record<string, any[]> = {};
  private lastMetaSent?: string; // to avoid flooding identical metadata
  private negotiationWatchdogs: Record<string, any> = {};
  private candidateStats: Record<string, { count: number; types: Record<string, number>; timer?: any; gathering?: string }> = {};
  private inboundWatchdogs: Record<string, any> = {};
  private metadataCounts: Record<string, number> = {};

  private isInitiator(remoteId: string) {
    // Deterministic ordering rule; if equal (should never) fall back to comparing lengths
    if (this.selfId === remoteId) return false;
    if (this.selfId < remoteId) return true;
    return false;
  }

  private scheduleNegotiation(remoteId: string, reason: string, delay = 150) {
    const pc = this.getOrCreatePeer(remoteId);
    const initiator = this.isInitiator(remoteId);
    this.vlog('scheduleNegotiation', { remoteId, reason, initiator, delay, signalingState: pc.signalingState });
    if (!initiator) return; // only initiator actively schedules
    setTimeout(() => {
      // Only start offer if still needed
      const haveLocal = !!pc.currentLocalDescription; const haveRemote = !!pc.currentRemoteDescription;
      if (haveLocal || haveRemote) return;
      if (pc.signalingState === 'stable') {
        this.ensureSendTrack(remoteId);
        this.startOffer(remoteId).catch(e => this.vlog('scheduleNegotiation offer error', (e as any)?.message));
      } else {
        this.vlog('scheduleNegotiation skip (not stable)', { remoteId, state: pc.signalingState });
      }
    }, delay + Math.floor(Math.random()*120)); // jitter to reduce glare risk
  }
  // Debug helpers (enable with localStorage.setItem('voice.debugVoice','1'))
  private debugVoiceEnabled() { try { return localStorage.getItem('voice.debugVoice') === '1'; } catch { return false; } }
  private vlog(...args: any[]) { if (this.debugVoiceEnabled()) { try { console.log('[Voice]', ...args); } catch {} } }

  on(l: Listener) { this.listeners.add(l); l(this.state); return () => this.listeners.delete(l); }
  private emit() { for (const l of this.listeners) l({ ...this.state }); }
  private patch(p: Partial<VoiceStateSnapshot>) { this.state = { ...this.state, ...p }; this.emit(); }

  async initDevices(audioDeviceId?: string, outputDeviceId?: string) {
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
          echoCancellation: this.processing.echoCancellation,
          noiseSuppression: this.processing.noiseSuppression,
          autoGainControl: this.processing.autoGainControl
        },
        video: false
      });
  this.vlog('initDevices acquired localStream', this.localStream.getTracks().map(t => ({ kind: t.kind, id: t.id })));
      // Input gain path
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(this.localStream);
      this.inputGainNode = ctx.createGain();
      this.inputGainNode.gain.value = this.inputGain;
      src.connect(this.inputGainNode); // no local monitor to avoid echo
  this.setupSpeakingDetection();
      try { navigator.mediaDevices.addEventListener('devicechange', this.handleDeviceChange); } catch {}
    }
    this.outputDeviceId = outputDeviceId;
    return this.localStream;
  }

  private handleDeviceChange = async () => {
    // If current input device disappeared, re-acquire default
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    if (!audioInputs.find(d => d.deviceId === this.state.inputDeviceId)) {
      const fallback = audioInputs[0];
      if (fallback) this.setInputDevice(fallback.deviceId);
    }
  };

  setInputGain(v: number) { this.inputGain = v; if (this.inputGainNode) this.inputGainNode.gain.value = v; this.patch({ inputGain: v }); }
  setOutputGain(v: number) { this.outputGain = v; this.patch({ outputGain: v }); this.updateParticipantVolumes(); }
  setOutputDevice(id: string) { this.outputDeviceId = id; this.patch({ outputDeviceId: id }); this.updateOutputDevice(); }
  async setInputDevice(id: string) {
    this.patch({ inputDeviceId: id });
    try {
  const newStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id }, echoCancellation: this.processing.echoCancellation, noiseSuppression: this.processing.noiseSuppression, autoGainControl: this.processing.autoGainControl }, video: false });
      const old = this.localStream; this.localStream = newStream;
      // Replace tracks on each peer
      const newAudioTrack = newStream.getAudioTracks()[0];
      const replaceInPc = (pc: RTCPeerConnection | null) => {
        if (!pc) return;
        pc.getSenders().filter(s => s.track && s.track.kind === 'audio').forEach(s => { try { s.replaceTrack(newAudioTrack); } catch {} });
      };
      replaceInPc(this.pc);
      this.peers.forEach(pc => replaceInPc(pc));
      // Stop old tracks
      old?.getTracks().forEach(t => { try { t.stop(); } catch {} });
      // Recreate input gain + speaking detection
      if (this.inputAudioCtx) { try { this.inputAudioCtx.close(); } catch {} }
      this.setupInputProcessing();
      // Optionally send metadata update
  this.queueMeta({ muted: this.state.muted });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[Voice] input device switch failed', e);
    }
  }

  private updateParticipantVolumes() {
    this.state.participants.forEach(p => { const el: HTMLAudioElement | undefined = (p as any)._el; if (el) el.volume = (p.volume ?? 1) * this.outputGain; });
  }
  private async updateOutputDevice() {
    if (!('setSinkId' in HTMLMediaElement.prototype)) return;
    this.state.participants.forEach(p => { const el: any = (p as any)._el; if (el && this.outputDeviceId && typeof el.setSinkId === 'function') { try { el.setSinkId(this.outputDeviceId); } catch {} } });
  }

  async connect(lobbyId: string, signalingUrl: string, meta?: { name?: string; iconId?: number; riotId?: string; tagLine?: string }) {
    if (this.state.connected || this.state.connecting) return;
  this.lobbyId = lobbyId;
  this.vlog('connect requested', { lobbyId, signalingUrl, meta });
  this.patch({ connecting: true, error: null, lobbyId, selfId: this.selfId });
    try {
      // Ensure we have local media before negotiating
      if (!this.localStream) {
        try { await this.initDevices(); } catch (e) { this.vlog('initDevices failed before connect', (e as any)?.message); }
      }
      // store identity for later re-broadcast
      if (meta) this.identity = { ...this.identity, ...meta };
      // Add self participant entry if missing (for UI controls)
      if (!this.state.participants.find(p => p.id === this.selfId)) {
        (this.state.participants as any).push({ id: this.selfId, name: meta?.name, iconId: meta?.iconId, riotId: meta?.riotId, tagLine: meta?.tagLine, muted: this.state.muted });
        this.emit();
      }
  if (signalingUrl.startsWith('supabase://')) {
        await this.initSupabase(signalingUrl, lobbyId, meta);
      } else {
        this.ws = new WebSocket(signalingUrl);
        this.ws.onmessage = (ev) => this.handleSignal(JSON.parse(ev.data));
    this.ws.onopen = () => { this.vlog('ws open'); this.send({ type: 'metadata', name: meta?.name, iconId: meta?.iconId, riotId: meta?.riotId, tagLine: meta?.tagLine }); };
    this.ws.onerror = (e: any) => { this.vlog('ws error', e?.message); this.patch({ error: e.message || 'Signaling error' }); };
    this.ws.onclose = () => { this.vlog('ws close'); this.cleanup('closed'); };
      }
  } catch (e: any) { this.vlog('connect error', e); this.patch({ error: e.message || 'Failed to connect signaling', connecting: false }); }
  }

  private async initSupabase(_url: string, lobbyId: string, meta?: { name?: string; iconId?: number; riotId?: string; tagLine?: string }) {
    const projectUrl = (window as any).SUPABASE_URL || (import.meta as any).env?.VITE_SUPABASE_URL || (process as any).env?.SUPABASE_URL;
    const anonKey = (window as any).SUPABASE_ANON_KEY || (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || (process as any).env?.SUPABASE_ANON_KEY;
    if (!projectUrl || !anonKey) throw new Error('Missing Supabase configuration');
    this.supabase = createClient(projectUrl, anonKey, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 10 } } });
  // Optional channel name hashing to reduce easy enumeration
  const salt = (import.meta as any).env?.VITE_VOICE_SALT || (window as any).VITE_VOICE_SALT;
  const channelName = salt ? `voice_${await this.hashChannel(lobbyId, salt)}` : `voice_${lobbyId}`;
    this.vlog('initSupabase channel', { channelName, lobbyId, saltPresent: !!salt });
    this.channel = this.supabase.channel(channelName, { config: { presence: { key: this.selfId } } });
    this.channel.on('broadcast', { event: 'signal' }, (arg: any) => { const payload = arg?.payload; if (!payload || payload.from === this.selfId) return; this.handleSignal(payload); });
    this.channel.on('presence', { event: 'sync' }, () => {
      const presenceState: any = this.channel?.presenceState() || {};
      const others = Object.keys(presenceState).filter(k => k !== this.selfId);
      this.vlog('presence sync', { others, count: others.length });
      const newSet = new Set(others);
      // removed peers
      this.presenceSet.forEach(id => { if (!newSet.has(id)) this.removePeer(id); });
      // new peers
      others.forEach(r => {
        if (!this.presenceSet.has(r)) {
          const pc = this.getOrCreatePeer(r);
          // Deterministic initiator rule prevents double offer (glare): lexicographically smaller id starts
          const initiator = this.selfId < r;
          if (initiator && pc.signalingState === 'stable') {
            this.vlog('presence initiator will offer', { peer: r });
            this.scheduleNegotiation(r, 'presence-new-peer', 60);
          } else {
            this.vlog('defer offer (waiting for remote)', { peer: r, initiator, signalingState: pc.signalingState });
            // Still schedule a watchdog in case remote never sends an offer
            this.scheduleNegotiation(r, 'presence-watchdog', 1200);
          }
        }
      });
      this.presenceSet = newSet;
    });
    await this.channel.subscribe((s: any) => {
      if (s === 'SUBSCRIBED') {
  try { this.channel?.track({ online: true }); this.vlog('presence track sent'); } catch (e) { this.vlog('presence track error', (e as any)?.message); }
  this.queueMeta({ name: meta?.name, iconId: meta?.iconId, riotId: meta?.riotId, tagLine: meta?.tagLine, muted: this.state.muted });
        // If we're alone initially, clear connecting state so UI doesn't show perpetual connecting...
        if (this.state.connecting) {
          this.patch({ connecting: false });
        }
        this.vlog('channel subscribed');
      }
    });
  }

  private createPeer() { // legacy
    this.pc = new RTCPeerConnection(rtcConfig);
    if (this.localStream) this.localStream.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!));
  this.pc.onicecandidate = (e) => { if (e.candidate) this.send({ type: 'candidate', candidate: e.candidate } as any); };
    this.pc.ontrack = (e) => this.attachStream('legacy', e.streams[0]);
  }

  private getOrCreatePeer(id: string) {
    if (id === 'legacy') { if (!this.pc) this.createPeer(); return this.pc!; }
    if (this.peers.has(id)) return this.peers.get(id)!;
    const pc = new RTCPeerConnection(rtcConfig); this.peers.set(id, pc);
    // Pre-emptively add an audio transceiver so that an offer includes audio even if track delayed
    try { if (!this.localStream) pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch {}
    if (this.localStream) this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream!));
  else this.vlog('no localStream when creating peer; delaying track add', { peer: id });
  pc.onicecandidate = (e) => { if (e.candidate) this.send({ type: 'candidate', candidate: e.candidate, to: id } as any); };
    pc.ontrack = (e) => {
      this.vlog('ontrack', { peer: id, streams: e.streams.length, trackId: e.track.id, kind: e.track.kind, muted: (e as any).track?.muted });
      this.attachStream(id, e.streams[0]);
    };
    pc.onicegatheringstatechange = () => {
      this.vlog('iceGatheringState', { peer: id, state: pc.iceGatheringState });
      if (!this.candidateStats[id]) this.candidateStats[id] = { count: 0, types: {} };
      this.candidateStats[id].gathering = pc.iceGatheringState;
      if (pc.iceGatheringState === 'complete') this.flushCandidateStats(id, 'gathering-complete');
    };
    pc.onnegotiationneeded = () => { this.vlog('negotiationneeded', { peer: id, signalingState: pc.signalingState }); };
    // If we are initiator and negotiationneeded fires before we created an offer, schedule negotiation
    pc.onnegotiationneeded = () => {
      this.vlog('negotiationneeded', { peer: id, signalingState: pc.signalingState });
      if (this.isInitiator(id)) this.scheduleNegotiation(id, 'onnegotiationneeded', 40);
    };
    pc.onsignalingstatechange = () => { this.vlog('signalingState', { peer: id, state: pc.signalingState }); };
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      this.vlog('iceConnectionState', { peer: id, state: st });
      if (st === 'failed' || st === 'disconnected') {
        // Attempt quick renegotiation once
        setTimeout(() => {
          if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            try { this.startOffer(id); } catch {/* ignore */}
          }
        }, 800);
      }
    };
  (pc as any).onicecandidateerror = (e: any) => { this.vlog('icecandidateerror', { peer: id, error: e?.errorText || e?.message }); };
    pc.onconnectionstatechange = () => { this.vlog('connectionState', { peer: id, state: pc.connectionState }); };
    this.vlog('created peer', { peer: id });
  // Ensure we actually have a sending audio track (avoid cases where getUserMedia failed silently)
  setTimeout(() => this.ensureSendTrack(id), 250);
    // If no candidates at all after 4s, attempt ICE restart (maybe network blocked) and renegotiate
    setTimeout(() => {
      const stats = this.candidateStats[id];
      if (!this.peers.has(id)) return; // peer removed
      if (!stats || stats.count === 0) {
        this.vlog('no-candidates-timeout', { peer: id, action: 'restartIce+renegotiate' });
        try { pc.restartIce(); } catch {}
        this.scheduleNegotiation(id, 'no-candidates-timeout', 150);
      }
    }, 4000);
    // Periodic inbound audio stats (every 5s) for this peer
    const statsInterval = setInterval(async () => {
      if (!this.peers.has(id)) { clearInterval(statsInterval); return; }
      try {
        const stats = await pc.getStats();
    let inbound: any = null; let outbound: any = null;
    stats.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') inbound = r; else if (r.type === 'outbound-rtp' && r.kind === 'audio') outbound = r; });
    if (inbound) this.vlog('inbound-audio-stats', { peer: id, bytes: inbound.bytesReceived, packets: inbound.packetsReceived, jitter: inbound.jitter, packetsLost: inbound.packetsLost });
    if (outbound) this.vlog('outbound-audio-stats', { peer: id, bytes: outbound.bytesSent, packets: outbound.packetsSent });
        // Watchdog: if after 10s we have outbound bytes but still zero inbound, attempt ICE restart (initiator only)
        if (outbound && outbound.bytesSent > 0 && (!inbound || inbound.bytesReceived === 0)) {
          if (!this.inboundWatchdogs[id]) {
            this.inboundWatchdogs[id] = setTimeout(() => {
              const pc2 = this.peers.get(id);
              if (!pc2) return; // removed
              let inbound2: any = null; let outbound2: any = null;
              pc2.getStats().then(st2 => {
                st2.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') inbound2 = r; else if (r.type === 'outbound-rtp' && r.kind === 'audio') outbound2 = r; });
                if (outbound2 && outbound2.bytesSent > 0 && (!inbound2 || inbound2.bytesReceived === 0)) {
                  if (this.isInitiator(id)) {
                    this.vlog('audio watchdog triggering ICE restart', { peer: id });
                    try { pc2.restartIce(); } catch {}
                    // Schedule renegotiation
                    this.scheduleNegotiation(id, 'watchdog-restart', 200);
                  }
                }
                delete this.inboundWatchdogs[id];
              }).catch(() => { delete this.inboundWatchdogs[id]; });
            }, 10000);
          }
        }
      } catch {}
    }, 5000);
    return pc;
  }

  private attachStream(id: string, stream: MediaStream) {
    let participant = this.state.participants.find(p => p.id === id);
    if (!participant) { participant = { id } as PeerParticipant; this.state.participants.push(participant); }
    participant.stream = stream;
    let el: HTMLAudioElement | undefined = (participant as any)._el;
    if (!el) {
      el = new Audio();
      el.autoplay = true;
  try { el.setAttribute('playsinline', 'true'); } catch {}
      el.srcObject = stream;
      el.volume = (participant.volume ?? 1) * this.outputGain;
      (participant as any)._el = el;
      if (this.outputDeviceId && (el as any).setSinkId) { try { (el as any).setSinkId(this.outputDeviceId); } catch {} }
      const playAttempt = () => {
        const p = el!.play();
        if (p && typeof p.then === 'function') {
          p.then(() => { this.vlog('audio play ok', { peer: id }); })
           .catch(err => { this.vlog('audio play blocked', { peer: id, err: err?.message }); });
        }
      };
      // Delay slightly to ensure track is ready
      setTimeout(playAttempt, 50);
    }
    // Log track settings
    try {
      const audioTracks = stream.getAudioTracks();
      audioTracks.forEach(t => this.vlog('remote track info', { peer: id, id: t.id, enabled: t.enabled, muted: (t as any).muted, readyState: (t as any).readyState, settings: (t as any).getSettings?.() }));
    } catch {}
    this.emit();
  }

  private async handleSignal(msg: any) {
    const from = msg.from || 'remote';
  if (msg.to && msg.to !== this.selfId) return; // directed elsewhere
  this.vlog('handleSignal', { type: msg.type, from, to: msg.to });
    switch (msg.type) {
      case 'offer': {
        const pc = this.getOrCreatePeer(from);
        if (pc.signalingState !== 'stable') {
          // Glare: both sides created an offer. Rollback and accept remote.
          try {
            this.vlog('offer glare detected - rolling back', { from, state: pc.signalingState });
            await pc.setLocalDescription({ type: 'rollback' } as any);
          } catch {}
        }
        await pc.setRemoteDescription(msg.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
  this.send({ type: 'answer', sdp: ans, to: from } as any);
        this.patch({ connected: true, connecting: false });
    this.vlog('answer sent', { to: from });
        // Flush any queued ICE for this peer now that remote description is set
        if (this.pendingIce[from]?.length) {
          const queued = this.pendingIce[from];
          delete this.pendingIce[from];
          for (const c of queued) {
            try { await pc.addIceCandidate(c); this.vlog('candidate added (flushed)', { from, queued: true }); } catch (e) { this.vlog('candidate error (flushed)', { from, e }); }
          }
        }
        break; }
      case 'answer': {
        const pc = this.getOrCreatePeer(from);
        if (!pc.currentLocalDescription) return;
        await pc.setRemoteDescription(msg.sdp);
        this.patch({ connected: true, connecting: false });
    this.vlog('answer received', { from });
  this.ensureSendTrack(from);
        // Flush queued ICE
        if (this.pendingIce[from]?.length) {
          const queued = this.pendingIce[from];
          delete this.pendingIce[from];
          for (const c of queued) {
            try { await pc.addIceCandidate(c); this.vlog('candidate added (flushed)', { from, queued: true }); } catch (e) { this.vlog('candidate error (flushed)', { from, e }); }
          }
        }
        break; }
      case 'candidate': {
        if (msg.candidate) {
          const pc = this.getOrCreatePeer(from);
          // If remote description not yet set, queue the candidate
          if (!pc.remoteDescription) {
            if (!this.pendingIce[from]) this.pendingIce[from] = [];
            this.pendingIce[from].push(msg.candidate);
            this.vlog('candidate queued', { from, count: this.pendingIce[from].length });
          } else {
            try { await pc.addIceCandidate(msg.candidate); this.vlog('candidate added', { from }); } catch (e) { this.vlog('candidate error', { from, e }); }
          }
          // Track candidate types for diagnostics
          try {
            const cand = msg.candidate.candidate || '';
            const m = cand.match(/ typ ([a-zA-Z0-9]+)/);
            const typ = m ? m[1] : 'unknown';
            if (!this.candidateStats[from]) this.candidateStats[from] = { count: 0, types: {} };
            this.candidateStats[from].count += 1;
            this.candidateStats[from].types[typ] = (this.candidateStats[from].types[typ]||0)+1;
            if (!this.candidateStats[from].timer) {
              this.candidateStats[from].timer = setTimeout(() => this.flushCandidateStats(from, 'timer'), 4000);
            }
          } catch {}
        }
        break; }
      case 'metadata': {
        let participant = this.state.participants.find(p => p.id === from);
        if (!participant) { participant = { id: from } as PeerParticipant; this.state.participants.push(participant); }
        if (msg.name) participant.name = msg.name;
        if (msg.iconId) participant.iconId = msg.iconId;
        if (msg.riotId) participant.riotId = msg.riotId;
        if (msg.tagLine) participant.tagLine = msg.tagLine;
        if (typeof msg.muted === 'boolean') participant.muted = msg.muted;
        if (typeof msg.speaking === 'boolean') participant.speaking = msg.speaking;
        this.emit();
    this.vlog('metadata received', { from, keys: Object.keys(msg).filter(k => !['type','from','to'].includes(k)) });
  // Fallback: attempt negotiation if neither side has exchanged SDP yet
  this.negotiateIfNeeded(from);
        // Aggressive fallback: count metadata messages; if after N (e.g., 5) still no SDP, force offer even if not initiator
        const pc = this.getOrCreatePeer(from);
        this.metadataCounts[from] = (this.metadataCounts[from] || 0) + 1;
        const haveLocal = !!pc.currentLocalDescription; const haveRemote = !!pc.currentRemoteDescription;
        if (!haveLocal && !haveRemote && this.metadataCounts[from] === 5) {
          this.vlog('force-offer-after-metadata-threshold', { from, threshold: 5, initiator: this.isInitiator(from) });
          if (pc.signalingState === 'stable') {
            this.ensureSendTrack(from);
            this.startOffer(from).catch(e => this.vlog('force-offer error', (e as any)?.message));
          }
        }
        // After 10 metadata messages still no SDP -> attempt ICE restart + offer (final fallback)
        if (!haveLocal && !haveRemote && this.metadataCounts[from] === 10) {
          this.vlog('final-fallback-restart+offer', { from });
          try { pc.restartIce(); } catch {}
          if (pc.signalingState === 'stable') this.startOffer(from).catch(e => this.vlog('final-fallback-offer error', (e as any)?.message));
        }
        break; }
      case 'leave': { this.removePeer(from); break; }
    }
  }

  async startOffer(remoteId: string) {
    const pc = this.getOrCreatePeer(remoteId);
    if (pc.signalingState !== 'stable') {
      this.vlog('skip startOffer (not stable)', { to: remoteId, signalingState: pc.signalingState });
      return;
    }
    this.ensureSendTrack(remoteId);
  this.vlog('creating offer', { to: remoteId });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
  this.send({ type: 'offer', sdp: offer, to: remoteId } as any);
  this.vlog('offer sent', { to: remoteId });
  try { this.vlog('localDescription', { type: pc.localDescription?.type, sdpLen: pc.localDescription?.sdp?.length }); } catch {}
  }

  mute(m: boolean) {
    this.state.muted = m; this.localStream?.getAudioTracks().forEach(t => t.enabled = !m);
  this.queueMeta({ muted: m });
    this.emit();
  }
  setProcessing(opts: Partial<{ echoCancellation: boolean; noiseSuppression: boolean; autoGainControl: boolean }>) {
    this.processing = { ...this.processing, ...opts };
    // Try applying constraints directly
    const track = this.localStream?.getAudioTracks()[0];
    if (track && track.applyConstraints) {
      track.applyConstraints({
        echoCancellation: this.processing.echoCancellation,
        noiseSuppression: this.processing.noiseSuppression,
        autoGainControl: this.processing.autoGainControl
      } as any).catch(() => {
        // fallback: reacquire
        if (this.state.inputDeviceId) this.setInputDevice(this.state.inputDeviceId);
      });
    }
    this.patch({});
  }
  deafen(d: boolean) {
    this.state.deafened = d; this.state.participants.forEach(p => p.stream?.getAudioTracks().forEach(t => t.enabled = !d));
    this.emit();
  }

  leave() { this.send({ type: 'leave' }); this.cleanup('leave'); }

  private cleanup(_reason: string) {
    this.ws?.close(); this.ws = null;
    if (this.channel) { try { this.channel.unsubscribe(); } catch {} this.channel = null; }
    this.peers.forEach(pc => pc.close()); this.peers.clear(); this.pc?.close(); this.pc = null;
  this.patch({ connected: false, connecting: false, participants: [], lobbyId: undefined });
  }

  private removePeer(id: string) {
    const pc = this.peers.get(id); if (pc) { pc.close(); this.peers.delete(id); }
    this.state.participants = this.state.participants.filter(p => p.id !== id);
    this.emit();
  }

  private send(msg: Partial<SignalingMessage>) {
    const full = { ...msg, from: this.selfId } as any;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(full));
    if (this.channel) this.channel.send({ type: 'broadcast', event: 'signal', payload: full });
  this.vlog('send', { type: (full as any).type, to: (full as any).to });
  }

  // Ensure an audio track is present for a given peer connection
  private ensureSendTrack(peerId: string) {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    const hasSender = pc.getSenders().some(s => s.track && s.track.kind === 'audio');
    const localTrack = this.localStream?.getAudioTracks()[0];
    if (!hasSender && localTrack) {
      try { pc.addTrack(localTrack, this.localStream!); this.vlog('ensureSendTrack added', { peer: peerId, trackId: localTrack.id }); } catch (e) { this.vlog('ensureSendTrack error', { peer: peerId, err: (e as any)?.message }); }
    }
    if (!localTrack) this.vlog('ensureSendTrack no local audio track', { peer: peerId });
  }

  private async hashChannel(lobbyId: string, salt: string) {
    try {
      const data = new TextEncoder().encode(lobbyId + '::' + salt);
      const digest = await crypto.subtle.digest('SHA-256', data);
      const bytes = Array.from(new Uint8Array(digest));
      return bytes.slice(0, 16).map(b => b.toString(16).padStart(2,'0')).join('');
    } catch {
      return lobbyId; // fallback
    }
  }

  getSelfId() { return this.selfId; }
  getProcessing() { return { ...this.processing }; }

  setParticipantVolume(id: string, volume: number) { const p = this.state.participants.find(p => p.id === id); if (!p) return; p.volume = volume; const el: HTMLAudioElement | undefined = (p as any)._el; if (el) el.volume = Math.min(1, Math.max(0, volume * this.outputGain)); this.emit(); }

  private setupSpeakingDetection() {
    if (!this.localStream) return;
    this.setupInputProcessing();
  }

  private setupInputProcessing() {
    if (!this.localStream) return;
    if (this.inputAudioCtx) { try { this.inputAudioCtx.close(); } catch {} }
    this.inputAudioCtx = new AudioContext();
    const src = this.inputAudioCtx.createMediaStreamSource(this.localStream);
    const analyser = this.inputAudioCtx.createAnalyser(); analyser.fftSize = 256; src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const threshold = 0.035;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (let i=0;i<data.length;i++){ const v = (data[i]-128)/128; sum += v*v; }
      const rms = Math.sqrt(sum/data.length);
      const speaking = rms > threshold && !this.state.muted;
      const now = performance.now();
      if (speaking !== this.speakingLastValue && (now - this.speakingLastSent) > 120) {
        this.speakingLastValue = speaking; this.speakingLastSent = now;
        this.queueMeta({ speaking });
        (this.state as any)._speaking = speaking; this.emit();
      } else if (speaking && (now - this.speakingLastSent) > 1500) { // keep-alive while speaking
        this.speakingLastSent = now; this.queueMeta({ speaking });
      }
      requestAnimationFrame(tick);
    };
    tick();
  }

  private queueMeta(p: any) {
  // Always include stable identity attributes so late joiners learn them
  const identity = this.identity;
  this.pendingMeta = { ...(this.pendingMeta||{}), ...identity, ...p };
    if (!this.metaFlushTimer) {
      this.metaFlushTimer = setTimeout(() => {
        const payload = this.pendingMeta; this.pendingMeta = null; this.metaFlushTimer = null;
        if (payload) {
          const key = JSON.stringify(payload);
          if (key !== this.lastMetaSent) {
            this.lastMetaSent = key;
            this.send({ type: 'metadata', ...payload });
          } else {
            this.vlog('skip duplicate metadata');
          }
        }
      }, 80);
    }
  }

  private negotiateIfNeeded(remoteId: string) {
    const pc = this.getOrCreatePeer(remoteId);
    const haveLocal = !!pc.currentLocalDescription;
    const haveRemote = !!pc.currentRemoteDescription;
    if (!haveLocal && !haveRemote) {
      const initiator = this.selfId < remoteId;
      this.vlog('negotiateIfNeeded', { remoteId, initiator, signalingState: pc.signalingState, haveLocal, haveRemote });
      if (initiator && pc.signalingState === 'stable') {
        this.ensureSendTrack(remoteId);
        this.startOffer(remoteId).catch(e => this.vlog('negotiateIfNeeded offer error', (e as any)?.message));
      }
      // Watchdog: if still no SDP after 2s, re-attempt (only initiator)
      if (!this.negotiationWatchdogs[remoteId] && initiator) {
        this.negotiationWatchdogs[remoteId] = setTimeout(() => {
          const haveL = !!pc.currentLocalDescription; const haveR = !!pc.currentRemoteDescription;
            if (!haveL && !haveR) {
              this.vlog('negotiation watchdog firing', { remoteId });
              if (pc.signalingState === 'stable') this.startOffer(remoteId).catch(e => this.vlog('watchdog offer error', (e as any)?.message));
            }
            delete this.negotiationWatchdogs[remoteId];
        }, 2000);
      }
    }
  }

  private flushCandidateStats(peer: string, reason: string) {
    const cs = this.candidateStats[peer]; if (!cs) return;
    if (cs.timer) { clearTimeout(cs.timer); cs.timer = null; }
    this.vlog('candidate-summary', { peer, reason, count: cs.count, types: cs.types, gathering: cs.gathering });
  }
}

export const voiceManager = new VoiceManager();
