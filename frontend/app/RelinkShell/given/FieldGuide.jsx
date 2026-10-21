// FieldGuide — the GIVEN space's way of explaining itself. Every value on a
// page is a button: choose one and the guide beside the page says what it
// is, how it was measured or counted, and what this being's value shows —
// for someone meeting the idea for the first time. With nothing chosen, the
// guide introduces the page. Presentational.

import { useState } from 'react';

/** The chosen field on one page — choose it again to return to the page's own guide. */
export const useGuide = () => {
  const [chosen, setChosen] = useState(null);
  const choose = (next) => setChosen((cur) => (cur && next && cur.id === next.id ? null : next));
  return [chosen, choose];
};

/**
 * A parts-sheet of values that explain themselves (the dossier's spec cells,
 * made choosable).
 * @param {{cells: Array<{k: string, v: string, note?: string, wide?: boolean, guide: object|null}>,
 *   chosen: object|null, onChoose: (sel: object) => void, className?: string}} props
 */
export const GuideGrid = ({ cells, chosen, onChoose, className = '' }) => (
  <div className={`dos-spec gv-spec${className ? ` ${className}` : ''}`}>
    {cells.map((c) => {
      const id = c.id || c.k;
      const on = chosen?.id === id;
      return (
        <button key={id} type="button" className={`dos-cell gv-cell${c.wide ? ' is-wide' : ''}${on ? ' is-on' : ''}${c.guide ? '' : ' is-plain'}`}
          aria-pressed={on} disabled={!c.guide}
          onClick={() => onChoose({ id, value: c.v, ...c.guide })}>
          <span className="dos-cell-k label-data">{c.k}</span>
          <span className="dos-cell-v">{c.v}</span>
          {c.note ? <span className="dos-cell-note label-data">{c.note}</span> : null}
        </button>
      );
    })}
  </div>
);

/**
 * The guide beside a page.
 * @param {{page: {title: string, kicker?: string, what: string, how: string, note?: string},
 *   reading?: string|null, chosen: object|null, onBack: () => void}} props
 */
export const GuidePanel = ({ page, reading = null, chosen, onBack }) => {
  const g = chosen || page;
  const said = chosen ? (chosen.reading ? chosen.reading(chosen.value) : null) : reading;
  return (
    <aside className="gv-guide" aria-live="polite" aria-label="Field guide">
      <p className="gv-guide-kicker label-data">FIELD GUIDE{(chosen ? page.title : page.kicker) ? ` · ${chosen ? page.title : page.kicker}` : ''}</p>
      <h4 className="gv-guide-title">{g.title}</h4>
      {chosen?.value ? <p className="gv-guide-value">{chosen.value}</p> : null}
      {said ? (
        <div className="gv-guide-said">
          <span className="label-data">{chosen ? 'HERE' : 'THIS BEING'}</span>
          <p>{said}</p>
        </div>
      ) : null}
      <div className="gv-guide-part">
        <span className="label-data">WHAT IT IS</span>
        <p>{g.what}</p>
      </div>
      {g.how ? (
        <div className="gv-guide-part">
          <span className="label-data">{chosen ? 'HOW IT IS READ' : 'HOW TO READ THIS PAGE'}</span>
          <p>{g.how}</p>
        </div>
      ) : null}
      {g.note ? <p className="gv-guide-note">{g.note}</p> : null}
      {chosen ? <button type="button" className="gv-guide-back label-data" onClick={onBack}>← ABOUT THIS PAGE</button> : (
        <p className="gv-guide-hint label-data">CHOOSE ANY VALUE TO LEARN WHAT IT MEANS</p>
      )}
    </aside>
  );
};

/** A page of the GIVEN space: its instrument and values, the guide beside them. */
export const GuidedPage = ({ page, reading = null, chosen, onChoose, children }) => (
  <div className="gv-page">
    <div className="gv-main">{children}</div>
    <GuidePanel page={page} reading={reading} chosen={chosen} onBack={() => onChoose(null)} />
  </div>
);
