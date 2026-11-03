import { beforeEach, describe, expect, it } from 'vitest';
import { SHIP_COLOURS } from '@core/palette.ts';
import type { SampleMap } from '../../../scripts/sample-map.ts';
import { createDemoBackend } from './demo.ts';
import { BackendError } from './types.ts';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

const song = (n: number) => ({
  id: `song-${n}`, mbid: `song-${n}`, title: `Title ${n}`, artist: `Artist ${n}`,
  x: n * 10, y: 0, z: 0, regionId: n % 2, localRadius: 5,
  spotifyUrl: `s${n}`, appleUrl: `a${n}`, youtubeUrl: `y${n}`,
});
const map: SampleMap = {
  regions: [
    { id: 0, x: 0, y: 0, z: 0, adjacent: [1] },
    { id: 1, x: 100, y: 0, z: 0, adjacent: [0] },
  ],
  songs: [1, 2, 3, 4].map(song),
  docks: [{ id: 'sd-1', songId: 'song-1', shipColour: SHIP_COLOURS[3] }],
};

const TZ = 'America/New_York'; // EST (UTC-5) on these dates
let clock: Date;
const now = () => clock;
let storage: Storage;
const make = () => createDemoBackend(map, storage, now);

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; } catch (e) { return e instanceof BackendError ? e.code : `other:${String(e)}`; }
  return undefined;
}

beforeEach(() => {
  storage = new MemoryStorage();
  clock = new Date('2026-11-03T15:00:00Z'); // 10:00 local
});

describe('session and profile', () => {
  it('is always a member in demo mode', async () => {
    const b = make();
    expect(b.mode).toBe('demo');
    expect(await b.getSession()).toEqual({ isMember: true });
  });
  it('has a seed, first colour and no home', async () => {
    const p = await make().getProfile();
    expect(p.colourSeed.length).toBeGreaterThan(0);
    expect(p.shipColour).toBe(SHIP_COLOURS[0]);
    expect(p.homeSongId).toBeNull();
  });
  it('setHome is stored; unknown songs rejected', async () => {
    const b = make();
    await b.setHome('song-2');
    expect((await b.getProfile()).homeSongId).toBe('song-2');
    expect(await code(b.setHome('nope'))).toBe('unknown_song');
  });
});

describe('map', () => {
  it('returns all songs as bright stars, sample docks and regions', async () => {
    const m = await make().loadMap();
    expect(m.stars).toHaveLength(4);
    expect(m.stars.every((s) => s.brightness === 1)).toBe(true);
    expect(m.stars[0]).toMatchObject({ id: 'song-1', title: 'Title 1', spotifyUrl: 's1' });
    expect(m.regions).toEqual(map.regions);
    expect(m.docks).toHaveLength(1);
    expect(m.docks[0]).toMatchObject({ id: 'sd-1', songId: 'song-1', isSample: true });
  });
  it('getSongs and searchSongs', async () => {
    const b = make();
    expect((await b.getSongs(['song-2', 'nope'])).map((s) => s.id)).toEqual(['song-2']);
    expect((await b.searchSongs('artist 3')).map((s) => s.id)).toEqual(['song-3']);
    expect(await b.searchSongs('zzz')).toEqual([]);
  });
});

describe('dock and colour', () => {
  it('setDock: new id on a different song, same id on the same song', async () => {
    const b = make();
    expect(await b.getMyDock()).toBeNull();
    const a = await b.setDock('song-2');
    expect(await b.setDock('song-2')).toBe(a);
    const c = await b.setDock('song-3');
    expect(c).not.toBe(a);
    expect(await b.getMyDock()).toEqual({ id: c, songId: 'song-3' });
  });
  it('own dock appears in loadMap as non-sample, with the ship colour', async () => {
    const b = make();
    await b.setShipColour(SHIP_COLOURS[5]);
    const id = await b.setDock('song-4');
    const docks = (await b.loadMap()).docks;
    expect(docks).toHaveLength(2);
    expect(docks.find((d) => d.id === id)).toMatchObject({
      songId: 'song-4', isSample: false, shipColour: SHIP_COLOURS[5],
    });
  });
  it('setShipColour rejects non-palette colours', async () => {
    const b = make();
    expect(await code(b.setShipColour('#123456'))).toBe('bad_colour');
    await b.setShipColour(SHIP_COLOURS[2]);
    expect((await b.getProfile()).shipColour).toBe(SHIP_COLOURS[2]);
  });
  it('setDock rejects unknown songs', async () => {
    expect(await code(make().setDock('nope'))).toBe('unknown_song');
  });
});

describe('journeys', () => {
  it('null before start; start creates one start hop', async () => {
    const b = make();
    expect(await b.currentJourney(TZ)).toBeNull();
    const j = await b.startJourney(TZ, 'song-1');
    expect(j.hops).toHaveLength(1);
    expect(j.hops[0]).toMatchObject({ parentHopId: null, songId: 'song-1', kind: 'start' });
    expect(j.currentHopId).toBe(j.hops[0].id);
    expect(await b.currentJourney(TZ)).toEqual(j);
  });
  it('second start on the same day → journey_exists', async () => {
    const b = make();
    await b.startJourney(TZ, 'song-1');
    expect(await code(b.startJourney(TZ, 'song-2'))).toBe('journey_exists');
  });
  it('hop validates kind, parent and song', async () => {
    const b = make();
    const j = await b.startJourney(TZ, 'song-1');
    const root = j.hops[0].id;
    expect(await code(b.hop(TZ, root, 'song-2', 'start' as 'jump'))).toBe('bad_kind');
    expect(await code(b.hop(TZ, root, 'song-2', 'walk' as 'jump'))).toBe('bad_kind');
    expect(await code(b.hop(TZ, 'missing', 'song-2', 'jump'))).toBe('bad_hop');
    expect(await code(b.hop(TZ, root, 'nope', 'hitchhike'))).toBe('unknown_song');
  });
  it('hop adds a child and moves current; moveTo does not add hops', async () => {
    const b = make();
    const root = (await b.startJourney(TZ, 'song-1')).hops[0];
    const h2 = await b.hop(TZ, root.id, 'song-2', 'hitchhike');
    expect(h2).toMatchObject({ parentHopId: root.id, songId: 'song-2', kind: 'hitchhike' });
    let j = (await b.currentJourney(TZ))!;
    expect(j.currentHopId).toBe(h2.id);
    expect(j.hops).toHaveLength(2);
    await b.moveTo(TZ, root.id);
    j = (await b.currentJourney(TZ))!;
    expect(j.currentHopId).toBe(root.id);
    expect(j.hops).toHaveLength(2);
    expect(await code(b.moveTo(TZ, 'missing'))).toBe('bad_hop');
  });
  it('hopping from an earlier hop makes a branch', async () => {
    const b = make();
    const root = (await b.startJourney(TZ, 'song-1')).hops[0];
    await b.hop(TZ, root.id, 'song-2', 'hitchhike');
    const branch = await b.hop(TZ, root.id, 'song-3', 'jump');
    const j = (await b.currentJourney(TZ))!;
    expect(j.hops.filter((h) => h.parentHopId === root.id)).toHaveLength(2);
    expect(j.currentHopId).toBe(branch.id);
  });
  it('the day rolls over at 4:00 local in the given timezone', async () => {
    const b = make();
    clock = new Date('2026-11-03T08:30:00Z'); // 03:30 New York, still Nov 2's day
    const j1 = await b.startJourney(TZ, 'song-1');
    clock = new Date('2026-11-03T08:59:00Z'); // 03:59
    expect(await b.currentJourney(TZ)).toEqual(j1);
    clock = new Date('2026-11-03T09:00:00Z'); // 04:00 → new day
    expect(await b.currentJourney(TZ)).toBeNull();
    const j2 = await b.startJourney(TZ, 'song-2');
    expect(j2.id).not.toBe(j1.id);
    // Journeys are keyed by the local day in the given timezone.
    clock = new Date('2026-11-03T20:00:00Z'); // 15:00 New York (Nov 3), 05:00 Tokyo (Nov 4)
    expect(await b.currentJourney(TZ)).toEqual(j2);
    expect(await b.currentJourney('Asia/Tokyo')).toBeNull();
  });
  it('old hops are not reachable on a later day', async () => {
    const b = make();
    const root = (await b.startJourney(TZ, 'song-1')).hops[0];
    clock = new Date('2026-11-04T15:00:00Z');
    expect(await code(b.hop(TZ, root.id, 'song-2', 'jump'))).toBe('bad_hop');
  });
});

describe('error codes and storage', () => {
  it('invalid time zone', async () => {
    const b = make();
    expect(await code(b.currentJourney('Mars/Base'))).toBe('invalid_time_zone');
    expect(await code(b.startJourney('Mars/Base', 'song-1'))).toBe('invalid_time_zone');
  });
  it('likeDock own and unknown docks', async () => {
    const b = make();
    const id = await b.setDock('song-1');
    expect(await code(b.likeDock(id))).toBe('own_dock');
    expect(await code(b.likeDock('nope'))).toBe('unknown_dock');
  });
  it('wrong-shaped stored JSON falls back to defaults', async () => {
    storage.setItem('mh.demo.profile', '"junk"');
    storage.setItem('mh.demo.journeys', '[1]');
    storage.setItem('mh.demo.dock', '7');
    const b = make();
    expect((await b.getProfile()).shipColour).toBe(SHIP_COLOURS[0]);
    expect(await b.getMyDock()).toBeNull();
    expect(await b.currentJourney(TZ)).toBeNull();
  });
});

describe('social stubs', () => {
  it('likeDock on a sample dock returns null', async () => {
    expect(await make().likeDock('sd-1')).toBeNull();
  });
  it('traces and inbox are empty; findTrace null', async () => {
    const b = make();
    expect(await b.getTraces()).toEqual([]);
    expect(await b.getInbox()).toEqual([]);
    expect(await b.findTrace('x')).toBeNull();
    await b.markInboxSeen();
  });
  it('redeemInvite and recover throw demo', async () => {
    const b = make();
    expect(await code(b.redeemInvite('abc'))).toBe('demo');
    expect(await code(b.recover('abc'))).toBe('demo');
  });
});

describe('persistence', () => {
  it('state survives a new backend over the same storage', async () => {
    const a = make();
    const seed = (await a.getProfile()).colourSeed;
    await a.setShipColour(SHIP_COLOURS[4]);
    await a.setHome('song-2');
    const dockId = await a.setDock('song-3');
    const j = await a.startJourney(TZ, 'song-1');
    await a.hop(TZ, j.hops[0].id, 'song-2', 'hitchhike');
    const expected = await a.currentJourney(TZ);

    const b = make();
    expect(await b.getProfile()).toEqual({ colourSeed: seed, shipColour: SHIP_COLOURS[4], homeSongId: 'song-2' });
    expect(await b.getMyDock()).toEqual({ id: dockId, songId: 'song-3' });
    expect(await b.currentJourney(TZ)).toEqual(expected);
    expect(await code(b.startJourney(TZ, 'song-4'))).toBe('journey_exists');
  });
  it('uses the mh.demo. key prefix only', async () => {
    const b = make();
    await b.getProfile();
    await b.setDock('song-1');
    for (let i = 0; i < storage.length; i++) expect(storage.key(i)!.startsWith('mh.demo.')).toBe(true);
  });
});
