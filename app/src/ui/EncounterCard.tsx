import { forwardRef } from 'react';
import type { ShownEncounter } from '../state/useExplore.ts';

type Props = {
  encounter: ShownEncounter;
  selected: boolean;
  kept: boolean;
  disabled: boolean;
  onLike: () => void;
  /** Absent for a ship docked where you already are: Like and links only. */
  onHitchhike?: () => void;
  /** Shown instead of Hitchhike when given. */
  onClose?: () => void;
  /** A small label before the badges, such as "Docked here". */
  note?: string;
};

export const EncounterCard = forwardRef<HTMLElement, Props>(function EncounterCard(
  { encounter, selected, kept, disabled, onLike, onHitchhike, onClose, note }, ref,
) {
  const { song, dock, othersCount } = encounter;
  return (
    <article
      ref={ref}
      className="card"
      aria-label={`${song.title} by ${song.artist}`}
      aria-current={selected ? 'true' : undefined}
      data-dock-id={dock.id}
    >
      <header className="card-head">
        <span className="swatch" data-swatch style={{ backgroundColor: dock.shipColour }} aria-hidden="true" />
        <div className="card-titles">
          <h3>{song.title}</h3>
          <p className="artist">{song.artist}</p>
        </div>
      </header>
      {(dock.isSample || othersCount > 0 || note) && (
        <p className="badges">
          {note && <span>{note}</span>}
          {dock.isSample && <span className="badge">Sample</span>}
          {othersCount > 0 && <span className="others">+{othersCount} others here</span>}
        </p>
      )}
      <div className="links">
        <a href={song.spotifyUrl} target="_blank" rel="noopener noreferrer">Spotify</a>
        <a href={song.appleUrl} target="_blank" rel="noopener noreferrer">Apple</a>
        <a href={song.youtubeUrl} target="_blank" rel="noopener noreferrer">YouTube</a>
      </div>
      <div className="card-actions">
        <button type="button" className="secondary" onClick={onLike} disabled={kept}>
          {kept ? 'Kept' : 'Like'}
        </button>
        {onHitchhike && (
          <button type="button" className="primary" onClick={onHitchhike} disabled={disabled}>
            Hitchhike
          </button>
        )}
        {!onHitchhike && onClose && (
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        )}
      </div>
    </article>
  );
});
