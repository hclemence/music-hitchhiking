import { describe, expect, it } from 'vitest';
import type { Hop } from '../backend/types.ts';
import { layoutMiniMap } from './miniMapLayout.ts';

let t = 0;
const hop = (id: string, parent: string | null, kind: Hop['kind'] = 'hitchhike'): Hop => ({
  id, parentHopId: parent, songId: 's' + id, kind,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString(),
});
const node = (l: ReturnType<typeof layoutMiniMap>, id: string) => l.nodes.find((n) => n.id === id)!;

describe('layoutMiniMap', () => {
  it('lays a chain out as a vertical line', () => {
    const l = layoutMiniMap([hop('a', null, 'start'), hop('b', 'a'), hop('c', 'b')], 'c');
    expect(l.nodes.map((n) => [n.x, n.y])).toEqual([[0, 0], [0, 1], [0, 2]]);
    expect(l.edges).toEqual([
      { from: 'a', to: 'b', dashed: false },
      { from: 'b', to: 'c', dashed: false },
    ]);
  });

  it('puts branch children at the same depth with distinct x, parent centred', () => {
    const l = layoutMiniMap([hop('a', null, 'start'), hop('b', 'a'), hop('c', 'a')], 'b');
    expect(node(l, 'b').y).toBe(1);
    expect(node(l, 'c').y).toBe(1);
    expect(node(l, 'b').x).not.toBe(node(l, 'c').x);
    expect(node(l, 'a').x).toBe((node(l, 'b').x + node(l, 'c').x) / 2);
  });

  it('never overlaps nodes in a deeper tree', () => {
    const l = layoutMiniMap(
      [hop('a', null, 'start'), hop('b', 'a'), hop('c', 'a'), hop('d', 'b'), hop('e', 'b'), hop('f', 'c')],
      'f',
    );
    const keys = l.nodes.map((n) => `${n.x},${n.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(node(l, 'd').x).toBeLessThan(node(l, 'e').x);
    expect(node(l, 'e').x).toBeLessThan(node(l, 'f').x);
  });

  it('dashes jump edges and marks exactly one current node', () => {
    const l = layoutMiniMap([hop('a', null, 'start'), hop('b', 'a', 'jump'), hop('c', 'a')], 'c');
    expect(l.edges.find((e) => e.to === 'b')!.dashed).toBe(true);
    expect(l.edges.find((e) => e.to === 'c')!.dashed).toBe(false);
    expect(l.nodes.filter((n) => n.current).map((n) => n.id)).toEqual(['c']);
  });

  it('handles empty input', () => {
    expect(layoutMiniMap([], 'x')).toEqual({ nodes: [], edges: [] });
  });
});
