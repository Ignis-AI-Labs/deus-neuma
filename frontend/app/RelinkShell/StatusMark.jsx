// StatusMark — where a post stands, as ONE mark (post-status-marks.js): the
// shape carries it, the colour confirms it, the name (two words at most)
// stands beside it when `named`, else rides the hover. The geometry is the
// desk's level mark's own (level-mark.css), so a ring is a ring everywhere.

import { statusMark, statusKeyOf } from './post-status-marks.js';
import './level-mark.css';
import './status-mark.css';

const SHAPES = Object.freeze({
  ring: <circle className="lvl-ring" cx="9" cy="9" r="6" />,
  'ring-dot': <><circle className="lvl-ring" cx="9" cy="9" r="6" /><circle className="lvl-fill" cx="9" cy="9" r="2.2" /></>,
  half: <><circle className="lvl-ring" cx="9" cy="9" r="6" /><path className="lvl-fill" d="M9 3 A6 6 0 0 1 9 15 Z" /></>,
  disc: <circle className="lvl-fill" cx="9" cy="9" r="6" />,
  diamond: <path className="lvl-ring" d="M9 2.5 L15.5 9 L9 15.5 L2.5 9 Z" />,
  'diamond-fill': <path className="lvl-fill" d="M9 2.5 L15.5 9 L9 15.5 L2.5 9 Z" />,
  fault: <><path className="lvl-fill" d="M9 2 L16 15 H2 Z" /><path className="lvl-cut" d="M9 6.5 V10.5 M9 12.5 V13.5" /></>,
  cross: <path className="lvl-line" d="M4 4 L14 14 M14 4 L4 14" />,
  slash: <><circle className="lvl-ring" cx="9" cy="9" r="6" /><path className="lvl-line" d="M4.8 13.2 L13.2 4.8" /></>,
  check: <path className="lvl-line" d="M3.5 9.5 L7.5 13.5 L14.5 4.5" />,
  line: <path className="lvl-line" d="M3 9 H15" />,
  plus: <path className="lvl-line" d="M9 3 V15 M3 9 H15" />,
  'plus-ring': <><circle className="lvl-ring" cx="9" cy="9" r="6.5" /><path className="lvl-line" d="M9 5.5 V12.5 M5.5 9 H12.5" /></>,
  play: <path className="lvl-fill" d="M5 3 L15 9 L5 15 Z" />,
  square: <rect className="lvl-ring" x="3.5" y="3.5" width="11" height="11" />,
  pause: <path className="lvl-fill" d="M4 3 H7.5 V15 H4 Z M10.5 3 H14 V15 H10.5 Z" />,
});

/**
 * @param {{status?: string, entry?: object, named?: boolean, title?: string, size?: number}} props
 *   `status` is a key of the table; `entry` a queue entry (its key is read from it).
 */
export const StatusMark = ({ status, entry, named = false, title, size = 14 }) => {
  const key = entry ? statusKeyOf(entry) : status;
  const m = statusMark(key);
  return (
    <span className={`stm is-${m.tone}`} data-status={key} title={title || m.name}
      {...(named ? {} : { role: 'img', 'aria-label': m.name })}>
      <svg className="stm-mark" width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">{SHAPES[m.shape]}</svg>
      {named ? <span className="stm-name">{m.name}</span> : null}
    </span>
  );
};
