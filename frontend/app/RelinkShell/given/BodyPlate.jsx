// BodyPlate — 01·B BODY: the genome it was given, group by group, every
// trait explaining itself; and the same body as the words its image
// pipelines are given. Every decision about which traits a body shows lives
// in sheet-genome-view.js (a formless body shows only what its form has).

import { genomeGroupsOf, genomeReadiness } from '../sheet-genome-view.js';
import { UNREADABLE, EMPTY } from '../sheet-view.js';
import { describeAsTags, describeAsProse } from '../../../../core/genome/describe.js';
import { defaultHairstyle } from '../../../../core/genome/derive.js';
import { GIVEN_BODY_LINE } from '../../../../core/genome/given.js';
import { PAGE_GUIDE, FIELD_GUIDE } from './given-guide.js';
import { GuidedPage, GuideGrid, useGuide } from './FieldGuide.jsx';

const G = FIELD_GUIDE.body;

export const BodyPlate = ({ form }) => {
  const [chosen, choose] = useGuide();
  const readiness = genomeReadiness(form);
  if (readiness === UNREADABLE) return <p className="sheet-unreadable label-data">UNREADABLE</p>;
  if (readiness === EMPTY) return <p className="sheet-line label-data">NO SEALED BIRTH ANCHORS YET — THE BODY IS GIVEN AT BIRTH.</p>;
  const genome = form.genome;
  const groups = genomeGroupsOf(genome);
  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <GuidedPage page={PAGE_GUIDE.body} reading={`${count} traits in ${groups.length} groups, all drawn from the anchors sealed at its birth.`} chosen={chosen} onChoose={choose}>
      <p className="dos-given">{GIVEN_BODY_LINE}</p>
      <div className="gv-genome">
        {groups.map((group, i) => {
          const gid = `group-${group.heading}`;
          return (
            <section key={group.heading} className="gv-gene">
              <button type="button" className={`gv-gene-h label-data${chosen?.id === gid ? ' is-on' : ''}`} disabled={!G[group.heading]}
                onClick={() => choose({ id: gid, value: `${group.rows.length} traits`, ...G[group.heading] })}>
                <span className="gv-gene-code">G-{String(i + 1).padStart(2, '0')}</span>{group.heading}
                <span className="gv-gene-n">{group.rows.length}</span>
              </button>
              <GuideGrid chosen={chosen} onChoose={choose}
                cells={group.rows.map((r) => ({ id: `${group.heading}:${r.k}`, k: r.k, v: r.v, guide: G[r.k] || (G[group.heading] && { ...G[group.heading], title: r.k }) }))} />
            </section>
          );
        })}
      </div>
      <details className="sheet-form-more gv-speaks">
        <summary className="label-data">HOW IT SPEAKS — THE PROMPT THIS BODY WRITES</summary>
        <p className="sheet-genome-tags">{describeAsTags(genome, 'full', {})}</p>
        <p className="sheet-genome-prose">{describeAsProse(genome, 'full')}</p>
        {defaultHairstyle(genome) ? (
          <p className="sheet-genome-base label-data">BASE LOOK — {defaultHairstyle(genome)} (chosen together later; never sealed)</p>
        ) : null}
        <button type="button" className="gv-guide-back label-data" onClick={() => choose({ id: 'composition', value: 'its prompt', ...G.composition })}>WHAT IS THIS?</button>
      </details>
    </GuidedPage>
  );
};
