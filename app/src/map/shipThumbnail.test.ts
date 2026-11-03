import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildShuttle } from './shuttle.ts';

const gl = vi.hoisted(() => ({ lost: false, renders: 0, canvas: null as null | HTMLCanvasElement }));

vi.mock('three', async (orig) => {
  const real = await orig<typeof import('three')>();
  class FakeRenderer {
    domElement = (() => {
      const c = document.createElement('canvas');
      // A lost context reads back a blank image; a live one a unique picture.
      c.toDataURL = () => (gl.lost ? 'data:image/png;base64,BLANK' : `data:image/png;base64,PIC${gl.renders}`);
      gl.canvas = c;
      return c;
    })();
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    dispose() {}
    getContext() { return { isContextLost: () => gl.lost }; }
    render() { gl.renders++; }
  }
  return { ...real, WebGLRenderer: FakeRenderer };
});

import { fitDistance, resetThumbnails, scheduleThumbnailWarmup, shipThumbnail, ThumbnailRetryError } from './shipThumbnail.ts';

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

describe('shipThumbnail with a lost WebGL context', () => {
  beforeEach(() => { resetThumbnails(); gl.lost = false; gl.renders = 0; });

  it('renders once per colour and caches', async () => {
    const a = await shipThumbnail('#ff0000', 40);
    expect(await shipThumbnail('#ff0000', 40)).toBe(a);
    expect(gl.renders).toBe(1);
  });

  it('never caches a blank image: lost contexts reject (retryable), and it recovers once restored', async () => {
    await shipThumbnail('#00ff00', 40); // creates the renderer
    gl.lost = true;
    gl.canvas!.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    const err = await shipThumbnail('#0000ff', 40).catch((e) => e);
    expect(err).toBeInstanceOf(ThumbnailRetryError);
    expect(err.retryable).toBe(true);
    // The first colour was cached before the loss; the second was not.
    gl.lost = false;
    gl.canvas!.dispatchEvent(new Event('webglcontextrestored'));
    const url = await shipThumbnail('#0000ff', 40);
    expect(url).not.toContain('BLANK');
    expect(await shipThumbnail('#0000ff', 40)).toBe(url);
  });

  it('rejects when the context is lost during the render itself', async () => {
    await shipThumbnail('#00ff00', 40);
    gl.lost = true; // no event yet: only isContextLost() knows
    await expect(shipThumbnail('#123456', 40)).rejects.toBeInstanceOf(ThumbnailRetryError);
    gl.lost = false;
    expect(await shipThumbnail('#123456', 40)).not.toContain('BLANK');
  });

  it('warms up when idle (timer fallback) by creating the renderer without caching', async () => {
    vi.useFakeTimers();
    const cancel = scheduleThumbnailWarmup();
    expect(gl.renders).toBe(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(gl.renders).toBe(1);
    vi.useRealTimers();
    cancel();
    await shipThumbnail('#abcdef', 40);
    expect(gl.renders).toBe(2);
  });
});
