// HealthStrip — a console's state in one read, atop it: one cell per part
// (SUBSTRATE: machine-health.js; MARKETING: marketing-health.js), its level
// drawn as a shape — a ring at rest, half-filled warm, filled hot, a struck
// triangle for a fault — so the state reads before any word does (CHOKKAN).
// The number in each cell is the one that decides its level. A press on a
// cell brings that part's panel into view, or does what the console's
// `onCell` says (JŌHŌ SEKKEI: every count is a door).

import './health-strip.css';
import { LevelMark } from './level-mark.jsx';

const WORD = Object.freeze({ ok: 'OK', warm: 'WARM', hot: 'HOT', fault: 'FAULT', unknown: 'NO READING' });

/**
 * Bring a part's panel into view, inside the same console (the element
 * marked `data-health-root`, else SUBSTRATE's body). impure — the DOM.
 * @param {Element} from - the pressed element
 * @param {string} part - the panel's `data-part`
 */
export const revealPanel = (from, part) => {
  const panel = from.closest('[data-health-root], .sub-body')?.querySelector(`[data-part="${part}"]`);
  const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  panel?.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
};

/**
 * @param {{cells: object[], label?: string, cols?: number, onCell?: (cell: object, from: Element) => void}} props
 *   cells: {part, panel?, label, level, value, unit, what, title?}; cols: cells per row when wide
 *   (all of them by default), half as many narrower
 */
export const HealthStrip = ({ cells, label = 'Machine health', cols = cells.length, onCell }) => (
  <nav className="hlth" aria-label={label} style={{ '--hlth-cols': cols, '--hlth-cols-mid': Math.ceil(cols / 2) }}>
    {cells.map((c) => (
      <button key={c.part} type="button" className={`hlth-cell cham is-${c.level}`} data-cell={c.part}
        onClick={(e) => (onCell ? onCell(c, e.currentTarget) : revealPanel(e.currentTarget, c.panel))}
        title={c.title || `${c.label} — ${WORD[c.level]} · ${c.what}`}>
        <LevelMark level={c.level} size={22} />
        <span className="hlth-part">{c.label}</span>
        <span className="hlth-num">{c.value ?? '—'}<span className="hlth-unit">{c.value === null ? '' : c.unit}</span></span>
        <span className="hlth-word">{WORD[c.level]}</span>
        <span className="hlth-what">{c.what}</span>
      </button>
    ))}
  </nav>
);
