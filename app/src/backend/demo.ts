import { SHIP_COLOURS } from '@core/palette.ts';
import type { PublicDock } from '@core/types.ts';
import {
  BackendError,
  type Backend, type Hop, type Journey, type Profile, type SampleMap, type Song,
} from './types.ts';

const PREFIX = 'mh.demo.';
const SAMPLE_DOCK_TIME = '1970-01-01T00:00:00.000Z';
const SEARCH_LIMIT = 20;

type Dock = { id: string; songId: string; updatedAt: string };

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

/** Local date (YYYY-MM-DD) of `now` minus 4 hours, in the given IANA timezone. */
function dayOf(now: Date, tz: string): string {
  const shifted = new Date(now.getTime() - 4 * 3600 * 1000);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(shifted);
  } catch {
    throw new BackendError('invalid_time_zone');
  }
}

/** Deterministic brightness in 0.25..1 seeded by the song id (demo only). */
export function demoBrightness(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return 0.25 + 0.75 * ((h >>> 0) / 4294967296);
}

export function createDemoBackend(
  map: SampleMap,
  storage: Storage,
  now: () => Date = () => new Date(),
): Backend {
  const read = <T>(key: string, fallback: T): T => {
    try {
      const raw = storage.getItem(PREFIX + key);
      if (raw === null) return fallback;
      const v: unknown = JSON.parse(raw);
      return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key: string, value: unknown): void => {
    try { storage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  };

  const songs: Song[] = map.songs.map((s) => ({
    id: s.id, x: s.x, y: s.y, z: s.z, localRadius: s.localRadius, regionId: s.regionId,
    brightness: demoBrightness(s.id), title: s.title, artist: s.artist,
    spotifyUrl: s.spotifyUrl, appleUrl: s.appleUrl, youtubeUrl: s.youtubeUrl,
  }));
  const songById = new Map(songs.map((s) => [s.id, s]));
  const requireSong = (id: string): void => {
    if (!songById.has(id)) throw new BackendError('unknown_song');
  };

  let cachedProfile: Profile | null = null;
  const loadProfile = (): Profile => {
    if (!cachedProfile) {
      const stored = read<Profile | null>('profile', null);
      if (stored) cachedProfile = stored;
      else {
        cachedProfile = {
          homeSongId: null, shipColour: SHIP_COLOURS[0], colourSeed: uuid(),
        };
        write('profile', cachedProfile);
      }
    }
    return cachedProfile;
  };
  const saveProfile = (p: Profile): void => { cachedProfile = p; write('profile', p); };

  const journeys = (): Record<string, Journey> => read<Record<string, Journey>>('journeys', {});
  const today = (tz: string): { day: string; journey: Journey | null } => {
    const day = dayOf(now(), tz);
    return { day, journey: journeys()[day] ?? null };
  };
  const saveJourney = (day: string, j: Journey): void => write('journeys', { ...journeys(), [day]: j });
  const todays = (tz: string): { day: string; journey: Journey } => {
    const t = today(tz);
    if (!t.journey) throw new BackendError('bad_hop');
    return { day: t.day, journey: t.journey };
  };

  const demoOnly = (): never => { throw new BackendError('demo', 'Not available in the demo'); };

  return {
    mode: 'demo',
    getSession: async () => ({ isMember: true }),
    redeemInvite: async () => demoOnly(),
    recover: async () => demoOnly(),

    async loadMap() {
      loadProfile();
      const own = read<Dock | null>('dock', null);
      const docks: PublicDock[] = map.docks.map((d) => ({
        id: d.id, songId: d.songId, isSample: true, shipColour: d.shipColour, updatedAt: SAMPLE_DOCK_TIME,
      }));
      if (own) {
        docks.push({
          id: own.id, songId: own.songId, isSample: false,
          shipColour: loadProfile().shipColour, updatedAt: own.updatedAt,
        });
      }
      return { stars: songs, docks, regions: map.regions.map((r) => ({ ...r, adjacent: [...r.adjacent] })) };
    },
    getSongs: async (ids) => ids.flatMap((id) => songById.get(id) ?? []),
    async searchSongs(q) {
      const needle = q.trim().toLowerCase();
      if (!needle) return [];
      return songs
        .filter((s) => s.title.toLowerCase().includes(needle) || s.artist.toLowerCase().includes(needle))
        .slice(0, SEARCH_LIMIT);
    },

    getProfile: async () => ({ ...loadProfile() }),
    async getMyDock() {
      const d = read<Dock | null>('dock', null);
      return d ? { id: d.id, songId: d.songId } : null;
    },
    async setDock(songId) {
      requireSong(songId);
      const cur = read<Dock | null>('dock', null);
      if (cur && cur.songId === songId) return cur.id;
      const next: Dock = { id: uuid(), songId, updatedAt: now().toISOString() };
      write('dock', next);
      return next.id;
    },
    async setHome(songId) {
      requireSong(songId);
      saveProfile({ ...loadProfile(), homeSongId: songId });
    },
    async setShipColour(c) {
      if (!SHIP_COLOURS.includes(c)) throw new BackendError('bad_colour');
      saveProfile({ ...loadProfile(), shipColour: c });
    },

    async currentJourney(tz) {
      return today(tz).journey;
    },
    async startJourney(tz, songId) {
      requireSong(songId);
      const { day, journey } = today(tz);
      if (journey) throw new BackendError('journey_exists');
      const hop: Hop = {
        id: uuid(), parentHopId: null, songId, kind: 'start', createdAt: now().toISOString(),
      };
      const j: Journey = { id: uuid(), currentHopId: hop.id, hops: [hop] };
      saveJourney(day, j);
      return j;
    },
    async hop(tz, parentHopId, songId, kind) {
      if (kind !== 'hitchhike' && kind !== 'jump') throw new BackendError('bad_kind');
      const { day, journey } = todays(tz);
      if (!journey.hops.some((h) => h.id === parentHopId)) throw new BackendError('bad_hop');
      requireSong(songId);
      const hop: Hop = {
        id: uuid(), parentHopId, songId, kind, createdAt: now().toISOString(),
      };
      saveJourney(day, { ...journey, currentHopId: hop.id, hops: [...journey.hops, hop] });
      return hop;
    },
    async moveTo(tz, hopId) {
      const { day, journey } = todays(tz);
      if (!journey.hops.some((h) => h.id === hopId)) throw new BackendError('bad_hop');
      saveJourney(day, { ...journey, currentHopId: hopId });
    },

    async likeDock(dockId) {
      if (map.docks.some((d) => d.id === dockId)) return null;
      if (read<Dock | null>('dock', null)?.id === dockId) throw new BackendError('own_dock');
      throw new BackendError('unknown_dock');
    },
    getTraces: async () => [],
    findTrace: async () => null,
    sendSuggestion: async () => demoOnly(),
    getInbox: async () => [],
    markInboxSeen: async () => {},
  };
}
