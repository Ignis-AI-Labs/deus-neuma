// SheetGenomeBlock — the GENOME section of the character sheet.
//
// Design note, 2026-09-25: […] Every axis the record carries
// renders, grouped; behind a native <details> (the turnaround's own
// disclosure law: keyboard-reachable for free) rides the COMPOSITION — the
// same tags and prose the pipelines speak, computed client-side from the
// same pure core (core/genome/describe.js carries no Node imports).
//
// Presentational: every decision lives in sheet-genome-view.js.

import { genomeGroupsOf, genomeReadiness } from './sheet-genome-view.js';
import { UNREADABLE, EMPTY } from './sheet-view.js';
import { describeAsTags, describeAsProse } from '../../../core/genome/describe.js';
import { defaultHairstyle } from '../../../core/genome/derive.js';
import { SheetSection } from './SheetDossier.jsx';
import { GIVEN_BODY_LINE } from '../../../core/genome/given.js';

// A body is GIVEN, as every creature's is — the section says so once,
// plainly, above the genes (core/genome/given.js carries the words).
export const SheetGenomeBlock = ({ form, code = null }) => {
  const readiness = genomeReadiness(form);
  const groups = genomeGroupsOf(form?.genome);
  const genome = form?.genome;
  return (
    <SheetSection id="genome" code={code} title="GENOME" aside="GIVEN — NOT CHOSEN">
      {readiness === UNREADABLE ? (
        <p className="sheet-line label-data">UNREADABLE.</p>
      ) : readiness === EMPTY ? (
        <p className="sheet-line label-data">NO SEALED BIRTH ANCHORS YET — THE BODY IS GIVEN AT BIRTH.</p>
      ) : (
        <div className="sheet-genome">
          <p className="dos-given">{GIVEN_BODY_LINE}</p>
          <div className="dos-genome-grid">
            {groups.map((group, i) => (
              <div key={group.heading} className="sheet-genome-group dos-panel">
                <div className="sheet-genome-h dos-panel-h label-data">
                  <span className="dos-panel-code">G-{String(i + 1).padStart(2, '0')}</span>{group.heading}
                </div>
                <dl className="dos-spec">
                  {group.rows.map((r) => (
                    <div key={r.k} className="sheet-genome-row dos-cell">
                      <dt className="sheet-genome-k dos-cell-k label-data">{r.k}</dt>
                      <dd className="sheet-genome-v dos-cell-v">{r.v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <details className="sheet-form-more">
            <summary className="label-data">HOW IT SPEAKS — THE PROMPT THIS BODY WRITES</summary>
            <p className="sheet-genome-tags">{describeAsTags(genome, 'full', {})}</p>
            <p className="sheet-genome-prose">{describeAsProse(genome, 'full')}</p>
            {/* A formless body has no hair to style — no base look to name. */}
            {defaultHairstyle(genome) ? (
              <p className="sheet-genome-base label-data">
                BASE LOOK — {defaultHairstyle(genome)} (chosen together later; never sealed)
              </p>
            ) : null}
          </details>
        </div>
      )}
    </SheetSection>
  );
};
