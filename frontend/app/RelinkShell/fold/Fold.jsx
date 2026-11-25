// Fold — A SECTION IS A LINE FIRST (design-language.md § FOLD; Design note, 2026-11-16: […]).
//
// One component for every section of every hub. The line carries the section's name, its state and its counts,
// so nothing is hidden that is a number; a press opens the detail. It stands open while it waits on the
// operator, folded otherwise, keeps the operator's own choice, and never folds under their hands. Keyboard
// and screen readers get the platform's own <details>.

import { useEffect, useState } from 'react';
import { foldOpen, readFold, keepFold, statOf } from './fold-state.js';
import './Fold.css';

/**
 * @param {{id: string, title: string, stats?: Array<string | {text: string, tone?: 'on' | 'alert'}>, waits?: boolean,
 *   level?: 1 | 2, children: any}} props — id: the section's own key (its choice is kept under it); stats: its
 *   state and counts, in words; waits: it owes the operator a decision; level: 1 a tab's section, 2 an item in it
 */
export const Fold = ({ id, title, stats = [], waits = false, level = 1, children }) => {
  // Decided when it first shows; never folded under the operator's hands (a section they just acted on stays
  // open until they leave or fold it). It opens by itself only when it STARTS to wait and they have not folded it.
  const [open, setOpen] = useState(() => foldOpen(readFold(id), waits));
  useEffect(() => { if (waits && readFold(id) !== '0') setOpen(true); }, [waits, id]);
  const toggle = (e) => {
    e.preventDefault(); // the open state is ours, so a kept choice and a new wait both show
    keepFold(id, !open);
    setOpen(!open);
  };
  return (
    <details className={`fold fold-l${level}${waits ? ' is-waiting' : ''}`} open={open} data-fold={id}>
      <summary className="fold-sum" onClick={toggle}>
        <span className="fold-mark" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="fold-title label-data">{title}</span>
        {stats.map(statOf).filter((s) => s.text).map((s) => <span key={s.text} className={`fold-stat label-data${s.tone ? ` is-${s.tone}` : ''}`}>{s.text}</span>)}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
};
