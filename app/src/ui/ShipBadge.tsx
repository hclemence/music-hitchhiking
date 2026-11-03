import { useEffect, useState } from 'react';
import { shipThumbnail } from '../map/shipThumbnail.ts';

const RETRY_MS = 2500;
const MAX_RETRIES = 6;

/** A small picture of someone's ship; the plain colour dot while loading, without WebGL or while its context is lost. */
export function ShipBadge({ colour, size = 40 }: { colour: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    setSrc(null);
    const attempt = () => {
      shipThumbnail(colour, size).then((u) => { if (alive) setSrc(u); }, (e: unknown) => {
        // A lost context may come back: keep the dot and try again a little later.
        if (alive && (e as { retryable?: boolean } | null)?.retryable && tries++ < MAX_RETRIES) timer = setTimeout(attempt, RETRY_MS);
      });
    };
    attempt();
    return () => { alive = false; clearTimeout(timer); };
  }, [colour, size]);
  if (!src) return <span className="ship-dot" style={{ background: colour }} aria-hidden="true" />;
  return <img className="ship-badge" src={src} alt="" width={size} height={size} />;
}
