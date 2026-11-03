import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildShuttle, buildSimpleShuttle, createOutlineMaterial, outlineWidthDevicePx, shipWorldLength, syncOutlineUniforms } from './shuttle.ts';

function box(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  return g.boundingBox!;
}

describe('buildShuttle', () => {
  const s = buildShuttle();
  it('has non-empty geometries', () => {
    for (const g of [s.paint, s.glass, s.glow, s.outline]) {
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
    }
  });
  it('is one unit long, wide and low', () => {
    const b = box(s.paint);
    const len = b.max.z - b.min.z;
    expect(len).toBeGreaterThan(0.99);
    expect(len).toBeLessThan(1.01);
    const width = (b.max.x - b.min.x) / len;
    const height = (b.max.y - b.min.y) / len;
    expect(width).toBeGreaterThan(0.9);
    expect(width).toBeLessThan(1.4);
    expect(height).toBeLessThan(0.75);
  });
  it('has flat glow discs (no cones)', () => {
    const p = s.glow.getAttribute('position');
    // each glow vertex shares its z with a flat disc: group by z and check there are few distinct planes
    const zs: number[] = [];
    for (let i = 0; i < p.count; i++) zs.push(p.getZ(i));
    const planes: number[] = [];
    for (const z of zs) if (!planes.some((q) => Math.abs(q - z) <= 0.02)) planes.push(z);
    expect(planes.length).toBeLessThanOrEqual(2);
  });
  it('welds the outline with unit normals', () => {
    expect(s.outline.getAttribute('position').count)
      .toBeLessThan(s.paint.getAttribute('position').count + s.glass.getAttribute('position').count);
    const n = s.outline.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
    }
  });
});

describe('buildSimpleShuttle', () => {
  it('is one unit long with an outline', () => {
    const s = buildSimpleShuttle();
    const b = box(s.paint);
    expect(b.max.z - b.min.z).toBeCloseTo(1, 2);
    expect(s.outline.getAttribute('position').count).toBeGreaterThan(0);
  });
});

describe('createOutlineMaterial', () => {
  it('is a white back-face shader with a pixel width', () => {
    const m = createOutlineMaterial();
    expect(m.side).toBe(THREE.BackSide);
    expect(m.uniforms.uWidthPx!.value).toBe(2);
    expect(m.uniforms.uColor!.value.getHex()).toBe(0xffffff);
    expect(createOutlineMaterial(4).uniforms.uWidthPx!.value).toBe(4);
  });
});

describe('shipWorldLength', () => {
  const fov = 40, vh = 800, d = 300;
  const pxOf = (len: number, dist: number) => (len / (2 * dist * Math.tan((fov * Math.PI) / 360))) * vh;
  it('projects to 24 px at the default distance (the camera distance when omitted)', () => {
    expect(pxOf(shipWorldLength(d, fov, vh), d)).toBeCloseTo(24, 3);
    expect(pxOf(shipWorldLength(d, fov, vh, { defaultDistance: d }), d)).toBeCloseTo(24, 3);
  });
  it('has a fixed world length: shrinks naturally when farther, then floors at 14 px', () => {
    expect(pxOf(shipWorldLength(d * 1.5, fov, vh, { defaultDistance: d }), d * 1.5)).toBeCloseTo(16, 3);
    expect(pxOf(shipWorldLength(d * 10, fov, vh, { defaultDistance: d }), d * 10)).toBeCloseTo(14, 3);
  });
  it('grows naturally when closer, then caps at 48 px', () => {
    expect(pxOf(shipWorldLength(d / 1.5, fov, vh, { defaultDistance: d }), d / 1.5)).toBeCloseTo(36, 3);
    expect(pxOf(shipWorldLength(d / 10, fov, vh, { defaultDistance: d }), d / 10)).toBeCloseTo(48, 3);
  });
  it('is 1.2x larger when mine, applied after clamping', () => {
    expect(shipWorldLength(d, fov, vh, { mine: true })).toBeCloseTo(shipWorldLength(d, fov, vh) * 1.2, 6);
    const far = shipWorldLength(d * 10, fov, vh, { defaultDistance: d, mine: true });
    expect(pxOf(far, d * 10)).toBeCloseTo(14 * 1.2, 3);
  });
});

describe('syncOutlineUniforms', () => {
  it('uses drawing-buffer pixels and scales the CSS width by the pixel ratio', () => {
    const m = createOutlineMaterial(2);
    syncOutlineUniforms(m, 800, 600, 2);
    expect(m.uniforms.uResolution!.value.toArray()).toEqual([800, 600]);
    expect(m.uniforms.uPixelRatio!.value).toBe(2);
    expect(outlineWidthDevicePx(m)).toBe(4);
    expect(m.uniforms.uWidthPx!.value).toBe(2);
  });
});
