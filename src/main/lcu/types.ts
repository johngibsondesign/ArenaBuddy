/** LCU authentication info derived from lockfile */
export interface LcuAuth {
  protocol: 'https' | 'http';
  port: number;
  password: string;
}

/** Combined user info from /lol-summoner and /lol-chat */
export interface LcuUser {
  summonerId: number;
  puuid: string;
  displayName: string; // in-client display
  gameName?: string; // Riot ID name
  tagLine?: string; // Riot ID tag
  profileIconId?: number; // optional convenience
  summonerLevel?: number; // optional convenience
}

export type LcuStatus = 'UP' | 'DOWN';

export interface InternalAuth extends LcuAuth { pid?: number; name?: string; }
