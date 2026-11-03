import './app.css';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Backend, SampleMap } from './backend/types.ts';
import { Shell } from './ui/Shell.tsx';
import { StartFlow, RECOVERY_SAVED_KEY } from './ui/StartFlow.tsx';
import { ShipPicker } from './ui/ShipPicker.tsx';
import { DockSearch } from './ui/DockSearch.tsx';
import { NoWebGL, supportsWebGL2 } from './ui/NoWebGL.tsx';

const SceneHarness = import.meta.env.DEV
  ? lazy(() => import('./dev/SceneHarness.tsx').then((m) => ({ default: m.SceneHarness })))
  : null;

const SheetHarness = import.meta.env.DEV
  ? lazy(() => import('./dev/SheetHarness.tsx').then((m) => ({ default: m.SheetHarness })))
  : null;

let storageSingleton: Storage | null = null;
function localStore(): Storage {
  return (storageSingleton ??= makeStore());
}

function makeStore(): Storage {
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
  // Read directly (not via `env`) so the demo build's `define` makes this constant and drops supabase-js.
  if (import.meta.env.VITE_BACKEND === 'demo' || !import.meta.env.VITE_SUPABASE_URL) {
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

type Gate = 'unsavedCode' | 'loading' | 'error' | 'start' | 'onboardShip' | 'onboardDock' | 'ready';

export function App() {
  if (!supportsWebGL2()) return <NoWebGL />;
  if (import.meta.env.DEV && SceneHarness && new URLSearchParams(location.search).has('scene')) {
    return <Suspense fallback={null}><SceneHarness /></Suspense>;
  }
  const sheet = import.meta.env.DEV ? new URLSearchParams(location.search).get('sheet') : null;
  if (sheet && SheetHarness) return <Suspense fallback={null}><SheetHarness which={sheet} /></Suspense>;
  return <Main />;
}

function Main() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [gate, setGate] = useState<Gate>('loading');
  const [resumeCode, setResumeCode] = useState<string | undefined>();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // StrictMode runs effects twice: one boot at a time, so the backend is never swapped
  // under a mounted Explore.
  const booting = useRef(false);
  const boot = useCallback(async () => {
    if (booting.current) return;
    booting.current = true;
    setGate('loading');
    try {
      const b = await createBackend();
      setBackend(b);
      if (b.mode === 'live') {
        const session = await b.getSession();
        const st = localStore();
        const unsaved = st.getItem('mh.recoveryCode');
        if (session?.isMember && unsaved && !st.getItem(RECOVERY_SAVED_KEY)) {
          setResumeCode(unsaved);
          setGate('unsavedCode');
        } else setGate(session?.isMember ? 'ready' : 'start');
      } else {
        const p = await b.getProfile();
        setGate(p.homeSongId ? 'ready' : 'onboardShip');
      }
    } catch {
      setGate('error');
    } finally {
      booting.current = false;
    }
  }, []);
  useEffect(() => { void boot(); }, [boot]);

  const afterResume = async () => {
    try {
      const p = await backend!.getProfile();
      setGate(p.homeSongId ? 'ready' : 'onboardShip');
    } catch {
      setGate('onboardShip');
    }
  };

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
  if (gate === 'unsavedCode') {
    return <StartFlow backend={backend} storage={localStore()} resumeCode={resumeCode} onDone={() => void afterResume()} />;
  }
  if (gate === 'start') {
    return <StartFlow backend={backend} storage={localStore()} onDone={(kind) => setGate(kind === 'new' ? 'onboardShip' : 'ready')} />;
  }
  if (gate === 'onboardShip') {
    return (
      <main className="onboard">
        <h1>Choose your ship</h1>
        <ShipPicker backend={backend} onDone={() => setGate('onboardDock')} />
      </main>
    );
  }
  if (gate === 'onboardDock') {
    return (
      <main className="onboard">
        <h1>Choose your dock</h1>
        <p className="hint">Pick the song your ship docks at. Others will find you there.</p>
        <DockSearch backend={backend} onDone={() => setGate('ready')} />
      </main>
    );
  }
  // 'ready' is final, so Explore is never unmounted once shown; other screens open over it.
  return <Shell backend={backend} tz={tz} />;
}
