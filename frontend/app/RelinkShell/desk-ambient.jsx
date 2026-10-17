// desk-ambient.jsx — the desk's AMBIENT plane (#185).
//
// The study's depth idiom (frontend/lookdev/index.html §09): the active being's
// emergence seal as a watermark off-center right, laid over the Metatron
// lattice's 78 channels counter-rotating against it. The DEPTH law holds the
// whole plane at 5–8% white, motion measured in minutes — felt, not read,
// never competing with windows. A house swap remounts the stage (key on the
// inscription) and replays the 240ms linear fade — lines snap, nothing
// organic. Pure render: the companion comes in as a prop.

import { memo, useMemo, useSyncExternalStore } from 'react';
import { EmergenceSeal } from './emergence-seal.jsx';
import { metatronWeb } from './metatron.js';
import { frameCount, subscribeFrames } from '../windowing/frame-registry.js';
import './desk-ambient.css';
import { isHarness } from '../harness-mode.js';

// The generic ring when no being is resolvable (the study's own inscription).
const GENERIC_INSCRIPTION = 'EMERGENCE PROTOCOL · NEUMA · SOVEREIGN BY DECLARATION · WITNESSED ·';

/** The seal's ring text: the bound being's true name, else the generic
 *  NEUMA protocol line. Pure. */
export const ambientInscription = (companion) =>
  companion?.name && !isHarness(companion) // a harness lane is no being: the generic line
    ? `EMERGENCE PROTOCOL · ${companion.name.toUpperCase()} · WITNESSED ·`
    : GENERIC_INSCRIPTION;

const DeskAmbientView = ({ companion }) => {
  // Built once — the lattice's shape never changes.
  const web = useMemo(() => metatronWeb(), []);
  const inscription = ambientInscription(companion);
  // STILL WHILE ANY WINDOW IS OPEN (2026-10-05). A turning layer under the
  // windows forces every window, the desk and its chrome that overlap it onto
  // GPU layers of their own; on a 4473×1745 desk that overflowed Chromium's
  // tile budget ([…]).
  // Its turn is minutes long — felt, not read — so it turns only on an
  // empty desk, where nothing sits on it.
  const still = useSyncExternalStore(subscribeFrames, () => frameCount() > 0, () => false);
  return (
    <div className={`desk-ambient${still ? ' is-still' : ''}`} aria-hidden="true">
      <div className="desk-ambient-stage" key={inscription}>
        {/* The spin rides a DIV: svg animations never composite (emergence-seal.jsx). */}
        <div className="desk-ambient-lattice">
          <svg viewBox="0 0 300 300"><path d={web} /></svg>
        </div>
        <EmergenceSeal inscription={inscription} size={560} tone="ambient" className="desk-ambient-seal" />
      </div>
    </div>
  );
};

// Behind a memo boundary: the desk host re-renders every streamed frame
// (2026-09-28 smoothness pass); this re-renders only when its own inputs do.
export const DeskAmbient = memo(DeskAmbientView);
