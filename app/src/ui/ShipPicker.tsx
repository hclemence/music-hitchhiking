import { useEffect, useState } from 'react';
import type { Backend } from '../backend/types.ts';
import { SHIP_COLOURS } from '@core/palette.ts';
import { ShipPreview } from '../map/ShipPreview.tsx';
import { errorCopy } from './errors.ts';

export function ShipPicker({ backend, onDone }: { backend: Backend; onDone: () => void }) {
  const [colour, setColour] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    backend.getProfile()
      .then((p) => { if (alive) setColour((c) => c ?? p.shipColour); })
      .catch(() => { if (alive) setColour((c) => c ?? SHIP_COLOURS[0]!); });
    return () => { alive = false; };
  }, [backend]);

  const save = async () => {
    if (!colour || busy) return;
    setBusy(true);
    setError(null);
    try {
      await backend.setShipColour(colour);
      onDone();
    } catch (e) {
      setError(errorCopy(e));
      setBusy(false);
    }
  };

  const shown = colour ?? SHIP_COLOURS[0]!;
  return (
    <div className="picker">
      <ShipPreview colour={shown} />
      <div className="swatches" role="group" aria-label="Ship colour">
        {SHIP_COLOURS.map((c, i) => (
          <button
            key={c} type="button" className="swatch" style={{ background: c }}
            aria-label={`Colour ${i + 1} of ${SHIP_COLOURS.length}`} aria-pressed={c.toLowerCase() === shown.toLowerCase()}
            onClick={() => setColour(c)}
          />
        ))}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button type="button" className="primary big" onClick={() => void save()} disabled={!colour || busy}>Save</button>
    </div>
  );
}
