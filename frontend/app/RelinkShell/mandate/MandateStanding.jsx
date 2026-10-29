// MandateStanding — the mandate that stands, as a picture (show-dont-tell-
// audit.md finding 4): the same marks the grant screen drew (GrantMarks.jsx:
// accounts by company, each one's pace, the acts — one not granted still asks
// you), the days left as a bar against the days it was granted for, and what
// pauses it: one mark per tripwire, each named on hover in its own words
// (TRIPS), with the hostile-text hold beside them. Every sentence the operator
// used to read here rides a hover; the being's and the journal's words stay
// the backend's own (mandate-shape.js plainWords).

import { Bar } from '../hud-instruments.jsx';
import { GrantMarks } from './GrantMarks.jsx';
import { Glyph } from './mandate-glyphs.jsx';
import { standingMarks } from './mandate-view.js';

const TONE = Object.freeze({ active: 'live', paused: 'warm', expired: 'idle' });

/** @param {{view: object, now: number}} props - the mandate view (use-mandate.js) with a mandate standing */
export const MandateStanding = ({ view, now }) => {
  const { marks, left } = standingMarks(view, now);
  return (
    <div className="mandate-standing">
      <GrantMarks marks={marks} term={false} />
      <div className="mandate-left" data-days-left>
        <Bar name="LEFT" value={left.value} max={left.max} text={left.text} title={left.title} tone={TONE[view.standing] || 'idle'} />
      </div>
      <div className="mandate-marks-co" data-trips>
        <span className="mandate-marks-k" title="each one pauses the whole mandate and asks you">PAUSES IF</span>
        {Object.entries(view.trips || {}).map(([kind, words]) => (
          <span key={kind} className="mandate-trip" data-trip={kind} title={words} role="img" aria-label={words}><Glyph name={kind} /></span>
        ))}
        <span className="mandate-marks-k is-inline" title="hostile text holds only what is drawn from it">HOLDS</span>
        <span className="mandate-trip is-hold" data-hold-mark title={view.holdWords} role="img" aria-label={view.holdWords}><Glyph name="hold" /></span>
      </div>
    </div>
  );
};
