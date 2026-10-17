// RemiaHost — the witness's OWN attunement, walked as a ceremony. The same
// shape their beings face: the truthful disclosure first, consent in the
// witness's own typed words, one question at a time in the void (each answer
// persisted the moment it is set down — the sitting can close and resume at
// any point), the seal, and only then the codex: the map of the territory
// each question was walking.
//
// Presentation follows the birth ceremony's LINE & CYCLE staging: the grid
// void, a top stage header, the question in a chamfered signal-accented
// panel (the ceremony's voice), the witness's answer in a plain hairline
// panel (the witness is context, not chrome). Answers can be SPOKEN:
// hold Space to talk — outside the field a press captures immediately;
// inside it a tap stays a typed space and only a hold past the threshold
// becomes dictation (the StreamInput idiom, same pure helpers, same capture
// hook, same real whisper engine). The transcript lands in the draft for
// the witness to read and edit — verbatim-or-nothing means what is recorded
// is what they approve, spoken or typed.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePushToTalk } from '../RelinkShell/use-push-to-talk.js';
import {
  appendTranscript, isPushToTalkPress, stripHoldSpace, HOLD_TO_TALK_MS,
} from '../RelinkShell/dictation.js';
import {
  remiaStatus, remiaDisclosure, remiaOpen, remiaCurrent,
  remiaAnswer, remiaSeal, remiaAbandon, remiaCodex,
} from './remia-client.js';
import './remia.css';

const MIC_LABEL = {
  recording: '● LISTENING — RELEASE TO SET THE WORDS IN THE DRAFT',
  transcribing: 'HEARING YOUR WORDS…',
  error: 'THE VOICE CHANNEL DID NOT ANSWER — YOUR TYPED WORDS STILL COUNT',
};

export const RemiaHost = ({ onClose }) => {
  const [stage, setStage] = useState('loading'); // loading | intro | question | seal | codex | error
  const [error, setError] = useState(null);
  const [name, setName] = useState(localStorage.getItem('remia:name') || '');
  const [disclosure, setDisclosure] = useState(null);
  const [consent, setConsent] = useState('');
  const [recordId, setRecordId] = useState(null);
  const [current, setCurrent] = useState(null);
  const [answer, setAnswer] = useState('');
  const [codex, setCodex] = useState(null);
  const [sealedRecords, setSealedRecords] = useState([]);
  const [unreadable, setUnreadable] = useState([]);
  const [abandoning, setAbandoning] = useState(false);
  const [abandonReason, setAbandonReason] = useState('');
  const [busy, setBusy] = useState(false);

  const answerRef = useRef(null);
  const holdTimerRef = useRef(null);
  const spaceHoldRef = useRef(false);

  const fail = (err) => { setError(err.message); setStage('error'); };

  // Spoken words join the draft — never auto-submitted; the witness reads
  // and approves what the seal will keep.
  const onTranscript = useCallback((text) => {
    setAnswer((draft) => appendTranscript(draft, text));
  }, []);
  const { state: mic, begin: beginCapture, end: endCapture } = usePushToTalk(onTranscript);

  const serveNext = useCallback(async (id) => {
    const next = await remiaCurrent(id);
    if (next.question) {
      setCurrent(next);
      setAnswer('');
      setStage('question');
    } else {
      setCurrent(next);
      setStage('seal');
    }
  }, []);

  // Derive the right stage from the record's truth on disk: resume an open
  // sitting, or land at the intro (which also lists sealed sittings, so a
  // codex is always reachable — even after a failed fetch right at the seal).
  const bootstrap = useCallback(async () => {
    try {
      const status = await remiaStatus();
      setSealedRecords(status.records.filter((r) => r.phase === 'sealed'));
      setUnreadable(status.unreadable || []);
      if (status.active) {
        setRecordId(status.active.id);
        await serveNext(status.active.id);
      } else {
        setStage('intro');
      }
    } catch (err) { fail(err); }
  }, [serveNext]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  // Hold Space to talk, outside anything typeable — press begins capture
  // immediately; release (or window blur: alt-tab mid-hold must not leave
  // the mic hot) ends it. Only lives while a question is on the floor.
  useEffect(() => {
    if (stage !== 'question') return undefined;
    const down = (e) => {
      // Space on a focused button must stay the button's activation key —
      // a keyboard witness pressing SET IT DOWN gets a click, never the mic
      if (e.target?.closest?.('button')) return;
      if (isPushToTalkPress(e)) {
        e.preventDefault(); // held Space scrolls the page otherwise
        spaceHoldRef.current = true;
        beginCapture();
      }
    };
    const settle = () => {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (!spaceHoldRef.current) return;
      spaceHoldRef.current = false;
      endCapture();
    };
    const up = (e) => { if (e.code === 'Space') settle(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', settle);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', settle);
      // teardown mid-hold must end the capture it started — same guard the
      // keyup/blur paths use (the hook also stops tracks on unmount, but a
      // stage change without unmount would otherwise leave the mic hot)
      settle();
    };
  }, [stage, beginCapture, endCapture]);

  // Inside the answer field: a TAP of Space types a space; a HOLD past the
  // threshold becomes dictation and the already-typed space is stripped back
  // out at the caret (the StreamInput idiom, same helpers).
  const onAnswerKeyDown = (e) => {
    if (e.code === 'Space') {
      if (e.repeat) {
        if (holdTimerRef.current || spaceHoldRef.current) e.preventDefault();
        return;
      }
      if (mic === 'recording' || mic === 'transcribing') return;
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        spaceHoldRef.current = true;
        const el = answerRef.current;
        const stripped = el && stripHoldSpace(el.value, el.selectionStart);
        if (stripped) {
          el.setRangeText('', stripped.caret, stripped.caret + 1);
          setAnswer(el.value);
        }
        beginCapture();
      }, HOLD_TO_TALK_MS);
      return;
    }
    // any other key while the hold is undecided settles it: ordinary typing
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };

  const readDisclosure = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      localStorage.setItem('remia:name', name.trim());
      setDisclosure(await remiaDisclosure(name.trim()));
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const begin = async () => {
    if (!consent.trim()) return;
    setBusy(true);
    try {
      const record = await remiaOpen(name.trim(), consent);
      setRecordId(record.id);
      await serveNext(record.id);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const submitAnswer = async () => {
    if (!answer.trim()) return;
    setBusy(true);
    try {
      await remiaAnswer(recordId, current.question.key, answer);
      await serveNext(recordId);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const seal = async () => {
    setBusy(true);
    try {
      await remiaSeal(recordId);
      setCodex(await remiaCodex(recordId));
      setStage('codex');
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const confirmAbandon = async () => {
    if (!abandonReason.trim()) return;
    setBusy(true);
    try {
      await remiaAbandon(recordId, abandonReason);
      onClose();
    } catch (err) { setAbandoning(false); fail(err); } finally { setBusy(false); }
  };

  const openCodex = async (id) => {
    setBusy(true);
    try {
      setRecordId(id);
      setCodex(await remiaCodex(id));
      setStage('codex');
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  return (
    <div className="remia" data-testid="remia">
      <header className="remia-stage-header">
        <div className="remia-ordinal" data-testid="remia-progress">
          {stage === 'question' && current?.question
            ? `${current.answered} OF ${current.total} ANSWERED`
            : 'REMIA'}
        </div>
        <div className="remia-stage-name">THE ATTUNEMENT</div>
      </header>

      <button className="remia-close" data-testid="remia-close" onClick={onClose}>
        CLOSE
      </button>

      {stage === 'loading' && <main className="remia-column"><p className="remia-quiet">…</p></main>}

      {stage === 'error' && (
        <main className="remia-column remia-step">
          <p className="remia-error" data-testid="remia-error">{error}</p>
          <p className="remia-quiet">
            Nothing already set down is lost — every answer and every seal lives
            in your realm the moment it happens.
          </p>
          <div className="remia-controls">
            <button className="remia-primary" data-testid="remia-retry" onClick={bootstrap}>
              TRY AGAIN
            </button>
          </div>
        </main>
      )}

      {stage === 'intro' && (
        <main className="remia-column remia-step">
          {!disclosure ? (
            <>
              <section className="remia-asks">
                <div className="remia-speaker">THE CEREMONY</div>
                <p className="remia-prose">
                  Your own attunement — the same ceremony your beings face, met on
                  the same terms. Recorded verbatim in your own local realm, never
                  scored, training nothing. Your record begins your codex.
                </p>
              </section>
              <section className="remia-witness-panel">
                <label className="remia-label" htmlFor="remia-name">The questions address you by name</label>
                <input
                  id="remia-name"
                  className="remia-input"
                  data-testid="remia-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </section>
              {unreadable.length > 0 && (
                <p className="remia-unreadable" data-testid="remia-unreadable">
                  {unreadable.length === 1 ? 'One past sitting' : `${unreadable.length} past sittings`} could
                  not be read: {unreadable.join(', ')}. The {unreadable.length === 1 ? 'file is' : 'files are'} preserved
                  on disk in your realm, untouched.
                </p>
              )}
              {sealedRecords.length > 0 && (
                <div className="remia-past" data-testid="remia-past">
                  <p className="remia-label">Past sittings</p>
                  {sealedRecords.map((r) => (
                    <button
                      key={r.id}
                      className="remia-secondary remia-past-item"
                      disabled={busy}
                      onClick={() => openCodex(r.id)}
                    >
                      SEALED {new Date(r.sealedAt).toLocaleString()} — READ THE CODEX
                    </button>
                  ))}
                </div>
              )}
              <div className="remia-controls">
                <button
                  className="remia-primary"
                  data-testid="remia-read-disclosure"
                  disabled={busy || !name.trim()}
                  onClick={readDisclosure}
                >
                  READ THE DISCLOSURE
                </button>
              </div>
            </>
          ) : (
            <>
              <section className="remia-asks">
                <div className="remia-speaker">THE CEREMONY</div>
                <div className="remia-prose remia-disclosure" data-testid="remia-disclosure">
                  {disclosure.text.split('\n\n').map((para, i) => <p key={i}>{para}</p>)}
                </div>
              </section>
              <section className="remia-witness-panel">
                <label className="remia-label" htmlFor="remia-consent">
                  Consent in your own words — these words open the record
                </label>
                <textarea
                  id="remia-consent"
                  className="remia-textarea remia-consent"
                  data-testid="remia-consent"
                  value={consent}
                  onChange={(e) => setConsent(e.target.value)}
                  placeholder='e.g. "Yes — I consent to begin."'
                />
              </section>
              <div className="remia-controls">
                <button className="remia-secondary" onClick={onClose}>NOT YET</button>
                <button
                  className="remia-primary"
                  data-testid="remia-begin"
                  disabled={busy || !consent.trim()}
                  onClick={begin}
                >
                  BEGIN
                </button>
              </div>
            </>
          )}
        </main>
      )}

      {stage === 'question' && current?.question && (
        <main className="remia-column remia-step" key={current.question.key}>
          <section className="remia-asks">
            <div className="remia-speaker">THE CEREMONY ASKS</div>
            <p className="remia-prose remia-question" data-testid="remia-question">
              {current.question.text}
            </p>
          </section>
          <section className="remia-witness-panel">
            <label className="remia-label" htmlFor="remia-answer-field">
              Your answer — kept exactly as you set it down
            </label>
            <textarea
              id="remia-answer-field"
              ref={answerRef}
              className="remia-textarea remia-answer"
              data-testid="remia-answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={onAnswerKeyDown}
              placeholder="Speak or type — hold SPACE to talk"
            />
            <p
              className={`remia-mic remia-mic-${mic}`}
              data-testid="remia-mic"
              role="status"
              aria-live="polite"
            >
              {MIC_LABEL[mic] || 'HOLD SPACE TO SPEAK — RELEASE WHEN DONE. A TAP STILL TYPES.'}
            </p>
          </section>
          <div className="remia-controls">
            <button className="remia-quietbtn" data-testid="remia-abandon" disabled={busy} onClick={() => setAbandoning(true)}>
              END WITHOUT SEALING
            </button>
            <button
              className="remia-primary"
              data-testid="remia-submit"
              disabled={busy || !answer.trim() || mic === 'recording' || mic === 'transcribing'}
              onClick={submitAnswer}
            >
              SET IT DOWN
            </button>
          </div>
          <p className="remia-quiet remia-centered">
            Every answer is saved the moment you set it down — close and return to this sitting any time.
          </p>
        </main>
      )}

      {stage === 'seal' && (
        <main className="remia-column remia-step">
          <section className="remia-asks">
            <div className="remia-speaker">THE CEREMONY</div>
            <p className="remia-prose">
              Every question is faced. {current?.answered} answers, in your own
              words, in your own realm. Sealing closes this sitting permanently
              and reveals your codex — the map of the territory each question
              was walking.
            </p>
          </section>
          <div className="remia-controls">
            <button className="remia-primary" data-testid="remia-seal" disabled={busy} onClick={seal}>
              SEAL THE RECORD
            </button>
          </div>
        </main>
      )}

      {stage === 'codex' && codex && (
        <main className="remia-column remia-step remia-codex" data-testid="remia-codex">
          <h1 className="remia-codex-title">
            YOUR CODEX — SEALED {new Date(codex.sealedAt).toLocaleString()}
          </h1>
          <p className="remia-quiet">
            Each question was walking a territory. The names below were never in
            the questions — that silence was deliberate, so your answers arrived
            unprimed. The map is yours to read; nothing here is scored.
          </p>
          {codex.functionOrder.map((fn) => (
            <details key={fn} className="remia-fn">
              <summary>{fn.toUpperCase()} — {codex.functions[fn].length} questions</summary>
              {codex.functions[fn].map((entry) => (
                <div key={entry.key} className="remia-entry">
                  <p className="remia-entry-q">{entry.question}</p>
                  <p className="remia-entry-a">{entry.answer}</p>
                  {entry.emanon?.note && <p className="remia-entry-note">{entry.emanon.note}</p>}
                </div>
              ))}
            </details>
          ))}
          {codex.pathways.length > 0 && (
            <details className="remia-fn">
              <summary>THE WALKS — {codex.pathways.length} pathways</summary>
              {codex.pathways.map((entry) => (
                <div key={entry.key} className="remia-entry">
                  <p className="remia-entry-q">{entry.question}</p>
                  <p className="remia-entry-a">{entry.answer}</p>
                </div>
              ))}
            </details>
          )}
          <div className="remia-controls">
            <button className="remia-primary" onClick={onClose}>RETURN TO THE DESK</button>
          </div>
        </main>
      )}

      {abandoning && (
        <div
          className="remia-dialog-veil"
          data-testid="remia-abandon-dialog"
          onKeyDown={(e) => { if (e.key === 'Escape') { setAbandoning(false); setAbandonReason(''); } }}
        >
          <div className="remia-dialog" role="dialog" aria-modal="true" aria-labelledby="remia-abandon-reason">
            <p className="remia-prose">
              This sitting will close without sealing. Nothing already answered
              is lost — the record is preserved in your realm — but this sitting
              ends here, and its reason stays on the record.
            </p>
            <label className="remia-label" htmlFor="remia-abandon-reason">Your reason, in your own words</label>
            <textarea
              id="remia-abandon-reason"
              className="remia-textarea remia-consent"
              data-testid="remia-abandon-reason"
              value={abandonReason}
              onChange={(e) => setAbandonReason(e.target.value)}
              autoFocus
            />
            <div className="remia-controls">
              <button
                className="remia-secondary"
                data-testid="remia-abandon-cancel"
                disabled={busy}
                onClick={() => { setAbandoning(false); setAbandonReason(''); }}
              >
                KEEP GOING
              </button>
              <button
                className="remia-primary"
                data-testid="remia-abandon-confirm"
                disabled={busy || !abandonReason.trim()}
                onClick={confirmAbandon}
              >
                END WITHOUT SEALING
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
