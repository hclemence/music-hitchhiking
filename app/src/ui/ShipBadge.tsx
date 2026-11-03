import { useEffect, useState } from 'react';
import { shipThumbnail } from '../map/shipThumbnail.ts';

/** A small picture of someone's ship; the plain colour dot while loading or without WebGL. */
export function ShipBadge({ colour, size = 40 }: { colour: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    shipThumbnail(colour, size).then((u) => { if (alive) setSrc(u); }, () => { /* keep the dot */ });
    return () => { alive = false; };
  }, [colour, size]);
  if (!src) return <span className="ship-dot" style={{ background: colour }} aria-hidden="true" />;
  return <img className="ship-badge" src={src} alt="" width={size} height={size} />;
}
