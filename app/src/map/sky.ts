import type { Region } from '../backend/types.ts';
import { regionColours } from './stars.ts';

export const SKY_MIN = 0.17;
export const SKY_MAX = 0.64;
export const SKY_DESAT = 0.15;
export const MAX_SKY_REGIONS = 64;
/** Blend sharpness: weight = (dmin / d) ^ power, so the nearest region dominates everywhere. */
export const SKY_BLEND_POWER = 16;
export const SKY_BLEND_EPS = 0.05; // in shader units (1000 map units)

/** TS mirror of the shader's region blend (raw, before the fbm shading and grade). `p` is in shader units. */
export function blendRegionColours(
  p: readonly [number, number], centres: Float32Array, colours: Float32Array, count: number, scale = 1000,
): [number, number, number] {
  const d: number[] = [];
  let dmin = Infinity;
  for (let i = 0; i < count; i++) {
    const v = Math.hypot(p[0] - centres[i * 2]! / scale, p[1] - centres[i * 2 + 1]! / scale);
    d.push(v);
    dmin = Math.min(dmin, v);
  }
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i < count; i++) {
    const k = Math.pow((dmin + SKY_BLEND_EPS) / (d[i]! + SKY_BLEND_EPS), SKY_BLEND_POWER);
    r += colours[i * 3]! * k; g += colours[i * 3 + 1]! * k; b += colours[i * 3 + 2]! * k; w += k;
  }
  return w > 0 ? [r / w, g / w, b / w] : [(SKY_MIN + SKY_MAX) / 2, (SKY_MIN + SKY_MAX) / 2, (SKY_MIN + SKY_MAX) / 2];
}

type RGB = readonly [number, number, number];

/** Desaturate toward luminance by SKY_DESAT, then clamp every channel to SKY_MIN..SKY_MAX. */
export function gradeSkyColour(rgb: RGB): [number, number, number] {
  const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const f = (v: number) => Math.min(SKY_MAX, Math.max(SKY_MIN, l + (v - l) * (1 - SKY_DESAT)));
  return [f(rgb[0]), f(rgb[1]), f(rgb[2])];
}

function relativeLuminance(rgb: RGB): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** WCAG contrast ratio of white text/stars against this sRGB (0-1) colour. */
export function contrastWithWhite(rgb: RGB): number {
  return 1.05 / (relativeLuminance(rgb) + 0.05);
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function skyUniforms(
  colourSeed: string,
  regions: readonly Region[],
): { centres: Float32Array; colours: Float32Array; count: number } {
  const valid = regions.filter((r) => Number.isFinite(r.id) && Number.isFinite(r.x) && Number.isFinite(r.y));
  const sorted = [...valid].sort((a, b) => a.id - b.id).slice(0, MAX_SKY_REGIONS);
  const palette = regionColours(colourSeed, sorted);
  const centres = new Float32Array(MAX_SKY_REGIONS * 2);
  const colours = new Float32Array(MAX_SKY_REGIONS * 3);
  sorted.forEach((r, i) => {
    centres[i * 2] = r.x;
    centres[i * 2 + 1] = r.y;
    colours.set(parseHex(palette.get(r.id)!), i * 3); // raw: the shader grades the blend once
  });
  return { centres, colours, count: sorted.length };
}
