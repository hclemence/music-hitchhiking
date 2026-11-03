import { useId } from 'react';
import type { ShownEncounter } from '../state/useExplore.ts';
import { ShipBadge } from './ShipBadge.tsx';

export const ENCOUNTER_TITLE = "You've encountered someone";
export const NOBODY_LEFT = 'Nobody else nearby — try Home or hitchhike from here';

type Props = {
  encounter: ShownEncounter | null;
  nobodyLeft: boolean;
  kept: boolean;
  /** A hop is under way: Hitchhike waits. */
  pending: boolean;
  onLike: () => void;
  onHitchhike: () => void;
  onClose: () => void;
  /**
   * Draw the ship's thumbnail (an offscreen WebGL render that can stall a frame) rather than its
   * colour dot. Explore holds it back while the ship is still flying in, so the arc stays smooth.
   */
  thumbnail?: boolean;
};

/** The bottom pop-up for the ship that just flew over to you (or that nobody is left). */
export function EncounterPopup({ encounter, nobodyLeft, kept, pending, onLike, onHitchhike, onClose, thumbnail = true }: Props) {
  const titleId = useId();
  if (!encounter) {
    if (!nobodyLeft) return null;
    return (
      <div className="popup" role="dialog" aria-labelledby={titleId}>
        <p id={titleId} className="popup-empty">{NOBODY_LEFT}</p>
        <div className="popup-actions single">
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }
  const { song, dock, othersCount } = encounter;
  return (
    <div className="popup" role="dialog" aria-labelledby={titleId} data-dock-id={dock.id}>
      <div className="popup-top">
        <h2 id={titleId} className="popup-title">{ENCOUNTER_TITLE}</h2>
        <button type="button" className="popup-close" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <div className="popup-song">
        {thumbnail
          ? <ShipBadge colour={dock.shipColour} size={56} />
          : <span className="ship-dot" style={{ background: dock.shipColour }} aria-hidden="true" />}
        <div className="card-titles">
          <h3>{song.title}</h3>
          <p className="artist">{song.artist}</p>
          {(dock.isSample || othersCount > 0) && (
            <p className="badges">
              {dock.isSample && <span className="badge">Sample</span>}
              {othersCount > 0 && <span className="others">+{othersCount} others here</span>}
            </p>
          )}
        </div>
      </div>
      <div className="links">
        <a href={song.spotifyUrl} target="_blank" rel="noopener noreferrer">Spotify</a>
        <a href={song.appleUrl} target="_blank" rel="noopener noreferrer">Apple Music</a>
        <a href={song.youtubeUrl} target="_blank" rel="noopener noreferrer">YouTube</a>
      </div>
      <div className="card-actions">
        <button type="button" className="secondary" onClick={onLike} disabled={kept}>
          {kept ? 'Kept' : 'Like'}
        </button>
        <button type="button" className="primary" onClick={onHitchhike} disabled={pending}>
          Hitchhike
        </button>
      </div>
    </div>
  );
}
