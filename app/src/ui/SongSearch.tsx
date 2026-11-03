import { useEffect, useState, type ReactNode } from 'react';
import type { Backend, Song } from '../backend/types.ts';
import { errorCopy } from './errors.ts';

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 20;

type Props = {
  backend: Backend;
  onChoose: (songId: string) => void;
  /** Called with the message when a search fails, and with null when one succeeds. */
  onError: (message: string | null) => void;
  disabled?: boolean;
  /** Rendered between the search box and the results (DockSearch's "make home" tick). */
  extra?: ReactNode;
  /** Rendered just above the results. */
  error?: string | null;
};

/** The debounced song search box and result list shared by Dock, Send a song and Reply. */
export function SongSearch({ backend, onChoose, onError, disabled, extra, error }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setSearched(false); return; }
    let stale = false;
    const t = setTimeout(() => {
      backend.searchSongs(term)
        .then((r) => { if (!stale) { setResults(r.slice(0, MAX_RESULTS)); setSearched(true); onError(null); } })
        .catch((e) => { if (!stale) { setResults([]); onError(errorCopy(e)); } });
    }, DEBOUNCE_MS);
    return () => { stale = true; clearTimeout(t); };
  }, [backend, q, onError]);

  return (
    <div className="search">
      <input
        type="search" placeholder="Search songs or artists" aria-label="Search songs or artists"
        value={q} onChange={(e) => setQ(e.target.value)} autoFocus
      />
      {extra}
      {error && <p className="error-text" role="alert">{error}</p>}
      <ul className="results">
        {results.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => onChoose(s.id)} disabled={disabled}>
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
