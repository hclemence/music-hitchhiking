import { describe, expect, it } from 'vitest';
import { regionPalette } from '@core/palette.ts';
import { contrastWithWhite, gradeSkyColour, MAX_SKY_REGIONS, SKY_MAX, SKY_MIN, skyUniforms } from './sky.ts';
import type { Region } from '../backend/types.ts';

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const region = (id: number, x = id, y = id): Region => ({ id, x, y, z: 0, adjacent: [] });

describe('gradeSkyColour', () => {
  it('keeps every channel in range for extreme inputs', () => {
    for (const c of [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]] as const) {
      for (const v of gradeSkyColour(c)) {
        expect(v).toBeGreaterThanOrEqual(SKY_MIN - 1e-9);
        expect(v).toBeLessThanOrEqual(SKY_MAX + 1e-9);
      }
    }
  });
  it('gives >= 2.5:1 against white for random colours', () => {
    for (let i = 0; i < 200; i++) {
      const c: [number, number, number] = [Math.random(), Math.random(), Math.random()];
      expect(contrastWithWhite(gradeSkyColour(c))).toBeGreaterThanOrEqual(2.5);
    }
  });
  it('gives >= 2.5:1 for every palette colour over 50 seeds x 40 regions', () => {
    for (let s = 0; s < 50; s++) {
      for (const h of regionPalette(`seed-${s}`, 40, [])) {
        expect(contrastWithWhite(gradeSkyColour(hex(h)))).toBeGreaterThanOrEqual(2.5);
      }
    }
  });
});

describe('contrastWithWhite', () => {
  it('matches WCAG extremes', () => {
    expect(contrastWithWhite([0, 0, 0])).toBeCloseTo(21, 5);
    expect(contrastWithWhite([1, 1, 1])).toBeCloseTo(1, 5);
  });
});

describe('skyUniforms', () => {
  it('caps at MAX_SKY_REGIONS', () => {
    const regions = Array.from({ length: 100 }, (_, i) => region(i));
    const u = skyUniforms('s', regions);
    expect(u.count).toBe(MAX_SKY_REGIONS);
    expect(u.centres.length).toBe(MAX_SKY_REGIONS * 2);
    expect(u.colours.length).toBe(MAX_SKY_REGIONS * 3);
  });
  it('skips non-finite regions and sorts by id', () => {
    const u = skyUniforms('s', [region(5, 50, 51), region(2, NaN, 0), region(1, 10, 11), region(3, 0, Infinity)]);
    expect(u.count).toBe(2);
    expect(Array.from(u.centres.slice(0, 4))).toEqual([10, 11, 50, 51]);
  });
  it('is deterministic per seed and differs between seeds', () => {
    const regions = Array.from({ length: 10 }, (_, i) => region(i));
    const a = skyUniforms('s', regions);
    const b = skyUniforms('s', regions);
    expect(Array.from(a.colours)).toEqual(Array.from(b.colours));
    expect(Array.from(skyUniforms('other', regions).colours)).not.toEqual(Array.from(a.colours));
  });
  it('grades colours into range', () => {
    const u = skyUniforms('s', Array.from({ length: 8 }, (_, i) => region(i)));
    for (let i = 0; i < u.count * 3; i++) {
      expect(u.colours[i]!).toBeGreaterThanOrEqual(SKY_MIN - 1e-6);
      expect(u.colours[i]!).toBeLessThanOrEqual(SKY_MAX + 1e-6);
    }
  });
});
