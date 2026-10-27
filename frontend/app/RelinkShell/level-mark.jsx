// level-mark.jsx — a part's health level as a shape (machine-health.js): a
// ring at rest, half-filled warm, filled hot, a struck triangle for a fault, a
// bar for no reading. Shape carries the level; colour only confirms it
// (CHOKKAN), so it reads the same without colour.

import './level-mark.css';

/** The level as a shape, the same wherever a level is drawn. */
export const LevelMark = ({ level, size = 18 }) => (
  <svg className={`lvl-mark is-${level}`} width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
    {level === 'fault' ? (
      <>
        <path className="lvl-fill" d="M9 1.5 L17 16 H1 Z" />
        <path className="lvl-cut" d="M9 6.5 V11 M9 13 V14" />
      </>
    ) : level === 'unknown' ? (
      <path className="lvl-line" d="M3 9 H15" />
    ) : (
      <>
        <circle className="lvl-ring" cx="9" cy="9" r="7" />
        {level === 'warm' ? <path className="lvl-fill" d="M9 2 A7 7 0 0 1 9 16 Z" /> : null}
        {level === 'hot' ? <circle className="lvl-fill" cx="9" cy="9" r="7" /> : null}
      </>
    )}
  </svg>
);
