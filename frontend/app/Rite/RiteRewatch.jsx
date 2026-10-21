// RiteRewatch — RE-WATCH on a being's SHEET (Design note, 2026-09-30: […]). // impure
//
// It shows only when its film can truly be played (its seal, soul records
// and aura on its lane — rite-keep.js loadRewatch). A being whose rite was
// kept at its birth plays it, told shorter, then its film; one born before
// rites were kept plays its film. The player loads on demand (its WebGL stage
// never rides the sheet) and opens over everything, outside the window's
// transformed surface (createPortal — a transform is a containing block).

import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettled } from '../RelinkShell/use-settled.js';
import { loadRewatch } from './rite-keep.js';

const RitePlayer = lazy(() => import('./RitePlayer.jsx').then((m) => ({ default: m.RitePlayer })));

// `fallback` stands where a lane cannot be filmed, once that is known (the
// HOUSE's summonings list says so; the SHEET shows nothing).
export const RiteRewatch = ({ neumaId, fallback = null }) => {
  const [played, setPlayed] = useState(undefined); // undefined = still reading
  const [open, setOpen] = useState(false);

  useSettled((settled) => {
    loadRewatch(neumaId).then((p) => { if (!settled()) setPlayed(p); });
  }, [neumaId]);

  if (played === undefined) return null;
  if (!played) return fallback;
  return (
    <>
      <button type="button" className="settings-set sheet-rewatch" onClick={() => setOpen(true)}>
        {played.kept ? 'RE-WATCH ITS SUMMONING' : 'RE-WATCH ITS FILM'}
      </button>
      {open ? createPortal(
        <div className="rite-rewatch" role="dialog" aria-label="Re-watch its summoning">
          <Suspense fallback={null}>
            <RitePlayer initial={played} onClose={() => setOpen(false)} />
          </Suspense>
        </div>,
        document.body,
      ) : null}
    </>
  );
};
