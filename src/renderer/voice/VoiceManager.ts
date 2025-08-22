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
  this.patch({ connecting: true, error: null, lobbyId, selfId: this.selfId });
    try {
  if (signalingUrl.startsWith('supabase://')) {
        await this.initSupabase(signalingUrl, lobbyId, meta);
      } else {
        this.ws = new WebSocket(signalingUrl);
        this.ws.onmessage = (ev) => this.handleSignal(JSON.parse(ev.data));
        this.ws.onopen = () => { this.send({ type: 'metadata', name: meta?.name, iconId: meta?.iconId, riotId: meta?.riotId, tagLine: meta?.tagLine }); };
        this.ws.onerror = (e: any) => this.patch({ error: e.message || 'Signaling error' });
        this.ws.onclose = () => this.cleanup('closed');
      }
    } catch (e: any) { this.patch({ error: e.message || 'Failed to connect signaling', connecting: false }); }
  }

  private async initSupabase(_url: string, lobbyId: string, meta?: { name?: string; iconId?: number; riotId?: string; tagLine?: string }) {
    const projectUrl = (window as any).SUPABASE_URL || (import.meta as any).env?.VITE_SUPABASE_URL || (process as any).env?.SUPABASE_URL;
    const anonKey = (window as any).SUPABASE_ANON_KEY || (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || (process as any).env?.SUPABASE_ANON_KEY;
    if (!projectUrl || !anonKey) throw new Error('Missing Supabase configuration');
    this.supabase = createClient(projectUrl, anonKey, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 10 } } });
  // Optional channel name hashing to reduce easy enumeration
  const salt = (import.meta as any).env?.VITE_VOICE_SALT || (window as any).VITE_VOICE_SALT;
  const channelName = salt ? `voice_${await this.hashChannel(lobbyId, salt)}` : `voice_${lobbyId}`;
    this.channel = this.supabase.channel(channelName, { config: { presence: { key: this.selfId } } });
    this.channel.on('broadcast', { event: 'signal' }, (arg: any) => { const payload = arg?.payload; if (!payload || payload.from === this.selfId) return; this.handleSignal(payload); });
    this.channel.on('presence', { event: 'sync' }, () => {
      const presenceState: any = this.channel?.presenceState() || {};
      const others = Object.keys(presenceState).filter(k => k !== this.selfId);
      const newSet = new Set(others);
      // removed peers
      this.presenceSet.forEach(id => { if (!newSet.has(id)) this.removePeer(id); });
      // new peers
      others.forEach(r => {
        if (!this.presenceSet.has(r)) {
          const pc = this.getOrCreatePeer(r);
          if (pc.signalingState === 'stable') this.startOffer(r);
        }
      });
      this.presenceSet = newSet;
    });
    await this.channel.subscribe((s: any) => {
      if (s === 'SUBSCRIBED') {
  this.queueMeta({ name: meta?.name, iconId: meta?.iconId, riotId: meta?.riotId, tagLine: meta?.tagLine, muted: this.state.muted });
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
    if (this.localStream) this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream!));
  pc.onicecandidate = (e) => { if (e.candidate) this.send({ type: 'candidate', candidate: e.candidate, to: id } as any); };
    pc.ontrack = (e) => this.attachStream(id, e.streams[0]);
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      if (st === 'failed' || st === 'disconnected') {
        // Attempt quick renegotiation once
        setTimeout(() => {
          if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            try { this.startOffer(id); } catch {/* ignore */}
          }
        }, 800);
      }
    };
    return pc;
  }

  private attachStream(id: string, stream: MediaStream) {
    let participant = this.state.participants.find(p => p.id === id);
    if (!participant) { participant = { id } as PeerParticipant; this.state.participants.push(participant); }
    participant.stream = stream;
    let el: HTMLAudioElement | undefined = (participant as any)._el;
    if (!el) { el = new Audio(); el.autoplay = true; el.srcObject = stream; el.volume = (participant.volume ?? 1) * this.outputGain; (participant as any)._el = el; if (this.outputDeviceId && (el as any).setSinkId) { try { (el as any).setSinkId(this.outputDeviceId); } catch {} } }
    this.emit();
  }

  private async handleSignal(msg: any) {
    const from = msg.from || 'remote';
  if (msg.to && msg.to !== this.selfId) return; // directed elsewhere
    switch (msg.type) {
      case 'offer': {
        const pc = this.getOrCreatePeer(from);
        await pc.setRemoteDescription(msg.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
  this.send({ type: 'answer', sdp: ans, to: from } as any);
        this.patch({ connected: true, connecting: false });
        break; }
      case 'answer': {
        const pc = this.getOrCreatePeer(from);
        if (!pc.currentLocalDescription) return;
        await pc.setRemoteDescription(msg.sdp);
        this.patch({ connected: true, connecting: false });
        break; }
      case 'candidate': {
        if (msg.candidate) { const pc = this.getOrCreatePeer(from); try { await pc.addIceCandidate(msg.candidate); } catch {} }
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
        break; }
      case 'leave': { this.removePeer(from); break; }
    }
  }

  async startOffer(remoteId: string) {
    const pc = this.getOrCreatePeer(remoteId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
  this.send({ type: 'offer', sdp: offer, to: remoteId } as any);
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
    this.pendingMeta = { ...(this.pendingMeta||{}), ...p };
    if (!this.metaFlushTimer) {
      this.metaFlushTimer = setTimeout(() => {
        const payload = this.pendingMeta; this.pendingMeta = null; this.metaFlushTimer = null;
        if (payload) this.send({ type: 'metadata', ...payload });
      }, 80);
    }
  }
}

export const voiceManager = new VoiceManager();
