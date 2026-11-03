import { describe, expect, it } from 'vitest';
import { regionPalette } from '@core/palette.ts';
import { buildStarBuffers, NEUTRAL_STAR_COLOUR, regionColours } from './stars.ts';
import type { Region, Song } from '../backend/types.ts';

const star = (id: string, regionId: number, brightness: number): Song => ({
  id, regionId, brightness, x: 1, y: 2, z: 3, localRadius: 1,
  title: 't', artist: 'a', spotifyUrl: '', appleUrl: '', youtubeUrl: '',
});
const palette = new Map([[0, '#ff0000'], [1, '#00ff80']]);
const neutral = [1, 3, 5].map((i) => parseInt(NEUTRAL_STAR_COLOUR.slice(i, i + 2), 16) / 255);

describe('buildStarBuffers', () => {
  it('sizes buffers 3/3/1 per star and fills positions', () => {
    const b = buildStarBuffers([star('a', 0, 0.5), star('b', 1, 0.5)], palette);
    expect(b.positions).toHaveLength(6);
    expect(b.colours).toHaveLength(6);
    expect(b.sizes).toHaveLength(2);
    expect(Array.from(b.positions.slice(0, 3))).toEqual([1, 2, 3]);
  });
  it('size is 2 + 6 x brightness', () => {
    const b = buildStarBuffers([star('a', 0, 0), star('b', 0, 1)], palette);
    expect(b.sizes[0]).toBe(2);
    expect(b.sizes[1]).toBe(8);
  });
  it('colour is palette scaled by 0.4 + 0.6 x brightness, 0..1', () => {
    const b = buildStarBuffers([star('a', 0, 0), star('b', 1, 1)], palette);
    expect(b.colours[0]).toBeCloseTo(0.4);
    expect(b.colours[1]).toBeCloseTo(0);
    expect(b.colours[3]).toBeCloseTo(0);
    expect(b.colours[4]).toBeCloseTo(1);
    expect(b.colours[5]).toBeCloseTo(128 / 255);
  });
  it('indexOf maps ids to indices', () => {
    const b = buildStarBuffers([star('a', 0, 0), star('b', 0, 0)], palette);
    expect(b.indexOf.get('a')).toBe(0);
    expect(b.indexOf.get('b')).toBe(1);
  });
  it('gives an unknown or null regionId the neutral colour instead of throwing', () => {
    const nullRegion = { ...star('b', 0, 1), regionId: null as unknown as number };
    const b = buildStarBuffers([star('a', 5, 1), nullRegion, star('c', Number.NaN, 1)], palette);
    for (let i = 0; i < 3; i++) {
      expect(Array.from(b.colours.slice(i * 3, i * 3 + 3)).map((v) => +v.toFixed(4)))
        .toEqual(neutral.map((v) => +v.toFixed(4)));
    }
  });
  it('treats a non-finite brightness as 0', () => {
    const b = buildStarBuffers([star('a', 0, Number.NaN)], palette);
    expect(b.sizes[0]).toBe(2);
  });
});

const region = (id: number, adjacent: number[]): Region => ({ id, x: 0, y: 0, z: 0, adjacent });

describe('regionColours', () => {
  it('matches regionPalette when ids are exactly 0..n-1', () => {
    const regions = [region(0, [1]), region(1, [0, 2]), region(2, [1])];
    const c = regionColours('seed', regions);
    expect([...c.keys()]).toEqual([0, 1, 2]);
    expect([...c.values()]).toEqual(regionPalette('seed', 3, [[0, 1], [1, 2]]));
  });
  it('handles ids that start at 1, have gaps and arrive unsorted; adjacent regions differ', () => {
    const regions = [region(40, [7]), region(7, [1, 40]), region(1, [7, 999])];
    const c = regionColours('seed', regions);
    expect([...c.keys()].sort((a, b) => a - b)).toEqual([1, 7, 40]);
    expect(c.get(1)).not.toBe(c.get(7));
    expect(c.get(7)).not.toBe(c.get(40));
    const b = buildStarBuffers([star('a', 40, 1), star('b', 3, 1)], c);
    const hex = c.get(40)!;
    expect(b.colours[0]).toBeCloseTo(parseInt(hex.slice(1, 3), 16) / 255);
    expect(b.colours[3]).toBeCloseTo(neutral[0]!);
  });
  it('is empty for no regions', () => {
    expect(regionColours('seed', []).size).toBe(0);
  });
});
