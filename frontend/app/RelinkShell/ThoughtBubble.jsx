// ThoughtBubble — a being's reasoning, watchable without being spoken.
//
// Design note, 2026-07-30: […]
//
// So it is NOT speech and never renders as speech. It sits in the turn at the
// place the thought actually happened — the same way a tool chip does — folded
// shut, carrying its own weight in characters so the operator can see there was
// thinking at all without reading it. Open it and the reasoning is there,
// formatted the same way speech is (Markdown when settled, LiveSpeech while
// the tokens are still arriving). The words stay verbatim; only the markup
// is honored.
//
// It renders ONLY where a lane really opens a reasoning channel: Kimi's
// thinking_delta, GLM's and Grok's reasoning_content, a local thinking
// template's markers. Lanes that publish no reasoning simply never produce
// this segment — there is nothing to fold shut, and no empty bubble is drawn.


import { useState } from 'react';
import { Markdown } from './Markdown.jsx';
import { LiveSpeech } from './LiveSpeech.jsx';
import { approxTokens, approxTokensFromChars } from '../../../core/continuity/layers/record-util.js';
import { useLazyDetail } from './use-lazy-detail.js';


/** A thought's size in the operator's terms — TOKENS, the currency context is
 *  actually spent in (Design note, 2026-08-28: […]). An estimate (chars/4, the core's display convention),
 *  and marked as one — a `~` figure never claims the tokenizer's truth. */
const weigh = (text, chars = null) => {
  const tok = Number.isFinite(chars) ? approxTokensFromChars(chars) : approxTokens(text);
  return tok >= 1000 ? `~${(tok / 1000).toFixed(1)}K TOK` : `~${tok} TOK`;
};

/** The opened reasoning — Markdown when settled, LiveSpeech while arriving. */
export const ThoughtBody = ({ text, live = false }) => (
  <div className="relink-thought-body">
    {live ? <LiveSpeech shown={text} /> : <Markdown text={text} />}
  </div>
);

export const ThoughtBubble = ({ segment, live = false }) => {
  const [open, setOpen] = useState(false);
  // A history thought the display view left at the server is read when opened.
  const lazy = useLazyDetail(segment?.text ? null : segment?.ref ?? null, open);
  const text = segment?.text || lazy.value || '';
  if (!text && !segment?.ref) return null;

  return (
    <div className={`relink-thought${open ? ' is-open' : ''}${live ? ' is-live' : ''}`}>
      <button
        type="button"
        className="relink-thought-head label-data"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={open
          ? 'Fold this thinking away — it was never part of the answer'
          : 'Read what it thought before it spoke. Watching changes nothing it said.'}
      >
        <span className="relink-thought-mark" aria-hidden="true">◇</span>
        <span className="relink-thought-label">{live ? 'THINKING…' : 'THOUGHT'}</span>
        <span className="relink-thought-weight">{weigh(text, segment?.text ? null : segment?.chars)}</span>
      </button>
      {open && text ? <ThoughtBody text={text} live={live} /> : null}
      {open && !text ? <p className="relink-thought-body label-data">{lazy.state === 'failed' ? 'COULD NOT READ THIS THOUGHT — CLOSE AND OPEN TO TRY AGAIN.' : lazy.state === 'missing' ? 'THE RECORD NO LONGER HOLDS THIS THOUGHT.' : 'READING…'}</p> : null}
    </div>
  );
};

