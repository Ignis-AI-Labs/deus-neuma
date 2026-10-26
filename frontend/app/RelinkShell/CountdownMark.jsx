// CountdownMark — how long until a post goes out, by sight
// (show-dont-tell-audit.md finding 8): an hourglass and the distance ('3H
// 12M'), then the moment itself. The hourglass is an icon, never a gauge — it
// names what the number is and measures nothing (SHINKEI). Nothing ahead is
// '—'. The same mark on a post's card and an account's head (CHOKKAN 4).

import './countdown-mark.css';

const Hourglass = () => (
  <svg className="cdm-glyph" width="12" height="14" viewBox="0 0 12 14" aria-hidden="true" focusable="false">
    <path d="M1.5 1 H10.5 M1.5 13 H10.5 M2.5 1 C2.5 5 6 5.5 6 7 C6 8.5 2.5 9 2.5 13 M9.5 1 C9.5 5 6 5.5 6 7 C6 8.5 9.5 9 9.5 13" />
  </svg>
);

/**
 * @param {{ahead: ?{rel: string, at: string}, title?: string, none?: string}} props
 *   ahead — the countdown's parts (queue-when.js aheadOf / cardWhen), null when nothing is ahead;
 *   none — what the '—' means, on its hover
 */
export const CountdownMark = ({ ahead, title, none = 'nothing ahead' }) => (ahead ? (
  <span className="cdm" title={title}>
    <Hourglass /><b className="cdm-rel">{ahead.rel}</b><span className="cdm-at">{ahead.at}</span>
  </span>
) : (
  <span className="cdm is-none" title={none}><Hourglass /><b className="cdm-rel">—</b></span>
));
