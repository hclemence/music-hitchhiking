import type { Region } from '../backend/types.ts';
import { regionColours } from './stars.ts';

export const SKY_MIN = 0.17;
export const SKY_MAX = 0.64;
export const SKY_DESAT = 0.15;
export const MAX_SKY_REGIONS = 64;

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
