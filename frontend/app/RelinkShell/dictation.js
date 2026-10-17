// dictation.js — pure decisions for hold-to-talk.
//
// The impure capture lives in use-push-to-talk.js; everything here is a pure
// function of its arguments so the gating and composing rules are provable
// with real inputs and real outputs.

import { autoRepair } from '../../../core/text/repair.js';

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// pure — is this element one the witness types into? Space must keep meaning
// "a space character" there, never push-to-talk.
export const isTypingTarget = (target) =>
  !!target && (EDITABLE_TAGS.has(target.tagName) || target.isContentEditable === true);

// pure — does the hold-to-talk lane OWN this Space event? Every Space the
// witness is not typing belongs to it: the first press, each auto-repeat while
// the key is held, and the release. Ownership is about suppressing the key's
// default — beginning a capture is a narrower question, below.
//
// MEASURED, Chromium (2026-08-01), after Founder: […]. A focused <button> is activated by Space on KEY-UP,
// and an un-prevented auto-repeat keydown RE-ARMS that activation even when
// the first keydown was prevented. Entering the sitting by clicking TALK
// leaves TALK focused — so holding Space (the whole gesture) re-armed it, and
// the release clicked it, closing the talk. A tap never showed it: probed at
// 0 repeats the click count is 0, at 3 repeats it is 1.
export const holdsPushToTalkKey = (event) =>
  !!event && event.code === 'Space' && !isTypingTarget(event.target);

// pure — should this keydown begin capture? First press of Space (held keys
// auto-repeat) anywhere the witness is not typing.
export const isPushToTalkPress = (event) =>
  holdsPushToTalkKey(event) && !event.repeat;

// Inside the composer field Space must stay a space for a tap, yet still
// offer push-to-talk for a hold — the witness speaks, pauses, then holds
// Space again to continue dictating into the same draft. A press held past
// this threshold is a hold; a release before it was a typed space. Key
// auto-repeat starts no sooner than ~250ms on common OS settings, so the
// first press has usually typed exactly one space by the time we decide.
export const HOLD_TO_TALK_MS = 300;

// pure — a hold-recognized Space already typed one space before the timer
// fired. Given the field's value and caret, return the value with that space
// removed and the corrected caret — or null when there is nothing to strip.
export const stripHoldSpace = (value, caret) =>
  caret > 0 && value[caret - 1] === ' '
    ? { value: value.slice(0, caret - 1) + value.slice(caret), caret: caret - 1 }
    : null;

// pure — join a finished transcript onto the draft with exactly one space,
// so successive utterances read as continuous prose.
//
// THE AUTO TIER lands here, at the one seam every dictated word crosses (the
// composer and Remia both arrive through this function). Only the LEXICON
// pass runs — the mis-heard domain words the operator provably did not mean,
// where a hit is by construction not a real word ("Anuma" → "a neuma"). Case,
// spacing, and filler are NOT touched: those restructure words the operator
// really said, and they wait for an explicit act. The composer must never
// silently rewrite the operator (Founder's call, 2026-07-31).
//
// The draft is repaired, never re-repaired: only the arriving transcript goes
// through autoRepair, so words the operator typed or already corrected by hand
// are left exactly as they stand.
export const appendTranscript = (draft, transcript) => {
  const text = autoRepair((transcript || '').trim());
  if (!text) return draft;
  return draft ? `${draft.replace(/\s+$/, '')} ${text}` : text;
};

// pure — dictation lands AT THE CARET, not at the end of the draft (Founder,
// 2026-08-28: […]). The operator's own whitespace —
// typed newlines above all — is never stripped; joins add at most one space
// per edge, and an edge that already carries whitespace (a newline, a space)
// gets nothing. [start, end) is the span being replaced: the caret (empty
// span) for fresh words, or the standing provisional span when a preview
// pass revises itself in place. Returns null when the transcript repairs to
// nothing. The same AUTO-TIER lexicon repair as appendTranscript runs here —
// the preview must read exactly as the entered text will.
export const spliceTranscript = (value, start, end, transcript) => {
  const text = autoRepair((transcript || '').trim());
  if (!text) return null;
  const draft = String(value ?? '');
  const from = Math.max(0, Math.min(start ?? draft.length, draft.length));
  const to = Math.max(from, Math.min(end ?? from, draft.length));
  const before = draft.slice(0, from);
  const after = draft.slice(to);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const spanStart = from + lead.length;
  return {
    value: before + lead + text + trail + after,
    // The span is the TEXT alone — the caret rides its end, and a revising
    // pass replaces exactly these bounds, never the joins around them.
    start: spanStart,
    end: spanStart + text.length,
    text,
  };
};
