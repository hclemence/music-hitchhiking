import { describe, expect, it } from 'vitest';
import { buildShuttle } from './shuttle.ts';
import { fitDistance } from './shipThumbnail.ts';

describe('fitDistance', () => {
  it('keeps the whole shuttle (outline included) inside the frame with a margin', () => {
    const o = buildShuttle().outline;
    o.computeBoundingSphere();
    const r = o.boundingSphere!.radius;
    const fov = 32;
    const d = fitDistance(r, fov);
    expect(r / d).toBeLessThan(Math.sin((fov * Math.PI) / 360) * 0.95);
  });
});
