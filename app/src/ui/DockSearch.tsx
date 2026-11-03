import { useEffect, useState } from 'react';
import type { Backend } from '../backend/types.ts';
import { errorCopy } from './errors.ts';
import { SongSearch } from './SongSearch.tsx';

export function DockSearch({ backend, onDone }: { backend: Backend; onDone: () => void }) {
  const [makeHome, setMakeHome] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    backend.getProfile()
      .then((p) => { if (alive) setMakeHome((m) => m ?? p.homeSongId === null); })
      .catch(() => { if (alive) setMakeHome((m) => m ?? false); });
    return () => { alive = false; };
  }, [backend]);

  const choose = async (songId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await backend.setDock(songId);
      if (makeHome) await backend.setHome(songId);
      onDone();
    } catch (e) {
      setError(errorCopy(e));
      setBusy(false);
    }
  };

  return (
    <SongSearch
      backend={backend}
      onChoose={(id) => void choose(id)}
      onError={setError}
      error={error}
      disabled={busy || makeHome === null}
      extra={makeHome !== null && (
        <label className="check">
          <input type="checkbox" checked={makeHome} onChange={(e) => setMakeHome(e.target.checked)} />
          Also make this home
        </label>
      )}
    />
  );
}
