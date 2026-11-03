import type { Hop } from '../backend/types.ts';

export type MiniMapLayout = {
  nodes: { id: string; x: number; y: number; current: boolean }[];
  edges: { from: string; to: string; dashed: boolean }[];
};

/** Tidy tree: leaves take consecutive x slots in DFS order; parents sit centred over their children. */
export function layoutMiniMap(hops: Hop[], currentHopId: string): MiniMapLayout {
  const byId = new Map(hops.map((h) => [h.id, h]));
  const children = new Map<string, Hop[]>();
  const roots: Hop[] = [];
  for (const h of hops) {
    if (h.parentHopId && byId.has(h.parentHopId)) {
      const list = children.get(h.parentHopId) ?? [];
      list.push(h);
      children.set(h.parentHopId, list);
    } else roots.push(h);
  }
  const byTime = (a: Hop, b: Hop) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  roots.sort(byTime);

  const nodes: MiniMapLayout['nodes'] = [];
  const edges: MiniMapLayout['edges'] = [];
  let nextLeaf = 0;
  const place = (h: Hop, depth: number): number => {
    const kids = (children.get(h.id) ?? []).sort(byTime);
    let x: number;
    const index = nodes.length;
    nodes.push({ id: h.id, x: 0, y: depth, current: h.id === currentHopId });
    if (kids.length === 0) x = nextLeaf++;
    else {
      const xs = kids.map((k) => {
        edges.push({ from: h.id, to: k.id, dashed: k.kind === 'jump' });
        return place(k, depth + 1);
      });
      x = (xs[0]! + xs[xs.length - 1]!) / 2;
    }
    nodes[index]!.x = x;
    return x;
  };
  for (const r of roots) place(r, 0);
  return { nodes, edges };
}
