import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSampleMap, songUuid } from './sample-map.ts';
import { nearestRegion } from '../supabase/functions/_shared/core/placement.ts';
import { SHIP_COLOURS } from '../supabase/functions/_shared/core/palette.ts';
import { distance } from '../supabase/functions/_shared/core/vec.ts';

type Input = { title: string; artist: string; cluster: number };
const input: Input[] = JSON.parse(
  readFileSync(new URL('../data/sample-songs.json', import.meta.url), 'utf8'),
);
const map = buildSampleMap(input, 'sample-v1');

describe('sample-songs.json', () => {
  it('has 12 clusters of 30 with no duplicates', () => {
    expect(input).toHaveLength(360);
    for (let c = 0; c < 12; c++) expect(input.filter((s) => s.cluster === c)).toHaveLength(30);
    const keys = new Set(input.map((s) => `${s.artist}\u0000${s.title}`.toLowerCase()));
    expect(keys.size).toBe(360);
  });
});

describe('buildSampleMap', () => {
  it('is deterministic', () => {
    expect(buildSampleMap(input, 'sample-v1')).toEqual(map);
    expect(buildSampleMap(input, 'other')).not.toEqual(map);
  });

  it('has 12 regions, consistent regionIds, symmetric adjacency', () => {
    expect(map.regions).toHaveLength(12);
    map.regions.forEach((r, i) => expect(r.id).toBe(i));
    const cents = map.regions.map((r) => ({ x: r.x, y: r.y, z: r.z }));
    for (const s of map.songs) expect(s.regionId).toBe(nearestRegion(s, cents));
    for (const r of map.regions) {
      expect(r.adjacent).not.toContain(r.id);
      expect(r.adjacent.length).toBeGreaterThanOrEqual(1);
      for (const a of r.adjacent) expect(map.regions[a].adjacent).toContain(r.id);
    }
  });

  it('builds songs with ids, radii and links', () => {
    expect(map.songs).toHaveLength(input.length);
    expect(new Set(map.songs.map((s) => s.id)).size).toBe(map.songs.length);
    for (const s of map.songs) {
      const q = encodeURIComponent(s.artist + ' ' + s.title);
      expect(s.mbid).toBe(s.id);
      expect(s.localRadius).toBeGreaterThan(0);
      expect(s.spotifyUrl).toBe('https://open.spotify.com/search/' + q);
      expect(s.appleUrl).toBe('https://music.apple.com/search?term=' + q);
      expect(s.youtubeUrl).toBe('https://www.youtube.com/results?search_query=' + q);
    }
  });

  it('keeps clusters tighter than the whole', () => {
    const by = (c: number) => map.songs.filter((_, i) => input[i].cluster === c);
    const mean = (a: typeof map.songs, b: typeof map.songs) => {
      let t = 0, n = 0;
      for (const p of a) for (const q of b) if (p !== q) { t += distance(p, q); n++; }
      return t / n;
    };
    for (let c = 0; c < 12; c++) {
      const own = by(c);
      const others = map.songs.filter((_, i) => input[i].cluster !== c);
      expect(mean(own, own)).toBeLessThan(mean(own, others));
    }
  });

  it('places docks on songs', () => {
    expect(map.docks).toHaveLength(Math.round(map.songs.length / 3));
    const ids = new Set(map.songs.map((s) => s.id));
    const per = new Map<string, number>();
    for (const d of map.docks) {
      expect(ids.has(d.songId)).toBe(true);
      expect(SHIP_COLOURS).toContain(d.shipColour);
      per.set(d.songId, (per.get(d.songId) ?? 0) + 1);
    }
    for (const n of per.values()) expect(n).toBeLessThanOrEqual(2);
    expect(new Set(map.docks.map((d) => d.id)).size).toBe(map.docks.length);
  });
});

describe('songUuid', () => {
  it('is stable and uuid-v5 shaped', () => {
    expect(songUuid('A', 'B')).toBe(songUuid('A', 'B'));
    expect(songUuid('A', 'B')).not.toBe(songUuid('B', 'A'));
    expect(songUuid('A', 'B')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
