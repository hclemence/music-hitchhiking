import { forwardRef } from 'react';
import type { ShownEncounter } from '../state/useExplore.ts';

type Props = {
  encounter: ShownEncounter;
  selected: boolean;
  kept: boolean;
  disabled: boolean;
  onLike: () => void;
  onHitchhike: () => void;
};

export const EncounterCard = forwardRef<HTMLElement, Props>(function EncounterCard(
  { encounter, selected, kept, disabled, onLike, onHitchhike }, ref,
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
      {(dock.isSample || othersCount > 0) && (
        <p className="badges">
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
        <button type="button" className="primary" onClick={onHitchhike} disabled={disabled}>
          Hitchhike
        </button>
      </div>
    </article>
  );
});
