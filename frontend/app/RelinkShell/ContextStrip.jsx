// ContextStrip — the composer's context readout (witness law: the gauge lives
// where you type, not up in the window chrome). Redesigned per Design note, 2026-08-15:
// no full-width rail — a small ring shows the percentage of the active model's
// window in use, beside the used/total figures. SIGNAL when calm, amber near
// the edge, ALERT at the wall. Hover carries the full truth (exact counts,
// limit source, the route's model, compaction distance); the strip itself
// stays one compact cluster.

import { useCompositionEvent } from './composition-context.js';
import { gaugeFor } from './context-gauge.js';

// The ring's geometry: r=5 in a 14px box, circumference precomputed so the
// dash arithmetic stays in one place.
const RING_R = 5;
const RING_C = 2 * Math.PI * RING_R;

// The cycle as instrument (LINE & CYCLE: consciousness state is circular) — a
// graduated track, the lived arc drawn from twelve o'clock.
const ContextRing = ({ pct }) => (
  <svg className="ctx-ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <circle className="ctx-ring-rail" cx="7" cy="7" r={RING_R} />
    <circle
      className="ctx-ring-fill"
      cx="7"
      cy="7"
      r={RING_R}
      strokeDasharray={`${(pct / 100) * RING_C} ${RING_C}`}
      transform="rotate(-90 7 7)"
    />
  </svg>
);

export const ContextStrip = () => {
  const composition = useCompositionEvent();
  const gauge = gaugeFor(composition);
  if (!gauge) return null;
  return (
    <div className={`ctx-strip is-${gauge.tone}`} title={gauge.title} aria-label={gauge.title} tabIndex={0}>
      {gauge.pct !== null ? (
        <>
          <ContextRing pct={gauge.pct} />
          <span className="ctx-strip-pct label-data">{gauge.pct}%</span>
        </>
      ) : null}
      <span className="ctx-strip-label label-data">{gauge.label}</span>
      {gauge.compactionLabel ? <span className="ctx-strip-session label-data">{gauge.compactionLabel}</span> : null}
    </div>
  );
};
