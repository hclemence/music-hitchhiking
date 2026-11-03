import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Hop, Song } from '../backend/types.ts';
import { layoutMiniMap } from './miniMapLayout.ts';

type Props = {
  hops: Hop[];
  currentHopId: string;
  songs: ReadonlyMap<string, Song>;
  /** Moving is disabled while a hop is in flight. */
  disabled: boolean;
  onMoveTo: (hopId: string) => void;
};

type Placed = { id: string; cx: number; cy: number; current: boolean };

function place(hops: Hop[], currentHopId: string, w: number, h: number, pad: number, maxStep: number) {
  const { nodes, edges } = layoutMiniMap(hops, currentHopId);
  const maxX = Math.max(0, ...nodes.map((n) => n.x));
  const maxY = Math.max(0, ...nodes.map((n) => n.y));
  const sx = maxX > 0 ? Math.min(maxStep, (w - 2 * pad) / maxX) : 0;
  const sy = maxY > 0 ? Math.min(maxStep, (h - 2 * pad) / maxY) : 0;
  const ox = (w - sx * maxX) / 2;
  const oy = (h - sy * maxY) / 2;
  const placed: Placed[] = nodes.map((n) => ({ id: n.id, cx: ox + n.x * sx, cy: oy + n.y * sy, current: n.current }));
  const at = new Map(placed.map((p) => [p.id, p]));
  return { placed, edges: edges.map((e) => ({ ...e, a: at.get(e.from)!, b: at.get(e.to)! })), depth: maxY };
}

function Edges({ edges }: { edges: ReturnType<typeof place>['edges'] }) {
  return (
    <>
      {edges.map((e) => (
        <line
          key={`${e.from}-${e.to}`}
          className="mm-edge"
          x1={e.a.cx} y1={e.a.cy} x2={e.b.cx} y2={e.b.cy}
          strokeDasharray={e.dashed ? '4 4' : undefined}
          data-dashed={e.dashed ? 'true' : 'false'}
        />
      ))}
    </>
  );
}

/** Today's route as a tree in the corner; tap to enlarge, tap a stop to move back there. */
export function MiniMap({ hops, currentHopId, songs, disabled, onMoveTo }: Props) {
  const [open, setOpen] = useState(false);
  const small = useMemo(() => place(hops, currentHopId, 96, 96, 12, 24), [hops, currentHopId]);
  const bigH = Math.min(420, Math.max(160, small.depth * 56 + 64));
  const big = useMemo(() => (open ? place(hops, currentHopId, 358, bigH, 28, 56) : null), [open, hops, currentHopId, bigH]);
  const label = (id: string) => {
    const h = hops.find((x) => x.id === id);
    const s = h ? songs.get(h.songId) : undefined;
    return s ? `${s.title} by ${s.artist}` : 'a stop';
  };

  return (
    <>
      <button
        type="button"
        className="minimap"
        aria-label={`Route map, ${hops.length} ${hops.length === 1 ? 'stop' : 'stops'}`}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
          <Edges edges={small.edges} />
          {small.placed.map((n) => (
            <circle
              key={n.id} data-node className={n.current ? 'mm-node current' : 'mm-node'}
              cx={n.cx} cy={n.cy} r={n.current ? 6 : 4}
            />
          ))}
        </svg>
      </button>
      {open && big && createPortal(
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div
            className="route-sheet" role="dialog" aria-modal="true" aria-label="Your route today"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="route-head">
              <h2>Your route today</h2>
              <button type="button" className="secondary" onClick={() => setOpen(false)}>Close</button>
            </div>
            <p className="hint">Tap a stop to go back there. Hitchhiking from it starts a branch.</p>
            <svg viewBox={`0 0 358 ${bigH}`} className="route-svg" role="group" aria-label="Stops">
              <Edges edges={big.edges} />
              {big.placed.map((n) => {
                const name = label(n.id);
                return (
                  <g
                    key={n.id}
                    role="button"
                    tabIndex={n.current || disabled ? -1 : 0}
                    aria-disabled={n.current || disabled ? 'true' : undefined}
                    aria-label={n.current ? `${name} (you are here)` : `Go back to ${name}`}
                    className="mm-stop"
                    onClick={() => {
                      if (n.current || disabled) return;
                      onMoveTo(n.id);
                      setOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && !n.current && !disabled) {
                        e.preventDefault();
                        onMoveTo(n.id);
                        setOpen(false);
                      }
                    }}
                  >
                    <circle cx={n.cx} cy={n.cy} r={22} className="mm-hit" />
                    <circle cx={n.cx} cy={n.cy} r={n.current ? 12 : 9} className={n.current ? 'mm-node current' : 'mm-node'} />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
