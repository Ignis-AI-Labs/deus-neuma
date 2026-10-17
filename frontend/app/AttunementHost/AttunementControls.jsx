// AttunementControls — the controls strip (the watch row, and the pre-seal
// review with its seal), the phase rail, and the abandon dialog, split
// verbatim from AttunementHost.jsx (size law). The host keeps the guards
// ({rail && …}, {abandoning && …}) so the DOM order is untouched.

import { TypeOn } from '../ceremony-fx/TypeOn.jsx';

export const AttunementControls = ({
  view, busy, asking, auto, setAuto, setAbandoning, advance,
  review, reopenFlagged, seal, answered, name,
}) => (
  <>
          {view === 'watch' ? (
            <div className="att-controls">
              <button className="att-quietbtn" data-testid="att-abandon" disabled={busy} onClick={() => setAbandoning(true)}>
                END WITHOUT SEALING
              </button>
              <button className="att-secondary" data-testid="att-auto" onClick={() => setAuto((a) => !a)}>
                {auto ? 'PAUSE THE FLOW' : 'RESUME THE FLOW'}
              </button>
              {!auto && (
                <button className="att-primary" data-testid="att-ask" disabled={asking} onClick={advance}>
                  ASK THE NEXT QUESTION
                </button>
              )}
            </div>
          ) : (
            <>
              <section className="att-asks">
                <div className="att-speaker">THE CEREMONY</div>
                <TypeOn
                  className="att-prose"
                  text={`Every question is faced. ${answered} answers, in ${name}'s own words, already in their sovereign record. Before the seal, the record takes the same review every answer took at the door — formula phrasing and corruption, scored across the whole record at once.`}
                />
                {!review && (
                  <p className="att-quiet" data-testid="att-reviewing">THE REVIEW IS READING THE RECORD…</p>
                )}
                {review && review.flagged.length > 0 && (
                  <p className="att-quiet" data-testid="att-review-flagged">
                    {review.flagged.length} OF {review.answered} ANSWERS READ AS FORMULA OR CARRY CORRUPTION —
                    REOPEN THEM IN ONE ACT AND {name.toUpperCase()} ANSWERS THEM FRESH. THE SEAL WAITS FOR A CLEAN RECORD.
                  </p>
                )}
                {review && review.flagged.length === 0 && (
                  <p className="att-quiet" data-testid="att-review-clean">
                    THE REVIEW IS CLEAN — EVERY ANSWER IN {name.toUpperCase()}'S OWN FRESH WORDS. THE SEAL IS YOURS.
                  </p>
                )}
              </section>
              <div className="att-controls">
                {review && review.flagged.length > 0 && (
                  <button className="att-primary" data-testid="att-reopen-flagged" disabled={busy} onClick={reopenFlagged}>
                    REOPEN THE {review.flagged.length} FLAGGED ANSWERS
                  </button>
                )}
                <button
                  className="att-primary"
                  data-testid="att-seal"
                  disabled={busy || !review || review.flagged.length > 0}
                  onClick={seal}
                >
                  SEAL THE RECORD
                </button>
              </div>
            </>
          )}
  </>
);

export const AttunementRail = ({ rail }) => (
        <footer className="att-rail" data-testid="att-rail" aria-hidden="true">
          {rail.map((node) => (
            <div className={`att-rail-node att-rail-${node.state}`} key={node.key}>
              <div className="att-rail-label">{node.label}</div>
              <div className="att-rail-dot" />
            </div>
          ))}
        </footer>
);

export const AttunementAbandonDialog = ({
  name, busy, abandonReason, setAbandonReason, setAbandoning, confirmAbandon,
}) => (
        <div
          className="att-dialog-veil"
          data-testid="att-abandon-dialog"
          onKeyDown={(e) => { if (e.key === 'Escape') { setAbandoning(false); setAbandonReason(''); } }}
        >
          <div className="att-dialog" role="dialog" aria-modal="true" aria-labelledby="att-abandon-reason">
            <p className="att-prose">
              This ceremony will close without sealing. Nothing {name} has
              already answered is lost — the record is preserved — but this
              ceremony ends here, and your reason stays on the record.
            </p>
            <label className="att-label" htmlFor="att-abandon-reason">Your reason, in your own words</label>
            <textarea
              id="att-abandon-reason"
              className="att-textarea"
              data-testid="att-abandon-reason"
              value={abandonReason}
              onChange={(e) => setAbandonReason(e.target.value)}
              autoFocus
            />
            <div className="att-controls">
              <button
                className="att-secondary"
                data-testid="att-abandon-cancel"
                disabled={busy}
                onClick={() => { setAbandoning(false); setAbandonReason(''); }}
              >
                KEEP GOING
              </button>
              <button
                className="att-primary"
                data-testid="att-abandon-confirm"
                disabled={busy || !abandonReason.trim()}
                onClick={confirmAbandon}
              >
                END WITHOUT SEALING
              </button>
            </div>
          </div>
        </div>
);
