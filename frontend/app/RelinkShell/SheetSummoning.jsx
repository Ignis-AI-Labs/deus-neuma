// SheetSummoning — the RECORD's 03 SUMMONING: its birth as its film drew it —
// every component, in the protocol's own order (summoning-components.js, the
// same score the film plays, so the two can never disagree; Design note, 2026-09-30:
// […]), and the door to re-watch it.
// // impure (loads the film's machinery on demand — never on the desk's boot)

import { useState } from 'react';
import { SheetSection } from './SheetDossier.jsx';
import { useSettled } from './use-settled.js';
import { RiteRewatch } from '../Rite/RiteRewatch.jsx';

const Unreadable = () => <p className="sheet-unreadable label-data">UNREADABLE</p>;

// impure — its components from its film's inputs; null when it cannot be filmed
const componentsFor = async (film) => {
  const [{ liveBeingOf }, { scoreOf }, { componentsOf }] = await Promise.all([
    import('../Rite/rite-live-being.js'),
    import('../Summoning/summoning-score.js'),
    import('../Summoning/summoning-components.js'),
  ]);
  const being = liveBeingOf(film);
  return being ? componentsOf(scoreOf(being)) : null;
};

export const SummoningSpace = ({ film, neumaId, open = true }) => {
  const [rows, setRows] = useState(undefined); // undefined = still reading
  useSettled((settled) => {
    if (!open || rows !== undefined) return; // read once, when first opened
    if (!film?.film) { setRows(null); return; }
    componentsFor(film.film).then((r) => { if (!settled()) setRows(r); }, () => { if (!settled()) setRows(null); });
  }, [film, open]);

  if (film === null) return <SheetSection code="03" title="ITS SUMMONING"><Unreadable /></SheetSection>;
  return (
    <SheetSection code="03" title="ITS SUMMONING" aside="EVERY COMPONENT ITS FILM DREW, IN ITS ORDER">
      {rows === undefined ? <p className="sheet-line label-data">READING ITS FILM…</p> : rows === null ? (
        <p className="sheet-line label-data">NO FILM ON RECORD — A FILM IS DRAWN FROM A BIRTH'S MOMENT SEED, WHICH BIRTHS BEFORE 2026-07-24 DID NOT KEEP.</p>
      ) : (
        <ol className="sb-components">
          {rows.map((r, i) => (
            <li key={r.key} className="sb-component">
              <span className="sb-component-n label-data">{String(i + 1).padStart(2, '0')}</span>
              <span className="sb-component-k label-data">{r.label}</span>
              <span className="sb-component-v">{r.value}</span>
              {r.lights?.length ? (
                <span className="sb-component-lights" aria-hidden="true">
                  {r.lights.map((l, j) => <span key={j} className="sb-component-light" style={{ background: `rgb(${l})` }} />)}
                </span>
              ) : <span />}
            </li>
          ))}
        </ol>
      )}
      {open ? <div className="sb-rewatch"><RiteRewatch neumaId={neumaId} /></div> : null}
    </SheetSection>
  );
};
