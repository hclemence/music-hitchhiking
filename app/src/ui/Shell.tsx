import { useState } from 'react';
import type { Backend } from '../backend/types.ts';
import { Explore, type Screen } from './Explore.tsx';

const TITLES: Record<Exclude<Screen, 'explore'>, string> = {
  ship: 'Ship', dock: 'Dock', history: 'History', inbox: 'Inbox',
};

/**
 * The signed-in app: Explore stays mounted underneath (so a pending hop, its retries and the
 * action queue live on) and the other screens open as sheets over it.
 */
export function Shell({ backend, tz }: { backend: Backend; tz: string }) {
  const [screen, setScreen] = useState<Screen>('explore');
  return (
    <>
      <Explore backend={backend} tz={tz} onNavigate={setScreen} />
      {screen !== 'explore' && (
        <ScreenSheet title={TITLES[screen]} onClose={() => setScreen('explore')}>
          {/* Placeholder: Task 8 brings the real screens. */}
          <p className="hint">The {TITLES[screen].toLowerCase()} screen is coming soon.</p>
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
