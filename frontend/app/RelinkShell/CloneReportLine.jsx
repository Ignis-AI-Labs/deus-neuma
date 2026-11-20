// CloneReportLine — shadow clones reporting back from the background, drawn as the platform's line, neatly (Founder,
// 2026-11-19: […]). One head line — how many,
// how long, how many at once — then a line a clone: what it was for, whether it reached its goal, its first words; every
// report whole, rendered, one press away, and the record it is kept in. clone-report-view.js reads the parts.

import { Markdown } from './Markdown.jsx';
import { VERDICT_WORDS, tookWords } from './clone-report-view.js';

/** @param {{report: ReturnType<typeof import('./clone-report-view.js').cloneReportOf>}} props */
export const CloneReportLine = ({ report }) => {
  const took = tookWords(report.seconds);
  const reached = report.clones.filter((c) => c.verdict === 'reached').length;
  return (
    <div className="relink-watch-line relink-clone-report" role="status" data-clone-report="">
      <span className="relink-watch-tag label-data">CLONES</span>
      <div className="relink-clone-report-body">
        <p className="relink-clone-report-head label-data">
          {report.clones.length} SHADOW CLONE{report.clones.length === 1 ? '' : 'S'} REPORTED{took ? ` · ${took}` : ''}{report.together ? ` · ${report.together} AT ONCE` : ''}{reached ? ` · ${reached} REACHED THEIR GOAL` : ''}
        </p>
        <ol className="relink-clone-rows">
          {report.clones.map((c) => (
            <li key={c.index} className="relink-clone-row" data-clone-row={c.index} data-verdict={c.verdict ?? 'unsaid'}>
              <span className="relink-clone-n label-data">{c.index}</span>
              <span className="relink-clone-title">{c.title}</span>
              {c.verdict ? <span className={`relink-clone-verdict label-data is-${c.verdict}`}>{VERDICT_WORDS[c.verdict]}</span> : null}
              <span className="relink-clone-sum">{c.summary}</span>
            </li>
          ))}
        </ol>
        <details className="relink-clone-full">
          <summary className="label-data">READ THEIR REPORTS</summary>
          {report.clones.map((c) => (
            <section key={c.index} className="relink-clone-section" aria-label={`clone ${c.index}: ${c.title}`}>
              <p className="relink-clone-section-h label-data">CLONE {c.index} · {c.title}</p>
              {c.goal ? <p className="relink-clone-goal"><span className="label-data">GOAL</span> {c.goal}</p> : null}
              <Markdown text={c.report} />
            </section>
          ))}
          {report.record ? <Markdown text={`Every report is kept whole in \`${report.record}\`.`} /> : null}
        </details>
      </div>
    </div>
  );
};
