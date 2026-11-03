import { useState } from 'react';
import type { Backend } from '../backend/types.ts';
import { Explore, type Screen } from './Explore.tsx';
import { ShipPicker } from './ShipPicker.tsx';
import { DockSearch } from './DockSearch.tsx';
import { HistoryDrawer } from './HistoryDrawer.tsx';
import { Inbox } from './Inbox.tsx';

const TITLES: Record<Exclude<Screen, 'explore'>, string> = {
  ship: 'Ship', dock: 'Dock', history: 'History', inbox: 'Inbox',
};

/**
 * The signed-in app: Explore stays mounted underneath (so a pending hop, its retries and the
 * action queue live on) and the other screens open as sheets over it.
 */
export function Shell({ backend, tz }: { backend: Backend; tz: string }) {
  const [screen, setScreen] = useState<Screen>('explore');
  const [reloadToken, setReloadToken] = useState(0);
  const [jump, setJump] = useState<{ songId: string; n: number } | null>(null);
  const visit = (songId: string) => { setJump((j) => ({ songId, n: (j?.n ?? 0) + 1 })); setScreen('explore'); };
  // Closing the inbox reloads, so the dot reflects what was just marked seen.
  const close = () => { if (screen === 'inbox') setReloadToken((n) => n + 1); setScreen('explore'); };
  const done = () => { setReloadToken((n) => n + 1); setScreen('explore'); };
  return (
    <>
      <Explore backend={backend} tz={tz} onNavigate={setScreen} reloadToken={reloadToken} jumpRequest={jump} />
      {screen !== 'explore' && (
        <ScreenSheet title={TITLES[screen]} onClose={close}>
          {screen === 'ship' && <ShipPicker backend={backend} onDone={done} />}
          {screen === 'dock' && <DockSearch backend={backend} onDone={done} />}
          {screen === 'history' && <HistoryDrawer backend={backend} onJump={visit} />}
          {screen === 'inbox' && <Inbox backend={backend} onJump={visit} />}
        </ScreenSheet>
      )}
    </>
  );
}

function ScreenSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-backdrop overlay" onClick={onClose}>
      <div
        className="route-sheet screen-sheet" role="dialog" aria-modal="true" aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="route-head">
          <h2>{title}</h2>
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
