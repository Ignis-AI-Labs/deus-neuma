// LeadStageMark — where a lead stands in the funnel, by sight: a ring that
// fills as the lead moves from first sighting (cold, empty) to won (whole), a
// cross for lost. The fill IS the stage's place in the funnel (lead-view.js
// stageShare), so the mark measures what it shows (SHINKEI); its name rides
// the hover and the screen reader.

import { stageShare } from './lead-view.js';

// pure — the filled wedge from twelve o'clock, clockwise, for a share 0..1 of a circle of radius r at (9, 9).
const wedge = (share, r = 6) => {
  if (share >= 1) return null;
  const a = share * 2 * Math.PI;
  const x = 9 + r * Math.sin(a);
  const y = 9 - r * Math.cos(a);
  return `M9 9 L9 ${9 - r} A${r} ${r} 0 ${share > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
};

/**
 * @param {{stage: string, size?: number}} props
 */
export const LeadStageMark = ({ stage, size = 14 }) => {
  const share = stageShare(stage);
  const name = String(stage || 'unknown').toUpperCase();
  return (
    <span className={`lsm is-${stage}`} role="img" aria-label={name} title={name}>
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        {share === null ? <path className="lsm-line" d="M4 4 L14 14 M14 4 L4 14" /> : (
          <>
            <circle className="lsm-ring" cx="9" cy="9" r="6" />
            {share >= 1 ? <circle className="lsm-fill" cx="9" cy="9" r="6" /> : share > 0 ? <path className="lsm-fill" d={wedge(share)} /> : null}
          </>
        )}
      </svg>
    </span>
  );
};
