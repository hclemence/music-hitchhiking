import { lazy, Suspense } from 'react';
import { NoWebGL, supportsWebGL2 } from './ui/NoWebGL.tsx';

const SceneHarness = import.meta.env.DEV
  ? lazy(() => import('./dev/SceneHarness.tsx').then((m) => ({ default: m.SceneHarness })))
  : null;

export function App() {
  if (!supportsWebGL2()) return <NoWebGL />;
  if (import.meta.env.DEV && SceneHarness && new URLSearchParams(location.search).has('scene')) {
    return <Suspense fallback={null}><SceneHarness /></Suspense>;
  }
  return <main>Music Hitchhiking</main>;
}
