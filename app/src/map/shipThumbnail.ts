import * as THREE from 'three';
import { buildShuttle, createOutlineMaterial } from './shuttle.ts';

/** Camera distance at which a sphere of `radius` fits the vertical FOV with a margin. */
export function fitDistance(radius: number, fovDeg: number, margin = 1.12): number {
  return (radius * margin) / Math.sin((fovDeg * Math.PI) / 360);
}

interface Rig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  paint: THREE.MeshStandardMaterial;
  outline: THREE.ShaderMaterial;
}

let rig: Rig | null = null;
let unavailable = false;
let contextLost = false;
const cache = new Map<string, string>();

/** A failure that may clear up (the WebGL context was lost); callers fall back to the dot and try again later. */
export class ThumbnailRetryError extends Error {
  readonly retryable = true;
  constructor() { super('WebGL context lost'); }
}

function getRig(): Rig {
  if (rig) return rig;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  // iOS drops contexts under memory pressure. Keep the page from treating it as fatal, and rebuild
  // the renderer once the browser restores it.
  const canvas = renderer.domElement;
  canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); contextLost = true; });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    const old = rig;
    rig = null;
    try { old?.renderer.dispose(); } catch { /* already gone */ }
  });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe6e9ff, 0x4a3a68, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2.5, 3.5, -1.5);
  scene.add(sun);
  const geo = buildShuttle();
  const paint = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2, flatShading: true });
  const outline = createOutlineMaterial(2);
  scene.add(new THREE.Mesh(geo.paint, paint));
  scene.add(new THREE.Mesh(geo.outline, outline));
  scene.add(new THREE.Mesh(geo.glass, new THREE.MeshStandardMaterial({
    color: 0x1d3048, emissive: 0x4a8cc4, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.2,
  })));
  scene.add(new THREE.Mesh(geo.glow, new THREE.MeshBasicMaterial({ color: 0xfff0c2, side: THREE.DoubleSide })));
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  // Front, right, above: a 3/4 view, framed on the whole shuttle's bounding sphere.
  geo.outline.computeBoundingSphere();
  const sphere = geo.outline.boundingSphere!;
  const dir = new THREE.Vector3(0.95, 0.75, -1.45).normalize();
  camera.position.copy(sphere.center).addScaledVector(dir, fitDistance(sphere.radius + 0.02, camera.fov));
  camera.lookAt(sphere.center);
  rig = { renderer, scene, camera, paint, outline };
  return rig;
}

const lost = (r: Rig) => contextLost || r.renderer.getContext().isContextLost();

function renderToUrl(colour: string, sizePx: number): string {
  const r = getRig();
  if (lost(r)) throw new ThumbnailRetryError();
  r.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  r.renderer.setSize(sizePx, sizePx, false);
  r.paint.color.set(colour);
  r.renderer.render(r.scene, r.camera);
  // A render on a lost context does nothing and reads back a blank image: never hand that out.
  if (lost(r)) throw new ThumbnailRetryError();
  return r.renderer.domElement.toDataURL('image/png');
}

/**
 * Render the shuttle once per colour to a data URL with one shared offscreen renderer. While the
 * context is lost it rejects with a `ThumbnailRetryError` and caches nothing.
 */
export function shipThumbnail(colour: string, sizePx = 40): Promise<string> {
  const key = `${colour}|${sizePx}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  if (unavailable) return Promise.reject(new Error('WebGL unavailable'));
  try {
    const url = renderToUrl(colour, sizePx);
    cache.set(key, url);
    return Promise.resolve(url);
  } catch (e) {
    if (e instanceof ThumbnailRetryError) return Promise.reject(e);
    unavailable = true;
    return Promise.reject(e instanceof Error ? e : new Error('WebGL unavailable'));
  }
}

/** Create the renderer and compile its shaders now (nothing cached), so the first pop-up does not stall. */
export function warmThumbnailRenderer(): void {
  if (unavailable || rig) return;
  try { renderToUrl('#8899aa', 8); } catch (e) { if (!(e instanceof ThumbnailRetryError)) unavailable = true; }
}

/** Run `warmThumbnailRenderer` when the browser is idle (a timer where requestIdleCallback is missing). Returns a cancel. */
export function scheduleThumbnailWarmup(): () => void {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(warmThumbnailRenderer, { timeout: 2000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = setTimeout(warmThumbnailRenderer, 300);
  return () => clearTimeout(t);
}

/** Test hook: forget the renderer and every cached image. */
export function resetThumbnails(): void {
  rig = null; unavailable = false; contextLost = false; cache.clear();
}
