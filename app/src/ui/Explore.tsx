import { useEffect, useRef, useState } from 'react';
import type { Backend, Song } from '../backend/types.ts';
import { MapScene } from '../map/MapScene.tsx';
import { useExplore, type ExploreModel } from '../state/useExplore.ts';
import { EncounterBar } from './EncounterBar.tsx';
import { MiniMap } from './MiniMap.tsx';
import { OfflineBanner } from './OfflineBanner.tsx';

export type Screen = 'explore' | 'history' | 'inbox' | 'ship' | 'dock';

type Props = { backend: Backend; tz: string; onNavigate: (screen: Screen) => void };

const SEARCH_DEBOUNCE_MS = 250;

export function Explore({ backend, tz, onNavigate }: Props) {
  const x = useExplore(backend, tz);
  const navigated = useRef(false);
  useEffect(() => {
    if (x.status === 'noHome' && !navigated.current) {
      navigated.current = true;
      onNavigate('dock');
    }
  }, [x.status, onNavigate]);

  let body;
  switch (x.status) {
    case 'loading':
      body = <div className="center-screen"><p>Loading the map…</p></div>;
      break;
    case 'error':
      body = (
        <div className="center-screen">
          <p>Couldn't load the map.</p>
          <button type="button" className="primary" onClick={x.actions.retryLoad}>Try again</button>
        </div>
      );
      break;
    case 'noHome':
      body = (
        <div className="center-screen">
          <p>Pick a song to dock at first — it becomes your home.</p>
          <button type="button" className="primary" onClick={() => onNavigate('dock')}>Choose a dock</button>
        </div>
      );
      break;
    case 'noJourney':
      body = <StartChoice backend={backend} model={x} />;
      break;
    case 'ready':
      body = <Ready backend={backend} model={x} onNavigate={onNavigate} />;
      break;
  }
  return (
    <main className="explore">
      {body}
      {x.toast && <div className="toast" role="alert">{x.toast}</div>}
    </main>
  );
}

function Ready({ backend, model: x, onNavigate }: { backend: Backend; model: ExploreModel; onNavigate: Props['onNavigate'] }) {
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const busy = x.pending || x.flight !== null;
  const homeId = x.profile?.homeSongId ?? null;
  const map = x.map!;
  const current = x.current;
  const encounterSongIds = x.encounters.map((e) => e.songId);

  return (
    <>
      {current && (
        <MapScene
          stars={map.stars}
          regions={map.regions}
          docks={map.docks}
          colourSeed={x.profile!.colourSeed}
          currentSongId={current.id}
          encounterSongIds={encounterSongIds}
          myShipColour={x.profile!.shipColour}
          flight={x.flight}
          onFlightEnd={x.actions.endFlight}
          onShipTap={(dockId) => {
            const songId = map.docks.find((d) => d.id === dockId)?.songId ?? null;
            setSelectedSongId(songId);
          }}
        />
      )}
      <div className="top">
        {x.offline && <OfflineBanner />}
        <div className="top-row">
          <div className="now" aria-label="You are here">
            <span className="now-label">You are at</span>
            <span className="now-title">{current?.title ?? '…'}</span>
            <span className="now-artist">{current?.artist ?? ''}</span>
          </div>
          {x.currentHopId && (
            <MiniMap
              hops={x.hops} currentHopId={x.currentHopId} songs={x.songs}
              disabled={busy} onMoveTo={x.actions.moveTo}
            />
          )}
        </div>
      </div>
      <section className="sheet" aria-label="Encounters">
        <EncounterBar
          encounters={x.encounters}
          selectedSongId={selectedSongId}
          kept={x.liked}
          disabled={busy}
          onLike={x.actions.like}
          onHitchhike={x.actions.hitchhike}
        />
        <nav className="toolbar" aria-label="Actions">
          <button type="button" onClick={x.actions.home} disabled={busy || !homeId || current?.id === homeId}>Home</button>
          <button type="button" onClick={x.actions.wait} disabled={x.flight !== null}>Wait</button>
          {backend.mode !== 'demo' && (
            <>
              <button type="button" onClick={() => onNavigate('history')}>History</button>
              <button
                type="button" className="has-dot" data-dot={x.inboxUnread ? 'true' : undefined}
                aria-label={x.inboxUnread ? 'Inbox (new)' : 'Inbox'} onClick={() => onNavigate('inbox')}
              >
                Inbox
              </button>
            </>
          )}
          <button type="button" onClick={() => onNavigate('ship')}>Ship</button>
          <button type="button" onClick={() => onNavigate('dock')}>Dock</button>
        </nav>
      </section>
    </>
  );
}

function StartChoice({ backend, model: x }: { backend: Backend; model: ExploreModel }) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  useEffect(() => {
    if (!searching) return;
    let stale = false;
    const t = setTimeout(() => {
      if (!q.trim()) { setResults([]); return; }
      backend.searchSongs(q).then((r) => { if (!stale) setResults(r); }).catch(() => { if (!stale) setResults([]); });
    }, SEARCH_DEBOUNCE_MS);
    return () => { stale = true; clearTimeout(t); };
  }, [backend, q, searching]);

  return (
    <div className="start">
      <h1>Where do you want to start today?</h1>
      <button type="button" className="primary big" onClick={x.actions.startFromHome} disabled={x.starting}>
        Start from home
      </button>
      {!searching ? (
        <button type="button" className="secondary big" onClick={() => setSearching(true)} disabled={x.starting}>
          Start somewhere else
        </button>
      ) : (
        <div className="search">
          <input
            type="search" placeholder="Search songs or artists" aria-label="Search songs or artists"
            value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          />
          <ul className="results">
            {results.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => x.actions.startAt(s.id)} disabled={x.starting}>
                  <span className="r-title">{s.title}</span>
                  <span className="r-artist">{s.artist}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
