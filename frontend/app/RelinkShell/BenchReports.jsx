// BenchReports — the REPORTS tab, pure rendering: three sub-tabs, each with
// one job. EXPLORER walks every benchmark taken and goes deep into each
// (the overall chart lives on OVERVIEW — the atlas); LIBRARY is every proof
// certificate and night bundle, stepped through one by one; SHARE turns a
// result into a card or a table people can post. The IO lives in
// use-bench-reports.js.

import './BenchApp.css';
import './BenchApp-reports.css';
import { BenchExplorer } from './BenchExplorer.jsx';
import { BenchLibrary } from './BenchLibrary.jsx';
import { BenchShare } from './BenchShare.jsx';
import { REPORT_SUBTABS } from './bench-summary-view.js';

export const BenchReports = ({ sub, onSub, explorer, library, share }) => (
  <div className="bench-reports-wrap">
    <div className="bench-subtabs">
      {REPORT_SUBTABS.map((t) => (
        <button key={t.id} type="button" className={`bench-btn label-data${sub === t.id ? ' is-on' : ''}`} onClick={() => onSub(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
    {sub === 'explorer' ? <BenchExplorer {...explorer} /> : null}
    {sub === 'library' ? <BenchLibrary {...library} /> : null}
    {sub === 'share' ? <BenchShare {...share} /> : null}
  </div>
);
