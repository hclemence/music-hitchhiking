import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Hop } from '../backend/types.ts';
import { createShipTapGate, pickNearest } from './controls.ts';
import { resolveTap, routeSegments } from './route.ts';

const LIFT = 0.5; // above the plane: under ships, over the sky
const PICK_RADIUS_PX = 32;
const DASH_SCREEN_PX = 9; // dash and gap length on screen
type Pos = (songId: string) => { x: number; y: number } | null;
type LineMat = { dashSize: number; gapSize: number };

function toPoints(segs: { from: { x: number; y: number }; to: { x: number; y: number } }[]): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (const s of segs) pts.push(new THREE.Vector3(s.from.x, LIFT, s.from.y), new THREE.Vector3(s.to.x, LIFT, s.to.y));
  return pts;
}

/**
 * Today's route as a faint glowing trail: a thin bright core over a wider soft halo, dashed for jumps.
 * Taps on a visited star call `onVisitedTap` (deferred so a double-tap focus cancels it; ships win).
 */
export function Route({
  hops, posOf, visitedIds, visitedPositions, shipHit, onVisitedTap,
}: {
  hops: Hop[];
  posOf: Pos;
  /** Visited star ids and their world positions (x, 0, y triples), index-aligned. */
  visitedIds: string[];
  visitedPositions: Float32Array;
  /** Set by the ships layer: is a drawn ship within tap range of this screen point? */
  shipHit: React.RefObject<((px: number, py: number) => boolean) | null>;
  onVisitedTap?: (songId: string) => void;
}) {
  const { gl, camera, size } = useThree();
  const segs = useMemo(() => routeSegments(hops, (id) => posOf(id) ?? undefined), [hops, posOf]);
  const solid = useMemo(() => toPoints(segs.filter((s) => !s.dashed)), [segs]);
  const dashed = useMemo(() => toPoints(segs.filter((s) => s.dashed)), [segs]);
  const mats = useRef<LineMat[]>([]);
  const reg = (m: unknown) => { if (m && !mats.current.includes(m as LineMat)) mats.current.push(m as LineMat); };

  // Keep dashes a constant length on screen: world length per pixel at the camera's distance.
  useFrame(() => {
    if (!dashed.length) return;
    const persp = camera as THREE.PerspectiveCamera;
    const dist = startDistanceFrom(persp);
    const perPx = (2 * dist * Math.tan((persp.fov * Math.PI) / 360)) / size.height;
    for (const m of mats.current) { m.dashSize = perPx * DASH_SCREEN_PX; m.gapSize = perPx * DASH_SCREEN_PX; }
  });

  const cb = useRef(onVisitedTap);
  cb.current = onVisitedTap;
  useEffect(() => {
    const el = gl.domElement;
    const gate = createShipTapGate();
    const active = new Set<number>();
    let down: { x: number; y: number; t: number; multi: boolean; second: boolean } | null = null;
    const v = new THREE.Vector3();
    const onDown = (ev: PointerEvent) => {
      active.add(ev.pointerId);
      const second = gate.down(ev.clientX, ev.clientY);
      down = { x: ev.clientX, y: ev.clientY, t: performance.now(), multi: active.size > 1, second };
    };
    const onCancel = (ev: PointerEvent) => { active.delete(ev.pointerId); down = null; };
    const onUp = (ev: PointerEvent) => {
      active.delete(ev.pointerId);
      const d = down;
      down = null;
      if (!d || d.multi || d.second || active.size > 0) return;
      if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 10 || performance.now() - d.t > 400) return;
      const rect = el.getBoundingClientRect();
      const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      const i = pickNearest(visitedIds.length, (k) => {
        v.set(visitedPositions[k * 3]!, visitedPositions[k * 3 + 1]!, visitedPositions[k * 3 + 2]!).project(camera);
        if (v.z > 1) return null;
        return { x: (v.x * 0.5 + 0.5) * rect.width, y: (-v.y * 0.5 + 0.5) * rect.height, depth: v.z };
      }, px, py, PICK_RADIUS_PX);
      const action = resolveTap(shipHit.current?.(px, py) ?? false, i >= 0 ? visitedIds[i]! : null);
      if (action?.kind !== 'visited') return;
      gate.tap(ev.clientX, ev.clientY, () => cb.current?.(action.songId));
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      gate.dispose();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, [gl, camera, visitedIds, visitedPositions, shipHit]);

  const common = { transparent: true, depthWrite: false, toneMapped: false } as const;
  return (
    <group renderOrder={1}>
      {solid.length > 0 && (
        <>
          <Line points={solid} segments lineWidth={7} color="#ffffff" opacity={0.1} {...common} />
          <Line points={solid} segments lineWidth={2} color="#ffffff" opacity={0.45} {...common} />
        </>
      )}
      {dashed.length > 0 && (
        <>
          <Line ref={(l) => reg(l?.material)} points={dashed} segments dashed dashSize={4} gapSize={4} lineWidth={7} color="#ffffff" opacity={0.1} {...common} />
          <Line ref={(l) => reg(l?.material)} points={dashed} segments dashed dashSize={4} gapSize={4} lineWidth={2} color="#ffffff" opacity={0.45} {...common} />
        </>
      )}
    </group>
  );
}

const _t = new THREE.Vector3();
function startDistanceFrom(cam: THREE.Camera): number {
  // The controls' target stays on the plane, so the camera-to-plane-point distance along the view ray.
  cam.getWorldDirection(_t);
  return _t.y < -1e-3 ? Math.abs(cam.position.y / _t.y) : cam.position.length();
}
