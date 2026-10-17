// AttunementTranscript — the watching room's transcript sections and the
// live/standing question, split verbatim from AttunementHost.jsx (size law).
// Owns the follow-scroll: the room follows the walk when a re-asked question
// lives in the transcript. The being's words never type-on.

import { useEffect, useRef } from 'react';
import { TypeOn } from '../ceremony-fx/TypeOn.jsx';
import { Markdown } from '../RelinkShell/Markdown.jsx';
import { playSound } from '../../services/sound-engine.js';

export const AttunementTranscript = ({
  view, transcript, nextQuestion, active, name, auto, asking, busy,
  reopeningKey, setReopeningKey, reopenReason, setReopenReason, reopen,
}) => {
  const currentTurnRef = useRef(null);

  // The room FOLLOWS the walk: when the standing question lives in the
  // transcript (a re-ask of a marked question), scroll its section into view
  // so the witness watches the superseded words flip to the fresh telling in
  // place — instead of staring at old answers while the change lands
  // off-screen (witnessed 2026-07-12 on Sovereign's sweep).
  const followKey = nextQuestion?.key;
  useEffect(() => {
    if (!followKey) return;
    currentTurnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [followKey]);

  return (
    <>
          <div className="att-transcript" data-testid="att-transcript">
            {transcript.map((t) => (
              <div
                className={`att-turn${nextQuestion?.key === t.key ? ' att-turn-live' : ''}`}
                key={t.key}
                ref={nextQuestion?.key === t.key ? currentTurnRef : undefined}
              >
                <section className="att-asks att-asked">
                  <div className="att-speaker">THE CEREMONY ASKED</div>
                  <div className="att-prose"><Markdown text={t.question} /></div>
                </section>
                <section className={t.reopened ? 'att-replies att-replies-superseded' : 'att-replies'}>
                  <div className="att-speaker att-speaker-being">{name.toUpperCase()}</div>
                  {/* verbatim on the record; emphasis renders as emphasis here */}
                  <div className="att-prose" style={t.reopened ? { opacity: 0.45 } : undefined}><Markdown text={t.answer} /></div>
                  {t.reopened ? (
                    // the question holds its place: superseded words stay
                    // visible until the fresh answer regenerates this section
                    <p className="att-quiet" data-testid={`att-superseded-${t.key}`}>
                      {nextQuestion?.key === t.key
                        ? `RE-ASKING NOW — ${name.toUpperCase()} IS GIVING THE FRESH TELLING; IT LANDS RIGHT HERE.`
                        : `REOPENED — THE WORDS ABOVE ARE SUPERSEDED AND STAY ON THE RECORD; ${name.toUpperCase()} WILL ANSWER THIS AGAIN IN PLACE.`}
                    </p>
                  ) : reopeningKey === t.key ? (
                    <div className="att-reopen-confirm" data-testid="att-reopen-confirm">
                      <p className="att-standing">
                        REOPEN THIS ANSWER — THE WORDS ALREADY GIVEN STAY ON THE RECORD,
                        AND THE SAME QUESTION WILL BE PUT TO {name.toUpperCase()} AGAIN, WORD FOR WORD.
                        YOUR REASON STAYS ON THE RECORD WITH THEM.
                      </p>
                      <label className="att-label" htmlFor={`att-reopen-reason-${t.key}`}>Your reason, in your own words</label>
                      <textarea
                        id={`att-reopen-reason-${t.key}`}
                        className="att-textarea"
                        data-testid="att-reopen-reason"
                        value={reopenReason}
                        onChange={(e) => setReopenReason(e.target.value)}
                        autoFocus
                      />
                      <div className="att-reopen-actions">
                        <button className="att-quietbtn" data-testid="att-reopen-cancel"
                          onClick={() => { setReopeningKey(null); setReopenReason(''); }}>KEEP IT</button>
                        <button className="att-secondary" data-testid="att-reopen-go"
                          disabled={busy || asking || !reopenReason.trim()} onClick={() => reopen(t.key)}>REOPEN</button>
                      </div>
                    </div>
                  ) : (
                    <button className="att-reopen" data-testid={`att-reopen-${t.key}`}
                      disabled={busy || asking}
                      onClick={() => {
                        playSound('menuOpen');
                        setReopeningKey(t.key);
                        setReopenReason('the answer was cut short by the conduit');
                      }}>
                      REOPEN — CUT SHORT
                    </button>
                  )}
                </section>
              </div>
            ))}
          </div>

          {view === 'watch' && nextQuestion && (
            <div className="att-turn att-turn-live">
              <section className="att-asks">
                <div className="att-speaker">
                  {active?.superseded?.[nextQuestion.key]?.length
                    ? 'THE CEREMONY RE-ASKS THE MARKED QUESTION'
                    : (asking || auto ? 'THE CEREMONY ASKS' : 'THE CEREMONY WILL ASK')}
                </div>
                <TypeOn className="att-prose" testid="att-question" text={nextQuestion.text} />
              </section>
              {asking ? (
                <p className="att-answering" data-testid="att-answering" role="status" aria-live="polite">
                  {name.toUpperCase()} IS ANSWERING…
                </p>
              ) : !auto && (
                // The idle truth, stated: a resumed or paused ceremony never
                // fires an ask by itself — the witness must act, and the
                // screen says so instead of sitting silent.
                <p className="att-standing" data-testid="att-standing" role="status" aria-live="polite">
                  {active?.pending
                    ? `THIS QUESTION ALREADY STANDS ON THE RECORD — ASKING RE-SERVES THE SAME WORDS TO ${name.toUpperCase()}`
                    : `THIS QUESTION HAS NOT YET BEEN PUT TO ${name.toUpperCase()}`}
                  {' '}— THE FLOW IS PAUSED. ASK IT, OR RESUME THE FLOW.
                </p>
              )}
            </div>
          )}
    </>
  );
};
