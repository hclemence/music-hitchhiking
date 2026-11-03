import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildShuttle, buildSimpleShuttle, createOutlineMaterial, shipWorldLength } from './shuttle.ts';

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
  const pxOf = (len: number, dist = d) => (len / (2 * dist * Math.tan((fov * Math.PI) / 360))) * vh;
  it('projects to 24 px by default', () => {
    expect(pxOf(shipWorldLength(d, fov, vh))).toBeCloseTo(24, 3);
  });
  it('never drops below 14 px', () => {
    expect(pxOf(shipWorldLength(d, fov, vh, { targetPx: 5 }))).toBeGreaterThanOrEqual(14 - 1e-6);
  });
  it('is 1.2x larger when mine', () => {
    expect(shipWorldLength(d, fov, vh, { mine: true })).toBeCloseTo(shipWorldLength(d, fov, vh) * 1.2, 6);
  });
});
