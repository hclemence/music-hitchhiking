import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { PublicDock } from '@core/types.ts';
import type { ShownEncounter } from '../state/useExplore.ts';
import { ambientOffset, arcPoint, fanSlot, parkingSlot, selectShipLod } from './motion.ts';
import { shipWorldLength } from './shuttle.ts';
import { createShipTapGate, MAP_FOV, pickNearest } from './controls.ts';
import { buildEntries, type Entry } from './shipEntries.ts';
import { buildSets } from './shipSets.ts';
import { FLY_IN_MS } from '../state/encounterFlow.ts';

/** Where your own ship is this frame (ground x/y, height h, ship length), written by MyShip. */
export type MyPose = { x: number; y: number; h: number; len: number };

const RESELECT_MS = 250;
const TAP_RADIUS_PX = 24;
const LOW_MAX_FULL = 40;
const MAX_FULL = 150;
const LIFT = 0.25; // ship centre above the plane, in lengths
const DRIFT_SPEED = 3.5; // units/s above which a ship turns to face where it is going

export type ShipsProps = {
  docks: PublicDock[];
  myDockId: string | null;
  currentSongId: string;
  parked: ShownEncounter[];
  arriving: { dockId: string; startedAt: number } | null;
  posOf: (songId: string) => { x: number; y: number } | null;
  pose: React.RefObject<MyPose>;
  controls: React.RefObject<{ target: THREE.Vector3 } | null>;
  startDistance: number;
  quality: 'high' | 'low';
  reducedMotion: boolean;
  onShipTap?: (dockId: string) => void;
  /** Filled in by the ships layer: is a drawn ship within tap range of this screen point? */
  shipHit?: React.MutableRefObject<((px: number, py: number) => boolean) | null>;
};

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function Ships(props: ShipsProps) {
  const { docks, myDockId, currentSongId, parked, arriving, posOf, quality, reducedMotion } = props;
  const { gl, camera } = useThree();

  // Rebuild entries only when what they depend on changes, not when the arrays are re-created.
  const contentKey = [
    myDockId, currentSongId, arriving ? `${arriving.dockId}@${arriving.startedAt}` : '',
    parked.map((q) => q.dock.id).join(','),
    docks.map((d) => `${d.id}:${d.songId}:${d.updatedAt}:${d.shipColour}:${d.isSample ? 1 : 0}`).join('|'),
  ].join('#');
  const latest = useRef({ docks, parked, arriving });
  latest.current = { docks, parked, arriving };
  const entries = useMemo(
    () => buildEntries(latest.current.docks, myDockId, currentSongId, latest.current.parked, latest.current.arriving, posOf),
    [contentKey, posOf], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const capacity = Math.max(1, entries.length);
  const built = useMemo(() => buildSets(capacity), [capacity]);
  useEffect(() => () => built.dispose(), [built]);

  // Everything the frame loop touches, allocated once per entries/sets change.
  const work = useMemo(() => ({
    wx: new Float32Array(capacity), wy: new Float32Array(capacity), wz: new Float32Array(capacity),
    byId: new Map(entries.map((e, i) => [e.dockId, i])),
    fanIdx: [] as number[],
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3(), mat: new THREE.Matrix4(),
    colour: new THREE.Color(), up: new THREE.Vector3(0, 1, 0),
    amb: { dx: 0, dy: 0, dh: 0 }, amb2: { dx: 0, dy: 0, dh: 0 },
    arc: { x: 0, y: 0, h: 0 }, from: { x: 0, y: 0 }, to: { x: 0, y: 0 },
    proj: new THREE.Vector3(),
    lastSel: -1e9, lastLen: 0, lastTx: 0, lastTy: 0, lastDist: 0, dirty: true,
  }), [entries, capacity]);
  const qualityKey = useRef(quality);
  if (qualityKey.current !== quality) { qualityKey.current = quality; work.dirty = true; }
  useEffect(() => { work.dirty = true; }, [work]);

  const propsRef = useRef(props);
  propsRef.current = props;

  const reselect = (tx: number, ty: number, dist: number, aspect: number) => {
    const { sets } = built;
    const maxFull = propsRef.current.quality === 'low' ? LOW_MAX_FULL : MAX_FULL;
    const tan = Math.tan((MAP_FOV * Math.PI) / 360);
    const halfHeight = dist * tan * 2.1 + 20;
    const halfWidth = dist * tan * aspect * 1.7 + 20;
    const fanList: { dockId: string; x: number; y: number }[] = [];
    for (const e of entries) if (e.kind === 0) fanList.push({ dockId: e.dockId, x: e.star.x, y: e.star.y });
    const lod = selectShipLod(fanList, { x: tx, y: ty, halfWidth, halfHeight }, maxFull);
    for (const e of entries) e.lod = e.kind === 0 ? 0 : 1;
    for (const id of lod.full) entries[work.byId.get(id)!]!.lod = 1;
    for (const id of lod.simple) entries[work.byId.get(id)!]!.lod = 2;
    for (const s of sets) s.count = 0;
    for (const e of entries) {
      if (e.lod === 0) continue;
      e.set = (e.lod === 1 ? 0 : 2) + (e.sample ? 1 : 0);
      const s = sets[e.set]!;
      e.inst = s.count++;
      work.colour.set(e.colour);
      s.paint.setColorAt(e.inst, work.colour);
    }
    for (const s of sets) {
      for (const m of s.meshes) m.count = s.count;
      if (s.paint.instanceColor) s.paint.instanceColor.needsUpdate = true;
    }
  };

  const writeMatrix = (e: Entry, i: number, x: number, h: number, z: number, yaw: number, len: number) => {
    work.pos.set(x, h, z);
    work.quat.setFromAxisAngle(work.up, yaw);
    work.scale.setScalar(len);
    work.mat.compose(work.pos, work.quat, work.scale);
    built.sets[e.set]!.paint.setMatrixAt(e.inst, work.mat);
    work.wx[i] = x; work.wy[i] = h; work.wz[i] = z;
  };

  useFrame(({ size }, delta) => {
    const p = propsRef.current;
    const c = p.controls.current;
    const tx = c ? c.target.x : 0, ty = c ? c.target.z : 0;
    const dist = c ? camera.position.distanceTo(c.target) : p.startDistance;
    const len = shipWorldLength(dist, MAP_FOV, size.height, { defaultDistance: p.startDistance });
    const now = performance.now();
    const aspect = size.width / Math.max(1, size.height);
    const tan = Math.tan((MAP_FOV * Math.PI) / 360);
    const moved = Math.hypot(tx - work.lastTx, ty - work.lastTy) > dist * tan * 0.4 || Math.abs(dist - work.lastDist) > dist * 0.08;
    let reselected = false;
    if (work.dirty || moved || now - work.lastSel > RESELECT_MS) {
      reselect(tx, ty, dist, aspect);
      work.lastSel = now; work.lastTx = tx; work.lastTy = ty; work.lastDist = dist; work.dirty = false;
      reselected = true;
    }
    const lenChanged = Math.abs(len - work.lastLen) > work.lastLen * 0.005;
    work.lastLen = len;
    const drift = p.quality === 'high';
    const t = (p.reducedMotion ? now * 0.25 : now);
    const k = Math.min(1, delta * 6);
    const pose = p.pose.current;
    let touched = false;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.lod === 0) continue;
      if (e.kind === 0) {
        const slot = fanSlot(e.fan);
        const bx = e.star.x + slot.dx * len, bz = e.star.y + slot.dy * len;
        if (e.lod === 1) {
          ambientOffset(e.dockId, t, work.amb, drift);
          ambientOffset(e.dockId, t + 60, work.amb2, drift);
          const speed = Math.hypot(work.amb2.dx - work.amb.dx, work.amb2.dy - work.amb.dy) / 0.06;
          if (speed > DRIFT_SPEED) {
            const target = Math.atan2(-(work.amb2.dx - work.amb.dx), -(work.amb2.dy - work.amb.dy));
            e.yaw += wrapPi(target - e.yaw) * k;
          } else {
            e.yaw += wrapPi(e.baseYaw - e.yaw) * k;
          }
          writeMatrix(e, i, bx + work.amb.dx, len * LIFT + work.amb.dh, bz + work.amb.dy, e.yaw, len);
          touched = true;
        } else if (reselected || lenChanged) {
          writeMatrix(e, i, bx, len * LIFT, bz, e.baseYaw, len);
          touched = true;
        }
        continue;
      }
      // parked / arriving: beside your ship, at its pose
      const ps = parkingSlot(e.park);
      const mx = pose ? pose.x : e.star.x, mz = pose ? pose.y : e.star.y, mh = pose ? pose.h : 0;
      const px = mx + ps.dx * len, pz = mz + ps.dy * len;
      if (e.kind === 2) {
        const f = (now - e.startedAt) / FLY_IN_MS;
        if (f < 1) {
          const slot = fanSlot(e.fan);
          work.from.x = e.star.x + slot.dx * len; work.from.y = e.star.y + slot.dy * len;
          work.to.x = px; work.to.y = pz;
          const a = arcPoint(work.from, work.to, f, work.arc);
          const dx = px - work.from.x, dz = pz - work.from.y;
          const target = dx === 0 && dz === 0 ? e.baseYaw : Math.atan2(-dx, -dz);
          e.yaw += wrapPi(target - e.yaw) * k;
          writeMatrix(e, i, a.x, a.h + len * LIFT, a.y, e.yaw, len);
          touched = true;
          continue;
        }
      }
      e.yaw += wrapPi(e.baseYaw - e.yaw) * k;
      writeMatrix(e, i, px, mh + len * LIFT, pz, e.yaw, len);
      touched = true;
    }
    if (touched) for (const s of built.sets) s.paint.instanceMatrix.needsUpdate = true;
  });

  // Taps on a ship: a short press with little movement, one pointer. The tap fires after a short
  // delay and is dropped when it turns out to be the first half of a double-tap (star focus).
  useEffect(() => {
    const el = gl.domElement;
    const gate = createShipTapGate();
    const active = new Set<number>();
    let down: { x: number; y: number; t: number; multi: boolean; second: boolean } | null = null;
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
      const w = rect.width, h = rect.height;
      const i = pickNearest(entries.length, (k) => {
        if (entries[k]!.lod === 0) return null;
        work.proj.set(work.wx[k]!, work.wy[k]!, work.wz[k]!).project(camera);
        if (work.proj.z > 1) return null;
        return { x: (work.proj.x * 0.5 + 0.5) * w, y: (-work.proj.y * 0.5 + 0.5) * h, depth: work.proj.z };
      }, px, py, TAP_RADIUS_PX);
      if (i < 0) return;
      const id = entries[i]!.dockId;
      gate.tap(ev.clientX, ev.clientY, () => propsRef.current.onShipTap?.(id));
    };
    const hitRef = propsRef.current.shipHit;
    if (hitRef) {
      hitRef.current = (px, py) => pickNearest(entries.length, (k) => {
        if (entries[k]!.lod === 0) return null;
        work.proj.set(work.wx[k]!, work.wy[k]!, work.wz[k]!).project(camera);
        if (work.proj.z > 1) return null;
        return { x: (work.proj.x * 0.5 + 0.5) * el.clientWidth, y: (-work.proj.y * 0.5 + 0.5) * el.clientHeight, depth: work.proj.z };
      }, px, py, TAP_RADIUS_PX) >= 0;
    }
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      if (hitRef) hitRef.current = null;
      gate.dispose();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, [gl, camera, entries, work]);

  return <primitive object={built.group} />;
}
