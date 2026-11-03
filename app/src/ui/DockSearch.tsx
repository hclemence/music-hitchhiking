import { useEffect, useState } from 'react';
import type { Backend, Song } from '../backend/types.ts';
import { errorCopy } from './errors.ts';

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 20;

export function DockSearch({ backend, onDone }: { backend: Backend; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [searched, setSearched] = useState(false);
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

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setSearched(false); return; }
    let stale = false;
    const t = setTimeout(() => {
      backend.searchSongs(term)
        .then((r) => { if (!stale) { setResults(r.slice(0, MAX_RESULTS)); setSearched(true); setError(null); } })
        .catch((e) => { if (!stale) { setResults([]); setError(errorCopy(e)); } });
    }, DEBOUNCE_MS);
    return () => { stale = true; clearTimeout(t); };
  }, [backend, q]);

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
    <div className="search">
      <input
        type="search" placeholder="Search songs or artists" aria-label="Search songs or artists"
        value={q} onChange={(e) => setQ(e.target.value)} autoFocus
      />
      {makeHome !== null && (
        <label className="check">
          <input type="checkbox" checked={makeHome} onChange={(e) => setMakeHome(e.target.checked)} />
          Also make this home
        </label>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      <ul className="results">
        {results.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => void choose(s.id)} disabled={busy}>
              <span className="r-title">{s.title}</span>
              <span className="r-artist">{s.artist}</span>
            </button>
          </li>
        ))}
      </ul>
      {searched && results.length === 0 && <p className="hint">No songs found.</p>}
    </div>
  );
}
