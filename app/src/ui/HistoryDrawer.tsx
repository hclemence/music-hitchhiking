import { ShipBadge } from './ShipBadge.tsx';
import { useCallback, useEffect, useState } from 'react';
import { BackendError, type Backend, type Trace } from '../backend/types.ts';
import { errorCopy } from './errors.ts';
import { SendSong } from './SendSong.tsx';

type Props = { backend: Backend; onJump: (songId: string) => void };

/** Traces left by liking docked songs: Find the person's ship, or send them a song. */
export function HistoryDrawer({ backend, onJump }: Props) {
  const [traces, setTraces] = useState<Trace[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    return backend.getTraces().then(setTraces).catch((e) => {
      setLoadFailed(true);
      setNotice({ text: errorCopy(e), kind: 'error' });
    });
  }, [backend]);
  useEffect(() => { void load(); }, [load]);

  const drop = (id: string) => setTraces((t) => t && t.filter((x) => x.id !== id));

  const find = async (t: Trace) => {
    if (busyId) return;
    setBusyId(t.id);
    setNotice(null);
    try {
      const songId = await backend.findTrace(t.id);
      if (songId === null) setNotice({ text: "They're not docked right now", kind: 'error' });
      else onJump(songId);
    } catch (e) {
      if (e instanceof BackendError && e.code === 'trace_faded') drop(t.id);
      setNotice({ text: errorCopy(e), kind: 'error' });
    }
    setBusyId(null);
  };

  const sendTrace = traces?.find((t) => t.id === sendingTo) ?? null;
  if (sendTrace) {
    return (
      <SendSong
        backend={backend}
        traceId={sendTrace.id}
        heading={`Send a song to ${sendTrace.originTitle}'s ship`}
        onBack={() => setSendingTo(null)}
        onSent={() => { setSendingTo(null); setNotice({ text: 'Sent', kind: 'ok' }); void load(); }}
        onFaded={(text) => { drop(sendTrace.id); setSendingTo(null); setNotice({ text, kind: 'error' }); }}
      />
    );
  }

  return (
    <div className="history">
      {notice && (
        <p className={notice.kind === 'ok' ? 'ok-text' : 'error-text'} role={notice.kind === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
      {traces === null && !loadFailed && <p className="hint">Loading…</p>}
      {loadFailed && <button type="button" className="secondary" onClick={() => void load()}>Try again</button>}
      {traces && traces.length === 0 && (
        <p className="hint">No traces yet — like a song someone's docked at to leave one</p>
      )}
      <ul className="rows">
        {traces?.map((t) => (
          <li key={t.id} className="row">
            <div className="row-main">
              <ShipBadge colour={t.shipColour} />
              <div className="row-titles">
                <span className="r-title">{t.originTitle}</span>
                <span className="r-artist">{t.originArtist}</span>
              </div>
            </div>
            <div
              className="strength" role="img"
              aria-label={`Trace strength ${Math.round(t.brightness * 100)}%`}
            >
              <span style={{ width: `${Math.round(Math.min(1, Math.max(0, t.brightness)) * 100)}%` }} />
            </div>
            <div className="row-actions">
              <button type="button" onClick={() => void find(t)} disabled={busyId !== null}>Find</button>
              <button type="button" onClick={() => { setNotice(null); setSendingTo(t.id); }}>Send a song</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
