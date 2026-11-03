import { useEffect, useMemo, useRef, useState } from 'react';
import type { Backend, Song } from '../backend/types.ts';
import { EncounterCard } from './EncounterCard.tsx';
import { MapScene } from '../map/MapScene.tsx';
import { useExplore, type ExploreModel } from '../state/useExplore.ts';
import { EncounterPopup } from './EncounterPopup.tsx';
import { MiniMap } from './MiniMap.tsx';
import { OfflineBanner } from './OfflineBanner.tsx';
import { latestHopAtSong } from '../map/route.ts';

export type Screen = 'explore' | 'history' | 'inbox' | 'ship' | 'dock';

type Props = { backend: Backend; tz: string; onNavigate: (screen: Screen) => void; reloadToken?: number;
  /** A fly-to request from a sheet (Find, inbox Visit): each new `n` makes one jump hop. */
  jumpRequest?: { songId: string; n: number } | null;
};

const SEARCH_DEBOUNCE_MS = 250;

export function Explore({ backend, tz, onNavigate, reloadToken, jumpRequest }: Props) {
  const x = useExplore(backend, tz, { reloadToken });
  const jumped = useRef(jumpRequest?.n ?? 0);
  const jumpTo = x.actions.jumpTo;
  useEffect(() => {
    if (!jumpRequest || jumpRequest.n === jumped.current || x.status !== 'ready') return;
    jumped.current = jumpRequest.n;
    jumpTo(jumpRequest.songId);
  }, [jumpRequest, x.status, jumpTo]);
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
  const [hereDockId, setHereDockId] = useState<string | null>(null);
  const busy = x.pending || x.flight !== null;
  const homeId = x.profile?.homeSongId ?? null;
  const map = x.map!;
  const current = x.current;
  // The current song may not be one of the map's stars (Review Focus 3): add it so the camera and ship go there.
  const stars = useMemo(
    () => (current && !map.stars.some((s) => s.id === current.id) ? [...map.stars, current] : map.stars),
    [map.stars, current],
  );
  // A ship docked where you are (Ruling 11): its card has Like and links but no Hitchhike.
  const currentId = current?.id ?? null;
  useEffect(() => { setHereDockId(null); }, [currentId]);
  const hereDock = hereDockId ? x.hereDocks.find((d) => d.id === hereDockId) ?? null : null;
  const hereCard = hereDock && current
    ? { songId: current.id, song: current, dock: hereDock, othersCount: 0, distance: 0 }
    : null;
  const enc = x.encounter;
  // The ship flying over to you: Ships times its arc from `startedAt` on the performance clock.
  const arrivingId = enc.phase === 'arriving' ? enc.current?.dock.id ?? null : null;
  const arriving = useMemo(
    () => (arrivingId ? { dockId: arrivingId, startedAt: performance.now() } : null),
    [arrivingId],
  );
  const shownPopup = enc.popup;
  // A reveal opens its pop-up in front of any Docked-here card.
  useEffect(() => { if (arrivingId) setHereDockId(null); }, [arrivingId]);

  return (
    <>
      {current && (
        <MapScene
          stars={stars}
          regions={map.regions}
          docks={map.docks}
          colourSeed={x.profile!.colourSeed}
          currentSongId={current.id}
          hereDocks={x.hereDocks}
          myDockId={x.myDock?.id ?? null}
          myShipColour={x.profile!.shipColour}
          routeHops={x.hops}
          extraSongs={x.extraSongs}
          parked={enc.parked}
          arriving={arriving}
          flight={x.flight}
          onVisitedTap={(songId) => {
            if (songId === current.id) return; // already here: never move to a later hop at this song
            const hopId = latestHopAtSong(x.hops, songId);
            if (hopId && !busy && hopId !== x.currentHopId) x.actions.moveTo(hopId);
          }}
          onFlightEnd={x.actions.endFlight}
          onShipTap={(dockId) => {
            // A ship parked beside you reopens its pop-up; one docked at your star shows its card.
            if (enc.parked.some((e) => e.dock.id === dockId)) {
              setHereDockId(null);
              x.actions.openEncounter(dockId);
            } else if (x.hereDocks.some((d) => d.id === dockId)) {
              x.actions.closeEncounter();
              setHereDockId(dockId);
            }
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
      <section className="sheet" aria-label="Encounters" aria-live="polite">
        {hereCard ? (
          <div className="here-card" aria-label="Docked here">
            <EncounterCard
              encounter={hereCard}
              selected
              kept={x.liked.has(hereCard.dock.id)}
              disabled={busy}
              note="Docked here"
              onLike={() => x.actions.like(hereCard)}
              onClose={() => setHereDockId(null)}
            />
          </div>
        ) : (shownPopup || enc.nobodyLeft) && (
          <EncounterPopup
            key={shownPopup?.dock.id ?? 'none'}
            encounter={shownPopup}
            nobodyLeft={enc.nobodyLeft}
            kept={shownPopup ? x.liked.has(shownPopup.dock.id) : false}
            pending={busy}
            onLike={() => { if (shownPopup) x.actions.like(shownPopup); }}
            onHitchhike={() => { if (shownPopup) x.actions.hitchhike(shownPopup); }}
            onClose={x.actions.closeEncounter}
            thumbnail={arrivingId === null || arrivingId !== shownPopup?.dock.id}
          />
        )}
        <nav className="toolbar" aria-label="Actions">
          <button type="button" onClick={x.actions.home} disabled={busy || !homeId || current?.id === homeId}>Home</button>
          <button type="button" onClick={x.actions.wait} disabled={x.flight !== null || enc.phase === 'arriving'}>
            Wait
          </button>
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
