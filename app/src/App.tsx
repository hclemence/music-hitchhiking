import './app.css';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Backend, SampleMap } from './backend/types.ts';
import { Explore, type Screen } from './ui/Explore.tsx';
import { NoWebGL, supportsWebGL2 } from './ui/NoWebGL.tsx';

const SceneHarness = import.meta.env.DEV
  ? lazy(() => import('./dev/SceneHarness.tsx').then((m) => ({ default: m.SceneHarness })))
  : null;

function localStore(): Storage {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch { /* blocked */ }
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

/** Demo backend over the sample map when asked for (or when no Supabase is configured), else live. */
async function createBackend(): Promise<Backend> {
  const env = import.meta.env;
  const storage = localStore();
  if (env.VITE_BACKEND === 'demo' || !env.VITE_SUPABASE_URL) {
    const [{ createDemoBackend }, map] = await Promise.all([
      import('./backend/demo.ts'),
      import('../../data/sample-map.json'),
    ]);
    return createDemoBackend(map.default as SampleMap, storage);
  }
  const [{ createClient }, { createSupabaseBackend }] = await Promise.all([
    import('@supabase/supabase-js'),
    import('./backend/supabase.ts'),
  ]);
  return createSupabaseBackend(createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY), storage);
}

type Gate = 'loading' | 'error' | 'start' | 'demoHome' | 'ready';

export function App() {
  if (!supportsWebGL2()) return <NoWebGL />;
  if (import.meta.env.DEV && SceneHarness && new URLSearchParams(location.search).has('scene')) {
    return <Suspense fallback={null}><SceneHarness /></Suspense>;
  }
  return <Main />;
}

function Main() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [gate, setGate] = useState<Gate>('loading');
  const [screen, setScreen] = useState<Screen>('explore');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const boot = useCallback(async () => {
    setGate('loading');
    try {
      const b = await createBackend();
      setBackend(b);
      if (b.mode === 'live') {
        const session = await b.getSession();
        setGate(session?.isMember ? 'ready' : 'start');
      } else {
        const p = await b.getProfile();
        setGate(p.homeSongId ? 'ready' : 'demoHome');
      }
    } catch {
      setGate('error');
    }
  }, []);
  useEffect(() => { void boot(); }, [boot]);

  if (gate === 'loading' || !backend && gate !== 'error') {
    return <main className="center-screen"><p>Loading…</p></main>;
  }
  if (gate === 'error' || !backend) {
    return (
      <main className="center-screen">
        <p>Couldn't reach Music Hitchhiking.</p>
        <button type="button" className="primary" onClick={() => void boot()}>Try again</button>
      </main>
    );
  }
  // Placeholders below are replaced by the onboarding and settings screens (Task 8).
  if (gate === 'start') {
    return (
      <main className="center-screen">
        <h1>Music Hitchhiking</h1>
        <p>Start with an invite code.</p>
        <button type="button" className="primary" disabled>Start</button>
      </main>
    );
  }
  if (gate === 'demoHome') return <DemoHome backend={backend} onDone={() => setGate('ready')} />;
  if (screen !== 'explore') {
    return (
      <main className="center-screen">
        <p>The {screen} screen is coming soon.</p>
        <button type="button" className="primary" onClick={() => setScreen('explore')}>Back to the map</button>
      </main>
    );
  }
  return <Explore backend={backend} tz={tz} onNavigate={setScreen} />;
}

function DemoHome({ backend, onDone }: { backend: Backend; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const begin = async () => {
    setBusy(true);
    try {
      const { stars } = await backend.loadMap();
      const first = stars[0]!.id;
      await backend.setDock(first);
      await backend.setHome(first);
      onDone();
    } catch {
      setBusy(false);
    }
  };
  return (
    <main className="center-screen">
      <h1>Music Hitchhiking</h1>
      <p>Songs are stars. Dock your ship at one, then hitchhike with others.</p>
      <button type="button" className="primary big" onClick={() => void begin()} disabled={busy}>
        Dock and start exploring
      </button>
    </main>
  );
}
