import { ShipBadge } from './ShipBadge.tsx';
import { useEffect, useRef, useState } from 'react';
import type { Backend, InboxItem } from '../backend/types.ts';
import { errorCopy } from './errors.ts';
import { SendSong } from './SendSong.tsx';

type Props = { backend: Backend; onJump: (songId: string) => void };

/** Songs people sent you, and quiet notes that someone kept one of yours. */
export function Inbox({ backend, onJump }: Props) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [replyTo, setReplyTo] = useState<InboxItem | null>(null);
  const marked = useRef(false);

  useEffect(() => {
    let alive = true;
    backend.getInbox()
      .then((list) => {
        if (!alive) return;
        setItems(list);
        if (!marked.current) { marked.current = true; backend.markInboxSeen().catch(() => {}); }
      })
      .catch((e) => { if (alive) setError(errorCopy(e)); });
    return () => { alive = false; };
  }, [backend]);

  if (replyTo?.replyTraceId) {
    return (
      <SendSong
        backend={backend}
        traceId={replyTo.replyTraceId}
        heading="Reply with a song"
        onBack={() => setReplyTo(null)}
        onSent={() => { setReplyTo(null); setNotice({ text: 'Sent', kind: 'ok' }); }}
        onFaded={(text) => { setReplyTo(null); setNotice({ text, kind: 'error' }); }}
      />
    );
  }

  return (
    <div className="history">
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && (
        <p className={notice.kind === 'ok' ? 'ok-text' : 'error-text'} role={notice.kind === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
      {items === null && !error && <p className="hint">Loading…</p>}
      {items && items.length === 0 && <p className="hint">Nothing here yet</p>}
      <ul className="rows">
        {items?.map((i) => (
          <li key={i.id} className="row" data-unseen={i.seenAt === null ? 'true' : undefined}>
            {i.kind === 'kept' ? (
              <p className="kept">Someone kept your song: {i.title}</p>
            ) : (
              <>
                <div className="row-main">
                  {i.shipColour && <ShipBadge colour={i.shipColour} />}
                  <div className="row-titles">
                    <span className="r-title">{i.title}</span>
                    <span className="r-artist">{i.artist}</span>
                  </div>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => onJump(i.songId)}>Visit</button>
                  {i.replyTraceId && (
                    <button type="button" onClick={() => { setNotice(null); setReplyTo(i); }}>Reply</button>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
