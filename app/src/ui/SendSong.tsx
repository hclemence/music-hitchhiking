import { useState } from 'react';
import { BackendError, type Backend } from '../backend/types.ts';
import { errorCopy } from './errors.ts';
import { SongSearch } from './SongSearch.tsx';

type Props = {
  backend: Backend;
  traceId: string;
  heading: string;
  onSent: () => void;
  onFaded: (message: string) => void;
  onBack: () => void;
};

/** Pick a song and send it down a trace (a History trace, or an inbox row's reply trace). */
export function SendSong({ backend, traceId, heading, onSent, onFaded, onBack }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (songId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await backend.sendSuggestion(traceId, songId);
      onSent();
    } catch (e) {
      if (e instanceof BackendError && e.code === 'trace_faded') { onFaded(errorCopy(e)); return; }
      setError(errorCopy(e));
      setBusy(false);
    }
  };

  return (
    <div className="send-song">
      <div className="send-head">
        <h3>{heading}</h3>
        <button type="button" className="secondary" onClick={onBack}>Back</button>
      </div>
      <SongSearch backend={backend} onChoose={(id) => void send(id)} onError={setError} error={error} disabled={busy} />
    </div>
  );
}
