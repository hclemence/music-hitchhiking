import { describe, expect, it } from 'vitest';
import { regionPalette } from '@core/palette.ts';
import { blendRegionColours, contrastWithWhite, fadeToHorizon, horizonColour, skyFade, gradeSkyColour, MAX_SKY_REGIONS, SKY_MAX, SKY_MIN, skyUniforms } from './sky.ts';
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
  it('passes the raw palette colours (the shader grades the blend once)', () => {
    const regions = Array.from({ length: 8 }, (_, i) => region(i));
    const u = skyUniforms('s', regions);
    const palette = regionPalette('s', 8, []);
    palette.forEach((h, i) => {
      hex(h).forEach((v, k) => expect(u.colours[i * 3 + k]!).toBeCloseTo(v, 6));
    });
  });
});

describe('blendRegionColours', () => {
  const regions = [region(0, 0, 0), region(1, 1000, 0), region(2, 0, 1000), region(3, 1000, 1000)];
  const u = skyUniforms('far', regions);
  const col = (i: number) => Array.from(u.colours.slice(i * 3, i * 3 + 3));
  it('is dominated by the nearest region far from every centre, not the average', () => {
    const two = skyUniforms('far', [region(0, 0, 0), region(1, 1000, 0)]);
    const c2 = (i: number) => Array.from(two.colours.slice(i * 3, i * 3 + 3));
    const c = blendRegionColours([3, 0.1], two.centres, two.colours, two.count); // 2000 map units past region 1
    const near = c2(1);
    const avg = [0, 1, 2].map((k) => (c2(0)[k]! + c2(1)[k]!) / 2);
    const dist = (a: number[]) => Math.hypot(a[0]! - c[0], a[1]! - c[1], a[2]! - c[2]);
    expect(dist(near)).toBeLessThan(0.02);
    expect(dist(near)).toBeLessThan(dist(avg));
  });
  it('is the region colour at a centre and mixes at a border', () => {
    const at = blendRegionColours([0, 0], u.centres, u.colours, u.count);
    expect(Math.hypot(...(at.map((v, k) => v - col(0)[k]!) as [number, number, number]))).toBeLessThan(0.02);
    const mid = blendRegionColours([0.5, 0], u.centres, u.colours, u.count);
    expect(Math.hypot(...(mid.map((v, k) => v - col(0)[k]!) as [number, number, number]))).toBeGreaterThan(0.01);
  });
});

describe('far-field fade', () => {
  const g: [number, number, number] = [0.3, 0.5, 0.2];
  const h = horizonColour([0.9, 0.2, 0.3]);
  it('leaves points inside R unchanged and gives the horizon colour at 3R', () => {
    expect(fadeToHorizon(g, h, 500, 1000)).toEqual(g);
    expect(fadeToHorizon(g, h, 1000, 1000)).toEqual(g);
    expect(fadeToHorizon(g, h, 3000, 1000)).toEqual(h);
  });
  it('is monotonic and smooth between R and 2.5R', () => {
    let prev = 0;
    for (let d = 1000; d <= 2500; d += 50) { const f = skyFade(d, 1000); expect(f).toBeGreaterThanOrEqual(prev); prev = f; }
    expect(skyFade(1000, 1000)).toBe(0); expect(skyFade(2500, 1000)).toBe(1);
  });
  it('horizon colour stays within the clamp', () => {
    for (const c of [[1, 0, 0], [0, 0, 0], [1, 1, 1], [0, 0, 1]] as const)
      for (const v of horizonColour(c)) { expect(v).toBeGreaterThanOrEqual(SKY_MIN - 1e-9); expect(v).toBeLessThanOrEqual(SKY_MAX + 1e-9); }
  });
  it('skyUniforms gives the centroid and radius = farthest centre + 300', () => {
    const u = skyUniforms('s', [region(0, 0, 0), region(1, 1000, 0)]);
    expect(u.centroid).toEqual([500, 0]);
    expect(u.radius).toBe(800);
  });
});
