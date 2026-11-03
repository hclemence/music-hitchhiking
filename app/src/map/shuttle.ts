import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The shuttle: a boxy, tubby ship built from a lofted fuselage, cockpit, tail fin, swept wings with
 * dihedral, pylons, rounded-cylinder turbines and flat glow discs. Forward is -Z, up is +Y, and the
 * total length along Z is normalised to 1.
 */

export interface ShuttleGeometry {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  outline: THREE.BufferGeometry;
}

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

interface Ring { z: number; sx: number; sy: number; dy: number }

/** Loft rings of the body's rounded-rect outline into a tapering, capped nose. */
function loft(rings: Ring[]): THREE.BufferGeometry {
  const outline = roundedRect(0.84, 0.72, 0.22).getPoints(6);
  if (outline[0]!.distanceTo(outline[outline.length - 1]!) < 1e-6) outline.pop();
  const n = outline.length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of rings) for (const q of outline) pos.push(q.x * r.sx, q.y * r.sy + r.dy, r.z);
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const a = k * n + i, b = k * n + ((i + 1) % n), c = (k + 1) * n + i, d = (k + 1) * n + ((i + 1) % n);
      idx.push(a, c, b, b, c, d);
    }
  }
  const first = rings[0]!;
  const back = pos.length / 3;
  pos.push(0, first.dy, first.z + 0.03);
  for (let e = 0; e < n; e++) idx.push(back, e, (e + 1) % n);
  const last = rings[rings.length - 1]!;
  const centre = pos.length / 3;
  pos.push(0, last.dy, last.z - 0.05);
  for (let j = 0; j < n; j++) {
    const p0 = (rings.length - 1) * n + j, p1 = (rings.length - 1) * n + ((j + 1) % n);
    idx.push(centre, p1, p0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Centre the geometry on its own bounding box, rotate about that centre, then move it to `pos`. */
function place(geo: THREE.BufferGeometry, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) {
  geo.computeBoundingBox();
  const c = geo.boundingBox!.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
  geo.translate(pos[0], pos[1], pos[2]);
  return geo;
}

/** Positions + normals only, non-indexed, so differently-built parts can be merged. */
function plain(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  out.setAttribute('normal', g.getAttribute('normal'));
  return out;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map(plain), false)!;
}

/** Weld the silhouette so every vertex has one smooth normal (no cracks when the shell is inflated). */
function weld(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos = new THREE.BufferGeometry();
  pos.setAttribute('position', merge(parts).getAttribute('position'));
  const welded = mergeVertices(pos, 1e-3);
  welded.computeVertexNormals();
  return welded;
}

/** Uniformly scale every geometry so the paint's Z extent is 1, centred on Z=0. */
function normalise(all: THREE.BufferGeometry[], reference: THREE.BufferGeometry) {
  reference.computeBoundingBox();
  const b = reference.boundingBox!;
  const s = 1 / (b.max.z - b.min.z);
  const zc = (b.max.z + b.min.z) / 2;
  for (const g of all) {
    g.translate(0, 0, -zc);
    g.scale(s, s, s);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
}

function makeShuttle(): ShuttleGeometry {
  const paint: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];

  // One continuous fuselage, lofted from the tubby rounded box into a tapering nose.
  paint.push(loft([
    { z: 0.72, sx: 0.9, sy: 0.88, dy: 0 },
    { z: 0.64, sx: 1.0, sy: 1.0, dy: 0 },
    { z: -0.6, sx: 1.0, sy: 1.0, dy: 0 },
    { z: -0.84, sx: 0.92, sy: 0.9, dy: -0.02 },
    { z: -1.0, sx: 0.72, sy: 0.68, dy: -0.04 },
    { z: -1.09, sx: 0.48, sy: 0.44, dy: -0.05 },
  ]));
  // Cockpit window on the sloping upper nose.
  glass.push(place(new THREE.BoxGeometry(0.48, 0.06, 0.26), [0, 0.27, -0.9], [-0.62, 0, 0]));
  // Rear block and its flat glow plane.
  paint.push(place(new THREE.BoxGeometry(0.6, 0.5, 0.16), [0, 0, 0.78]));
  glow.push(place(new THREE.PlaneGeometry(0.4, 0.28), [0, 0, 0.865]));
  // Chunky tail fin.
  const fs = new THREE.Shape();
  fs.moveTo(0, 0); fs.lineTo(0.5, 0); fs.lineTo(0.62, 0.4); fs.lineTo(0.32, 0.4); fs.closePath();
  paint.push(place(
    new THREE.ExtrudeGeometry(fs, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 }),
    [0, 0.55, 0.42], [0, -Math.PI / 2, 0],
  ));

  for (const s of [-1, 1]) {
    // Thick swept wing, built mirrored for the left side (no negative scaling).
    const ws = new THREE.Shape();
    ws.moveTo(0, -0.28); ws.lineTo(s * 0.88, 0.18); ws.lineTo(s * 0.88, 0.46); ws.lineTo(0, 0.42); ws.closePath();
    const wing = new THREE.ExtrudeGeometry(ws, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    wing.rotateX(Math.PI / 2);
    paint.push(place(wing, [s * 0.85, -0.16, 0.08], [0, 0, s * 0.07]));

    // Turbine: a cylinder with rounded ends and a flat glow disc at the back.
    const prof: [number, number][] = [[0, -0.29], [0.1, -0.29], [0.145, -0.275], [0.165, -0.25], [0.172, -0.21],
      [0.172, 0.21], [0.165, 0.25], [0.145, 0.275], [0.1, 0.29], [0, 0.29]];
    const turbine = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 16);
    turbine.rotateX(Math.PI / 2);
    turbine.translate(s * 0.95, -0.44, 0.12);
    paint.push(turbine);
    const disc = new THREE.CircleGeometry(0.09, 14);
    disc.translate(s * 0.95, -0.44, 0.12 + 0.292);
    glow.push(disc);
    // Short pylon under the wing.
    paint.push(place(new THREE.BoxGeometry(0.08, 0.16, 0.26), [s * 0.95, -0.28, 0.1]));
  }

  const p = merge(paint), gl = merge(glass), gw = merge(glow);
  const outline = weld([...paint, ...glass]);
  normalise([p, gl, gw, outline], p);
  return { paint: p, glass: gl, glow: gw, outline };
}

export function buildShuttle(): ShuttleGeometry {
  return makeShuttle();
}

/** Cheap model for distant ships: a box body and two wings. */
export function buildSimpleShuttle(): { paint: THREE.BufferGeometry; outline: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [place(new THREE.BoxGeometry(0.8, 0.7, 2.0), [0, 0, 0])];
  for (const s of [-1, 1]) {
    parts.push(place(new THREE.BoxGeometry(0.9, 0.12, 0.8), [s * 0.8, -0.15, 0.3]));
  }
  const paint = merge(parts);
  const outline = weld(parts);
  normalise([paint, outline], paint);
  return { paint, outline };
}

const VERT = /* glsl */ `
uniform vec2 uResolution;
uniform float uWidthPx;
uniform float uPixelRatio;
void main() {
  mat4 mvm = modelViewMatrix;
#ifdef USE_INSTANCING
  mvm = modelViewMatrix * instanceMatrix;
#endif
  vec4 mv = mvm * vec4(position, 1.0);
  // Push the shell back by a few percent of the ship's length so the paint always wins the depth
  // test (thin wings and fins would otherwise speckle through).
  mv.z -= 0.05 * length(mvm[0].xyz);
  vec4 clip = projectionMatrix * mv;
  vec3 n = normalize(mat3(mvm) * normal);
  vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy * uResolution;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(0.0);
  clip.xy += dir / uResolution * 2.0 * uWidthPx * uPixelRatio * clip.w;
  gl_Position = clip;
}`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor, uOpacity); }`;

/** White back-face shell inflated along the screen-projected normal: constant width in pixels. */
export function createOutlineMaterial(widthPx = 2): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uWidthPx: { value: widthPx },
      uPixelRatio: { value: 1 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uColor: { value: new THREE.Color(0xffffff) },
      uOpacity: { value: 1 },
    },
  });
  m.onBeforeRender = onBeforeRender as unknown as THREE.Material['onBeforeRender'];
  return m;
}

/** Point an outline material at the drawing buffer it is about to render into. */
export function syncOutlineUniforms(m: THREE.ShaderMaterial, bufferW: number, bufferH: number, pixelRatio: number) {
  (m.uniforms.uResolution!.value as THREE.Vector2).set(bufferW, bufferH);
  m.uniforms.uPixelRatio!.value = pixelRatio;
}

/** The outline width in device pixels (uWidthPx is in CSS pixels). */
export function outlineWidthDevicePx(m: THREE.ShaderMaterial): number {
  return (m.uniforms.uWidthPx!.value as number) * (m.uniforms.uPixelRatio!.value as number);
}

const bufferSize = new THREE.Vector2();
/** Called by three right before each draw, so every canvas (and the thumbnail renderer) gets its own size. */
function onBeforeRender(this: THREE.ShaderMaterial, renderer: THREE.WebGLRenderer) {
  renderer.getDrawingBufferSize(bufferSize);
  syncOutlineUniforms(this, bufferSize.x, bufferSize.y, renderer.getPixelRatio());
}

/**
 * World length of a ship with a fixed size that projects to `targetPx` at `defaultDistance`
 * (the camera distance when omitted). At other distances it scales naturally, clamped to
 * [minPx, maxPx] on screen; `mine` makes your own ship 20% larger, after clamping.
 */
export function shipWorldLength(
  cameraDistance: number, fovDeg: number, viewportHeightPx: number,
  opts: { defaultDistance?: number; targetPx?: number; minPx?: number; maxPx?: number; mine?: boolean } = {},
): number {
  const { defaultDistance = cameraDistance, targetPx = 24, minPx = 14, maxPx = 48, mine = false } = opts;
  const worldPerPx = (2 * cameraDistance * Math.tan((fovDeg * Math.PI) / 360)) / viewportHeightPx;
  const px = Math.min(maxPx, Math.max(minPx, (targetPx * defaultDistance) / cameraDistance));
  return px * worldPerPx * (mine ? 1.2 : 1);
}
