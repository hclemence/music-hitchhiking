import { describe, expect, it } from 'vitest';
import { buildStarBuffers } from './stars.ts';
import type { Song } from '../backend/types.ts';

const star = (id: string, regionId: number, brightness: number): Song => ({
  id, regionId, brightness, x: 1, y: 2, z: 3, localRadius: 1,
  title: 't', artist: 'a', spotifyUrl: '', appleUrl: '', youtubeUrl: '',
});
const palette = ['#ff0000', '#00ff80'];

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
  it('throws on unknown regionId', () => {
    expect(() => buildStarBuffers([star('a', 5, 0)], palette)).toThrow();
  });
});
