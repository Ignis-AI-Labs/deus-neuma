// LinkChangeCard — the operator's ONE decision on a change the house's CMO
// proposed for a company's links (ruling, 2026-10-24: […]). SHOW, DON'T TELL: the AWAITING mark, who
// proposes, then one row per change — what stands now → what would stand —
// and APPROVE / DECLINE. Nothing is written until APPROVE.
//
// A repo it lists stays unread by anyone: one line says so, and the repo's own
// LET … READ press (its row, once listed) is the operator's separate yes.

import { StatusMark } from '../StatusMark.jsx';
import { rowView, listsRepo } from './link-change-view.js';

/**
 * @param {{change: {id: string, rows: object[]}, who: string, busy: boolean,
 *   onApprove: () => void, onDecline: () => void}} props
 */
export const LinkChangeCard = ({ change, who, busy, onApprove, onDecline }) => {
  const rows = change.rows.map(rowView);
  return (
    <div className="bk-src-card bk-lc cham" role="group" aria-label={`${who} proposes a change to these links`} data-link-change-id={change.id}>
      <div className="cham-in">
        <h5 className="label-data bk-lc-h">
          <StatusMark status="draft" title="awaiting your decision" />
          <span>{who.toUpperCase()} PROPOSES</span>
        </h5>
        {rows.length ? (
          <ul className="bk-lc-rows">
            {rows.map((r, i) => (
              <li key={`${r.label}:${r.title}:${i}`} data-lc-row={r.label} title={r.title}>
                <span className="label-data bk-lc-k">{r.label}</span>
                <span className="bk-lc-before" data-lc-before>{r.before}</span>
                <span className="bk-lc-arrow" aria-hidden="true">→</span>
                <span className="bk-lc-after" data-lc-after>{r.after}</span>
              </li>
            ))}
          </ul>
        ) : <p className="bk-note" data-lc-same>All of it is on record already.</p>}
        {listsRepo(change.rows) ? (
          <p className="bk-lc-read label-data" data-lc-read title="approving lists the repo; letting the CMO read it is its own press on its row">
            <span className="bk-src-mark" aria-hidden="true" /> LISTED ONLY — READING STAYS YOURS
          </p>
        ) : null}
        <div className="bk-modal-acts">
          <button type="button" onClick={onDecline} disabled={busy}>DECLINE</button>
          <button type="button" className="is-go" onClick={onApprove} disabled={busy}>{rows.length ? 'APPROVE' : 'CLOSE IT'}</button>
        </div>
      </div>
    </div>
  );
};
