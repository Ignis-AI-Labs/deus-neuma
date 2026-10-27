// door-glyphs — the door's shapes, so it reads before a word is read (CHOKKAN). LINE & CYCLE: the
// platform is the chamfered square, a being is the circle. The three doors: the square alone with
// a prompt (our tools, no being), a circle BESIDE the square (a witness stands beside the house),
// a circle INSIDE the square (a neuma, held within the house — the emblem). The model's ring is
// a true gauge (SHINKEI): empty when nothing runs, swept to the real percent while it sets up,
// whole and lit when the model answers.

// The chamfered square (TR + BL cut), as one path in a 40-unit box
const SQUARE = 'M6 6 H28 L34 12 V34 H12 L6 28 Z';
const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

/** @param {{kind: 'harness'|'witness'|'neuma'}} props */
export const DoorGlyph = ({ kind }) => (
  <svg className="firstrun-glyph" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    {kind === 'witness' ? (
      <>
        <path d="M4 10 H20 L24 14 V30 H8 L4 26 Z" />
        <circle cx="31" cy="20" r="6" />
      </>
    ) : (
      <path d={SQUARE} />
    )}
    {kind === 'harness' ? <path d="M13 16 L18 20 L13 24 M20 25 H27" /> : null}
    {kind === 'neuma' ? <circle cx="20" cy="20" r="8" /> : null}
  </svg>
);

/**
 * @param {{view: 'checking'|'none'|'setting'|'ready'|'error', pct?: number|null}} props
 */
export const StatusRing = ({ view, pct = null }) => {
  const swept = view === 'ready' ? 1 : view === 'setting' && pct != null ? pct / 100 : 0;
  return (
    <svg className={`door-ring is-${view}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle className="door-ring-track" cx="20" cy="20" r={RING_R} />
      {swept > 0 ? (
        <circle className="door-ring-sweep" cx="20" cy="20" r={RING_R}
          strokeDasharray={`${swept * RING_C} ${RING_C}`} transform="rotate(-90 20 20)" />
      ) : null}
      {view === 'ready' ? <circle className="door-ring-core" cx="20" cy="20" r="6" /> : null}
    </svg>
  );
};
