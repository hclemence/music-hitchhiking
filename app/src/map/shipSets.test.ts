import { describe, expect, it, vi } from 'vitest';
import { createShipTapGate } from './controls.ts';
import { buildSets } from './shipSets.ts';

describe('buildSets lifecycle', () => {
  it('keeps its meshes after dispose (StrictMode cleanup + re-run) and survives a double dispose', () => {
    const built = buildSets(10);
    const n = built.group.children.length;
    expect(n).toBeGreaterThan(0);
    built.dispose();
    built.dispose();
    expect(built.group.children.length).toBe(n);
  });
  it('shares geometry between builds', () => {
    const a = buildSets(2), b = buildSets(20);
    expect((a.group.children[0] as unknown as { geometry: unknown }).geometry).toBe((b.group.children[0] as unknown as { geometry: unknown }).geometry);
  });
});

describe('createShipTapGate', () => {
  it('fires a lone tap after the delay', () => {
    vi.useFakeTimers();
    const fn = vi.fn(); const g = createShipTapGate(320);
    g.tap(10, 10, fn);
    vi.advanceTimersByTime(319); expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2); expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it('drops the tap when a second press lands close by (double-tap)', () => {
    vi.useFakeTimers();
    const fn = vi.fn(); const g = createShipTapGate(320);
    g.tap(10, 10, fn);
    vi.advanceTimersByTime(150);
    expect(g.down(20, 15)).toBe(true);
    vi.advanceTimersByTime(1000); expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('fires at once when the next press is far away', () => {
    vi.useFakeTimers();
    const fn = vi.fn(); const g = createShipTapGate(320);
    g.tap(10, 10, fn);
    expect(g.down(200, 200)).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
