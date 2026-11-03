import { describe, expect, it } from 'vitest';
import { regionPalette } from '@core/palette.ts';
import { buildStarBuffers, regionColours } from './stars.ts';
import type { Region, Song } from '../backend/types.ts';

const star = (id: string, brightness: number, x = 1, y = 2): Song => ({
  id, regionId: 0, brightness, x, y, z: 3, localRadius: 1,
  title: 't', artist: 'a', spotifyUrl: '', appleUrl: '', youtubeUrl: '',
});
const none: ReadonlySet<string> = new Set();

describe('buildStarBuffers', () => {
  it('places stars on the plane at (x, 0, y)', () => {
    const b = buildStarBuffers([star('a', 0.5, 5, 7), star('b', 0.5, -3, 4)], none);
    expect(b.positions).toHaveLength(6);
    expect(Array.from(b.positions)).toEqual([5, 0, 7, -3, 0, 4]);
    expect(b.sizes).toHaveLength(2);
  });
  it('has no colour buffer (stars are all white)', () => {
    const b = buildStarBuffers([star('a', 0.5)], none) as Record<string, unknown>;
    expect(b.colours).toBeUndefined();
    expect(Object.keys(b).sort()).toEqual(['brightness', 'indexOf', 'positions', 'ring', 'sizes']);
  });
  it('size is 2 + 6 x brightness, and brightness is kept', () => {
    const b = buildStarBuffers([star('a', 0), star('b', 1)], none);
    expect(b.sizes[0]).toBe(2);
    expect(b.sizes[1]).toBe(8);
    expect(b.brightness[1]).toBe(1);
  });
  it('rings visited stars only', () => {
    const b = buildStarBuffers([star('a', 0), star('b', 0)], new Set(['b']));
    expect(Array.from(b.ring)).toEqual([0, 1]);
  });
  it('indexOf maps ids to indices', () => {
    const b = buildStarBuffers([star('a', 0), star('b', 0)], none);
    expect(b.indexOf.get('a')).toBe(0);
    expect(b.indexOf.get('b')).toBe(1);
  });
  it('treats a non-finite brightness as 0', () => {
    const b = buildStarBuffers([star('a', Number.NaN)], none);
    expect(b.sizes[0]).toBe(2);
    expect(b.brightness[0]).toBe(0);
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
  });
  it('is empty for no regions', () => {
    expect(regionColours('seed', []).size).toBe(0);
  });
});
