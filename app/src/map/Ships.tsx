import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { seededRng } from '@core/rng.ts';
import type { PublicDock } from '@core/types.ts';
import type { ShownEncounter } from '../state/useExplore.ts';
import {
  ambientOffset, arcPoint, fanSlot, MAX_FAN, parkingSlot, selectShipLod,
} from './motion.ts';
import { buildShuttle, buildSimpleShuttle, createOutlineMaterial, shipWorldLength } from './shuttle.ts';
import { MAP_FOV, pickNearest } from './controls.ts';

/** Where your own ship is this frame (ground x/y, height h, ship length), written by MyShip. */
export type MyPose = { x: number; y: number; h: number; len: number };

export const FLY_IN_MS = 1200;
const RESELECT_MS = 250;
const TAP_RADIUS_PX = 24;
const SAMPLE_OPACITY = 0.5;
const LOW_MAX_FULL = 40;
const MAX_FULL = 150;
const GLASS = '#1d3048';
const GLOW = '#fff0c2';
const LIFT = 0.25; // ship centre above the plane, in lengths
const DRIFT_SPEED = 3.5; // units/s above which a ship turns to face where it is going

type Kind = 0 | 1 | 2; // fan | parked | arriving
type Entry = {
  dockId: string;
  colour: string;
  sample: boolean;
  kind: Kind;
  star: { x: number; y: number };
  fan: number; // slot index at the star
  park: number; // parking slot beside you
  startedAt: number;
  baseYaw: number;
  yaw: number;
  lod: 0 | 1 | 2; // culled | full | simple
  set: number; // index into the instanced sets
  inst: number; // instance index inside the set
};

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
};

function makeEntry(dockId: string, colour: string, sample: boolean, kind: Kind, star: { x: number; y: number }): Entry {
  const yaw = seededRng(`heading:${dockId}`)() * Math.PI * 2;
  return { dockId, colour, sample, kind, star, fan: 0, park: 0, startedAt: 0, baseYaw: yaw, yaw, lod: 0, set: 0, inst: 0 };
}

/** Every ship the layer may draw: top docks per star (newest first), parked and arriving encounters. */
export function buildEntries(
  docks: PublicDock[], myDockId: string | null, currentSongId: string, parked: ShownEncounter[],
  arriving: { dockId: string; startedAt: number } | null,
  posOf: (songId: string) => { x: number; y: number } | null,
): Entry[] {
  const away = new Set<string>(parked.map((p) => p.dock.id));
  if (arriving) away.add(arriving.dockId);
  const bySong = new Map<string, PublicDock[]>();
  for (const d of docks) {
    if (d.id === myDockId) continue;
    let a = bySong.get(d.songId);
    if (!a) bySong.set(d.songId, (a = []));
    a.push(d);
  }
  const out: Entry[] = [];
  let arrivingEntry: Entry | null = null;
  for (const [songId, group] of bySong) {
    const star = posOf(songId);
    if (!star) continue;
    group.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));
    const shift = songId === currentSongId ? 1 : 0; // your own ship takes the first slot at your star
    group.forEach((d, rank) => {
      const fan = rank + shift;
      if (arriving && d.id === arriving.dockId) {
        arrivingEntry = makeEntry(d.id, d.shipColour, d.isSample, 2, star);
        arrivingEntry.fan = fan;
        arrivingEntry.startedAt = arriving.startedAt;
        return;
      }
      if (away.has(d.id) || fan >= MAX_FAN) return;
      const e = makeEntry(d.id, d.shipColour, d.isSample, 0, star);
      e.fan = fan;
      out.push(e);
    });
  }
  const home = posOf(currentSongId) ?? { x: 0, y: 0 };
  parked.forEach((p, k) => {
    if (arriving && p.dock.id === arriving.dockId) return; // flying in; it parks when it lands
    const e = makeEntry(p.dock.id, p.dock.shipColour, p.dock.isSample, 1, home);
    e.park = k;
    out.push(e);
  });
  const ae = arrivingEntry as Entry | null;
  if (ae) {
    ae.park = Math.max(0, parked.findIndex((p) => p.dock.id === ae.dockId));
    if (!parked.some((p) => p.dock.id === ae.dockId)) ae.park = parked.length;
    out.push(ae);
  }
  return out;
}

type Part = THREE.InstancedMesh;
type ShipSet = { meshes: Part[]; paint: Part; count: number; full: boolean };

/** 4 sets: [full real, full sample, simple real, simple sample]. Matrix attribute shared by a set's parts. */
function buildSets(capacity: number) {
  const full = buildShuttle();
  const simple = buildSimpleShuttle();
  const disposables: { dispose(): void }[] = [full.paint, full.glass, full.glow, full.outline, simple.paint, simple.outline];
  const group = new THREE.Group();
  const sets: ShipSet[] = [];
  const outlines = [createOutlineMaterial(), createOutlineMaterial()];
  outlines[1]!.uniforms.uOpacity!.value = SAMPLE_OPACITY;
  outlines[1]!.transparent = true;
  const prepassMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
  disposables.push(...outlines, prepassMat);
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, matrix: THREE.InstancedBufferAttribute | null) => {
    const m = new THREE.InstancedMesh(geo, mat, capacity);
    if (matrix) m.instanceMatrix = matrix;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    group.add(m);
    return m;
  };
  for (const lod of ['full', 'simple'] as const) {
    for (const sample of [false, true]) {
      const o = sample ? SAMPLE_OPACITY : 1;
      const tr = sample;
      const paintMat = new THREE.MeshStandardMaterial({
        color: '#ffffff', roughness: 0.5, metalness: 0.2, flatShading: true, transparent: tr, opacity: o, depthWrite: !tr,
      });
      disposables.push(paintMat);
      const geo = lod === 'full' ? full : simple;
      const paint = mk(geo.paint, paintMat, null);
      paint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      paint.instanceColor.setUsage(THREE.DynamicDrawUsage);
      const meshes = [paint];
      const shared = paint.instanceMatrix;
      if (tr) {
        // Translucent ships: a colourless depth pre-pass so only the nearest hull surface blends (no see-through insides).
        const pre = mk(geo.paint, prepassMat, shared);
        pre.renderOrder = -1;
        meshes.push(pre);
        paintMat.depthWrite = true;
      }
      const outline = mk(geo.outline, outlines[sample ? 1 : 0]!, shared);
      outline.renderOrder = 1;
      meshes.push(outline);
      if (lod === 'full') {
        const glassMat = new THREE.MeshStandardMaterial({
          color: GLASS, emissive: '#4a8cc4', emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.2,
          transparent: tr, opacity: o, depthWrite: !tr,
        });
        const glowMat = new THREE.MeshBasicMaterial({ color: GLOW, side: THREE.DoubleSide, transparent: tr, opacity: o });
        disposables.push(glassMat, glowMat);
        meshes.push(mk(full.glass, glassMat, shared), mk(full.glow, glowMat, shared));
      }
      sets.push({ meshes, paint, count: 0, full: lod === 'full' });
    }
  }
  return { group, sets, dispose: () => { disposables.forEach((d) => d.dispose()); group.clear(); } };
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function Ships(props: ShipsProps) {
  const { docks, myDockId, currentSongId, parked, arriving, posOf, quality, reducedMotion } = props;
  const { gl, camera } = useThree();

  const entries = useMemo(
    () => buildEntries(docks, myDockId, currentSongId, parked, arriving, posOf),
    [docks, myDockId, currentSongId, parked, arriving, posOf],
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

  // Taps on a ship: a short press with little movement, one pointer.
  useEffect(() => {
    const el = gl.domElement;
    const active = new Set<number>();
    let down: { x: number; y: number; t: number; multi: boolean } | null = null;
    const onDown = (ev: PointerEvent) => {
      active.add(ev.pointerId);
      down = { x: ev.clientX, y: ev.clientY, t: performance.now(), multi: active.size > 1 };
    };
    const onCancel = (ev: PointerEvent) => { active.delete(ev.pointerId); down = null; };
    const onUp = (ev: PointerEvent) => {
      active.delete(ev.pointerId);
      const d = down;
      down = null;
      if (!d || d.multi || active.size > 0) return;
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
      if (i >= 0) propsRef.current.onShipTap?.(entries[i]!.dockId);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, [gl, camera, entries, work]);

  return <primitive object={built.group} />;
}
