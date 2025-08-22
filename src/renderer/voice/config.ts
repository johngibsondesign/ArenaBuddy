// Basic STUN/TURN configuration placeholder. Replace with real TURN credentials.
function buildRtcConfig(): RTCConfiguration {
  const base: RTCConfiguration = {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    ],
    iceTransportPolicy: 'all'
  };
  const turnUrls = (import.meta as any).env?.VITE_TURN_URLS || (window as any).VITE_TURN_URLS || '';
  const turnUser = (import.meta as any).env?.VITE_TURN_USERNAME || (window as any).VITE_TURN_USERNAME;
  const turnCred = (import.meta as any).env?.VITE_TURN_CREDENTIAL || (window as any).VITE_TURN_CREDENTIAL;
  if (turnUrls && turnUser && turnCred) {
    const urls = String(turnUrls).split(/[,\s]+/).filter(Boolean);
    if (urls.length) base.iceServers!.push({ urls, username: turnUser, credential: turnCred });
  }
  return base;
}

export const rtcConfig: RTCConfiguration = buildRtcConfig();

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'candidate' | 'join' | 'leave' | 'metadata';
  sdp?: any;
  candidate?: any;
  lobbyId?: string; // derived from Riot lobby or manual
  summonerId?: string;
  iconId?: number;
  name?: string;
  from?: string; // sender peer id
  riotId?: string;
  tagLine?: string;
  muted?: boolean;
  speaking?: boolean;
  to?: string; // target peer id for directed signaling
}

export interface PeerParticipant {
  id: string; // remote peer id
  name?: string;
  iconId?: number;
  stream?: MediaStream;
  muted?: boolean;
  volume?: number; // 0..1 user-specific volume multiplier
  riotId?: string;
  tagLine?: string;
  speaking?: boolean;
  level?: number; // 0..1 current audio level
}

export interface VoiceStateSnapshot {
  connected: boolean;
  connecting: boolean;
  muted: boolean;
  deafened: boolean;
  pushToTalk: boolean;
  lobbyId?: string;
  selfId?: string;
  participants: PeerParticipant[];
  error?: string | null;
  inputGain?: number; // 0..2 (200%)
  outputGain?: number; // 0..2
  inputDeviceId?: string;
  outputDeviceId?: string;
}
