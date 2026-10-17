// AskChip — a being's question to its operator, inline where it was asked.
//
// SEQUENCED (Design note, 2026-07-27. A protocol that must settle five parameters
// before it starts asks five questions, and this walks them ONE AT A TIME:
// the question, its own numbered choices, and a line for the operator's own
// words. Before this the whole set arrived as a single blob with every
// option from every question in one flat row, so no tap could answer
// anything and the only real path was writing a paragraph.
//
// Answering is keyboard-first, the way it is in a terminal: 1-9 picks a
// choice, Enter sends what is typed, Backspace on an empty line steps back.
// Nothing reaches the being until the last question is answered, so a wrong
// turn early costs nothing. The card flips only when the portal echoes
// operator:ask_resolved (server truth), matching ApprovalChip.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import '../../components/ToolActionChip/ToolActionChip.css';

const UNANSWERED_LABELS = Object.freeze({
  timeout: 'NOT ANSWERED — TIMED OUT',
  interrupted: 'NOT ANSWERED — TURN INTERRUPTED',
  closed: 'NOT ANSWERED — PORTAL CLOSED',
  expired: 'NOT ANSWERED',
});

// Lift whatever shape arrived into the one the card renders. A frame from an
// older backend carries only {question, options: string[]}.
const questionsOf = (segment) => {
  if (segment.questions?.length) return segment.questions;
  return [{
    question: segment.question,
    header: '',
    multiSelect: false,
    options: (segment.options || []).map((o) => (typeof o === 'string' ? { label: o, description: '' } : o)),
  }];
};

export const AskChip = ({ segment, onRespond }) => {
  const { id, phase, status, answer, question } = segment;
  const questions = useMemo(() => questionsOf(segment), [segment]);

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(() => questions.map(() => ''));
  const [picked, setPicked] = useState(() => questions.map(() => []));
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const inputRef = useRef(null);

  const current = questions[step];
  const last = step === questions.length - 1;

  // The line takes focus as each question arrives, so answering never needs
  // the mouse — including on the very first question of a five-part set.
  useEffect(() => { inputRef.current?.focus(); }, [step]);

  const send = useCallback((finalAnswers) => {
    if (sent) return;
    setSent(true);
    uiSound('activate');
    onRespond(id, finalAnswers.find((a) => a) || '', finalAnswers);
  }, [id, onRespond, sent]);

  // Record this question's reply and move on — or send, if it was the last.
  const advance = useCallback((reply) => {
    const next = answers.map((a, i) => (i === step ? reply : a));
    setAnswers(next);
    setText('');
    if (last) send(next);
    else { uiSound('confirm'); setStep(step + 1); }
  }, [answers, last, send, step]);

  const choose = useCallback((option) => {
    if (sent) return;
    if (!current.multiSelect) { advance(option.label); return; }
    // multiSelect gathers until the operator confirms the set.
    setPicked(picked.map((p, i) => (i === step
      ? (p.includes(option.label) ? p.filter((l) => l !== option.label) : [...p, option.label])
      : p)));
  }, [advance, current, picked, sent, step]);

  // Stepping back must leave the LINE EMPTY. Restoring the previous answer
  // into it looked helpful and broke the card: the digit keys only fire on an
  // empty line (so typing […] is never hijacked), so a restored
  // answer made 1-9 type instead of choose, and the sequence stuck where it
  // stood. What was said before is shown beneath the question instead, and
  // kept if the operator simply moves on. Found end-to-end, 2026-07-27.
  const back = useCallback(() => {
    if (sent || step === 0) return;
    uiSound('confirm');
    setStep(step - 1);
    setText('');
  }, [sent, step]);

  const onKeyDown = useCallback((e) => {
    if (sent) return;
    // A digit picks a choice — but only while the line is EMPTY, so typing
    // […] as an answer is never hijacked into a selection.
    if (!text && /^[1-9]$/.test(e.key)) {
      const option = current.options[Number(e.key) - 1];
      if (option) { e.preventDefault(); choose(option); }
      return;
    }
    if (e.key === 'Backspace' && !text && step > 0) { e.preventDefault(); back(); }
  }, [back, choose, current, sent, step, text]);

  const submitLine = useCallback((e) => {
    e.preventDefault();
    if (sent) return;
    const trimmed = text.trim();
    // Typed words always win over a pending multi-selection: the operator
    // wrote something, and dropping it for a chip they tapped earlier would
    // discard the more specific answer.
    if (trimmed) { advance(trimmed); return; }
    if (current.multiSelect && picked[step].length) { advance(picked[step].join(', ')); return; }
    // Nothing new said on a question already answered — keep what stands and
    // move on, so stepping back to look is never a trap.
    if (answers[step]) advance(answers[step]);
  }, [advance, answers, current, picked, sent, step, text]);

  if (phase === 'pending') {
    const many = questions.length > 1;
    const chosen = picked[step];
    return (
      <div className="tool-chip ask-chip pending">
        <div className="tool-chip-head">
          <span className="tool-chip-tag">ASKS YOU</span>
          {current.header ? <span className="ask-chip-header">{current.header}</span> : null}
          {many ? <span className="ask-chip-progress">{step + 1} of {questions.length}</span> : null}
        </div>

        <p className="ask-chip-question">{current.question}</p>
        {answers[step] ? (
          <p className="ask-chip-standing">You said: {answers[step]}</p>
        ) : null}

        {current.options.length > 0 ? (
          <ol className="ask-chip-options">
            {current.options.map((o, i) => (
              <li key={`${o.label}-${i}`}>
                <button
                  type="button"
                  disabled={sent}
                  aria-pressed={current.multiSelect ? chosen.includes(o.label) : undefined}
                  className={current.multiSelect && chosen.includes(o.label) ? 'chosen' : ''}
                  onClick={() => choose(o)}
                >
                  <span className="ask-chip-num">{i + 1}</span>
                  <span className="ask-chip-label">
                    {o.label}
                    {/* First is the being's recommendation, by contract. Saying
                        so is the difference between four equal-looking choices
                        and a guided one. */}
                    {i === 0 ? <span className="ask-chip-rec">RECOMMENDED</span> : null}
                  </span>
                  {o.description ? <span className="ask-chip-desc">{o.description}</span> : null}
                </button>
              </li>
            ))}
          </ol>
        ) : null}

        <form className="ask-chip-free" onSubmit={submitLine}>
          <input
            ref={inputRef}
            type="text"
            value={text}
            disabled={sent}
            placeholder={current.options.length
              ? 'Or answer in your own words…'
              : 'Answer in your own words…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="submit"
            disabled={sent || (!text.trim() && !answers[step] && !(current.multiSelect && chosen.length))}
          >
            {last ? 'ANSWER' : 'NEXT'}
          </button>
        </form>

        <p className="ask-chip-hint">
          {current.options.length ? 'Press 1–9 to choose, or type your own answer. ' : ''}
          {step > 0 ? 'Backspace on an empty line goes back. ' : ''}
          {answers[step] ? 'Press next to keep your answer.' : ''}
        </p>
      </div>
    );
  }

  const answered = status === 'answered';
  return (
    <div className={`tool-chip resolved ask-chip ${answered ? 'ok' : 'failed'}`}>
      <div className="tool-chip-head">
        <span className="tool-chip-sigil">⟐</span>
        <span className="tool-chip-summary">
          {answered
            ? `ANSWERED: ${answer}`
            : `${UNANSWERED_LABELS[status] || 'SETTLED'} — "${questions[0]?.question || question}"`}
        </span>
      </div>
    </div>
  );
};
