import type { PublicDock, Star } from '@core/types.ts';

export type { PublicDock, Star };
export type { SampleMap } from '../../../scripts/sample-map.ts';

export type Song = Star & {
  title: string;
  artist: string;
  spotifyUrl: string;
  appleUrl: string;
  youtubeUrl: string;
};
export type Region = { id: number; x: number; y: number; z: number; adjacent: number[] };
export type Profile = { homeSongId: string | null; colourSeed: string; shipColour: string };
export type Hop = {
  id: string;
  parentHopId: string | null;
  songId: string;
  kind: 'start' | 'hitchhike' | 'jump';
  createdAt: string;
};
export type Journey = { id: string; currentHopId: string; hops: Hop[] };
export type Trace = {
  id: string;
  originSongId: string;
  originTitle: string;
  originArtist: string;
  shipColour: string;
  brightness: number;
};
export type InboxItem = {
  id: string;
  kind: 'suggestion' | 'kept';
  songId: string;
  title: string;
  artist: string;
  shipColour: string | null;
  replyTraceId: string | null;
  createdAt: string;
  seenAt: string | null;
};

/** `code` is the RPC error code (`bad_hop`, `not_member`, ...) or `network`. */
export class BackendError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'BackendError';
    this.code = code;
  }
}

export interface Backend {
  mode: 'live' | 'demo';
  getSession(): Promise<{ isMember: boolean } | null>;
  redeemInvite(code: string): Promise<{ recoveryCode: string }>;
  recover(code: string): Promise<void>;
  loadMap(): Promise<{ stars: Song[]; docks: PublicDock[]; regions: Region[] }>;
  getSongs(ids: string[]): Promise<Song[]>;
  searchSongs(q: string): Promise<Song[]>;
  getProfile(): Promise<Profile>;
  getMyDock(): Promise<{ id: string; songId: string } | null>;
  setDock(songId: string): Promise<string>;
  setHome(songId: string): Promise<void>;
  setShipColour(c: string): Promise<void>;
  currentJourney(tz: string): Promise<Journey | null>;
  startJourney(tz: string, songId: string): Promise<Journey>;
  hop(tz: string, parentHopId: string, songId: string, kind: 'hitchhike' | 'jump'): Promise<Hop>;
  moveTo(tz: string, hopId: string): Promise<void>;
  likeDock(dockId: string): Promise<string | null>;
  getTraces(): Promise<Trace[]>;
  findTrace(traceId: string): Promise<string | null>;
  sendSuggestion(traceId: string, songId: string): Promise<void>;
  getInbox(): Promise<InboxItem[]>;
  markInboxSeen(): Promise<void>;
}
