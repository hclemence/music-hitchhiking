import { useEffect, useRef } from 'react';
import type { ShownEncounter } from '../state/useExplore.ts';
import { EncounterCard } from './EncounterCard.tsx';

type Props = {
  encounters: ShownEncounter[];
  selectedSongId: string | null;
  kept: ReadonlySet<string>;
  disabled: boolean;
  onLike: (e: ShownEncounter) => void;
  onHitchhike: (e: ShownEncounter) => void;
};

/** The three encounter cards in a horizontally scrolling row (the page itself never scrolls sideways). */
export function EncounterBar({ encounters, selectedSongId, kept, disabled, onLike, onHitchhike }: Props) {
  const refs = useRef(new Map<string, HTMLElement>());
  const row = useRef<HTMLDivElement>(null);
  // New encounters start from the first card.
  useEffect(() => { row.current?.scrollTo?.({ left: 0 }); }, [encounters]);
  useEffect(() => {
    if (!selectedSongId) return;
    refs.current.get(selectedSongId)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedSongId]);

  if (encounters.length === 0) {
    return <p className="empty">Nobody nearby — try Home or wait</p>;
  }
  return (
    <div ref={row} className="encounters" aria-label="Nearby ships">
      {encounters.map((e) => (
        <EncounterCard
          key={e.dock.id}
          ref={(el) => { if (el) refs.current.set(e.songId, el); else refs.current.delete(e.songId); }}
          encounter={e}
          selected={e.songId === selectedSongId}
          kept={kept.has(e.dock.id)}
          disabled={disabled}
          onLike={() => onLike(e)}
          onHitchhike={() => onHitchhike(e)}
        />
      ))}
    </div>
  );
}
