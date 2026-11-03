import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createFocus, createTapGesture, DEFAULT_VISIBLE_WIDTH, distanceForWidth, FOCUS_MS, MAX_VISIBLE_WIDTH, MIN_VISIBLE_WIDTH, pickNearest,
} from './controls.ts';

const ptr = (t: number, x = 100, y = 100, over: Partial<{ isPrimary: boolean; pointerId: number }> = {}) =>
  ({ isPrimary: true, pointerId: 1, clientX: x, clientY: y, timeStamp: t, ...over });

function tap(g: ReturnType<typeof createTapGesture>, t: number, x = 100, y = 100, upX = x, upY = y) {
  g.down(ptr(t, x, y));
  g.up(ptr(t + 40, upX, upY));
}

describe('double-tap focus gesture', () => {
  it('two quick taps in one place report the second tap position', () => {
    const onDoubleTap = vi.fn();
    const g = createTapGesture(onDoubleTap);
    tap(g, 0);
    expect(onDoubleTap).not.toHaveBeenCalled();
    tap(g, 200, 104, 98);
    expect(onDoubleTap).toHaveBeenCalledWith(104, 98);
  });

  it('a drag (orbit) is not a tap', () => {
    const onDoubleTap = vi.fn();
    const g = createTapGesture(onDoubleTap);
    tap(g, 0);
    tap(g, 200, 100, 100, 160, 100);
    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it('slow taps and a second finger (pinch) do not count', () => {
    const onDoubleTap = vi.fn();
    const g = createTapGesture(onDoubleTap);
    tap(g, 0);
    tap(g, 1000);
    expect(onDoubleTap).not.toHaveBeenCalled();
    g.down(ptr(1100, 100, 100, { isPrimary: false, pointerId: 2 }));
    g.up(ptr(1140, 100, 100, { isPrimary: false, pointerId: 2 }));
    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it('with pickNearest, the double tap lands on the nearest star on screen', () => {
    const screen = [{ x: 10, y: 10 }, { x: 105, y: 96 }, { x: 300, y: 300 }];
    const picked: number[] = [];
    const g = createTapGesture((x, y) => {
      picked.push(pickNearest(screen.length, (i) => ({ ...screen[i]!, depth: 0 }), x, y, 32));
    });
    tap(g, 0);
    tap(g, 150);
    expect(picked).toEqual([1]);
  });
});

describe('createFocus', () => {
  it('eases the orbit centre from where it was to the tapped star, then stops', () => {
    const f = createFocus();
    const from = new THREE.Vector3(0, 0, 0);
    const to = new THREE.Vector3(100, 0, -50);
    const out = new THREE.Vector3();
    expect(f.step(0, out)).toBe(false);
    f.focus(from, to, 1000);
    from.set(9, 9, 9); // the caller's vector may move on: focus keeps its own copy
    expect(f.step(1000, out)).toBe(true);
    expect(out.toArray()).toEqual([0, 0, 0]);
    f.step(1000 + FOCUS_MS / 2, out);
    expect(out.x).toBeCloseTo(50);
    expect(out.z).toBeCloseTo(-25);
    expect(f.step(1000 + FOCUS_MS, out)).toBe(true);
    expect(out.toArray()).toEqual([100, 0, -50]);
    expect(f.active).toBe(false);
    expect(f.step(1000 + FOCUS_MS + 16, out)).toBe(false);
  });

  it('cancel stops a running focus (the current star changed or a flight started)', () => {
    const f = createFocus();
    f.focus(new THREE.Vector3(), new THREE.Vector3(1, 1, 1), 0);
    expect(f.active).toBe(true);
    f.cancel();
    expect(f.step(10, new THREE.Vector3())).toBe(false);
  });
});

describe('distanceForWidth', () => {
  it('is the distance at which the width fills the viewport', () => {
    const d = distanceForWidth(600, 50, 0.5);
    expect(2 * d * Math.tan((50 * Math.PI) / 360) * 0.5).toBeCloseTo(600);
  });
  it('orders the zoom limits', () => {
    expect(distanceForWidth(MIN_VISIBLE_WIDTH, 50, 0.46)).toBeLessThan(distanceForWidth(DEFAULT_VISIBLE_WIDTH, 50, 0.46));
    expect(distanceForWidth(DEFAULT_VISIBLE_WIDTH, 50, 0.46)).toBeLessThan(distanceForWidth(MAX_VISIBLE_WIDTH, 50, 0.46));
  });
});
