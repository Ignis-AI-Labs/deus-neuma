// compacted-composition.js — the context reading right after a compaction.
//
// A compaction rewrites the transcript, but the last measured reading sits on
// the last answer and still counts the conversation that was folded away. The
// gauge kept that stale number until the next turn measured again (and a reload
// replayed it). Here the reading after the fold is derived from that last
// recorded one: every section keeps its measured share, and only the
// RECENT CONVERSATION is re-counted over the rows that now stand. The same
// shape the turn builds (fold, tail budget, render), and chars are turned into
// tokens at the old transcript's own measured ratio.
//
// It is an estimate, so it is labelled one everywhere ('approx'): the gauge
// wears ≈ until the next turn measures. Nothing here invents a reading. With no
// recorded reading, or none that counted the conversation, there is nothing
// honest to derive and the answer is null.
//
// pure — rows and a recorded event in, a frozen event out; no IO.
import { foldBranchView, isViewMarker } from '../../core/workspace/branch-view.js';
import { recentConversationMessages, RECENT_ROWS } from '../../core/runtime/memory-section.js';
import { lastRecordedComposition } from '../../core/runtime/context-composition.js';
import { sessionTailBudgetFor } from './envelope-budget.js';

const TRANSCRIPT_ID = 'recentConversation';
const FALLBACK_CHARS_PER_TOKEN = 4;
const SUMMARY_PREFIX = /^\[SESSION SUMMARY[^\]]*\]\s*/;

/** pure — a compaction summary row's words, its bracketed tag removed. */
export const summaryWords = (row) => String(row?.content ?? '').replace(SUMMARY_PREFIX, '').trim();

/** pure — the latest compaction summary row in a session, or null. */
export const latestSummaryRow = (rows) => {
  const list = Array.isArray(rows) ? rows : [];
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i]?.compacted === true) return list[i];
  return null;
};

/** pure — the transcript text the next turn would carry, as the turn builds it. */
const transcriptChars = (rows, budgetChars, zone) => {
  const recent = foldBranchView(rows).filter((m) => !isViewMarker(m)).slice(-RECENT_ROWS);
  return recentConversationMessages(recent, budgetChars, zone)
    .map((m) => `${m.role}: ${m.content}`).join('\n\n').length;
};

/**
 * pure — the composition after a compaction, derived from the last recorded one.
 * @param {object|null} recorded - the last recorded context:composition event
 * @param {Array<object>} rows - the session's rows as they stand after the fold
 * @param {{zone?: string|null}} [opts]
 * @returns {Readonly<object>|null} an 'approx' event, or null when nothing honest can be said
 */
export const compositionAfterCompaction = (recorded, rows, { zone = null } = {}) => {
  const sections = Array.isArray(recorded?.sections) ? recorded.sections : [];
  const old = sections.find((s) => s?.id === TRANSCRIPT_ID);
  if (!old || !Number.isFinite(old.tokens) || !Number.isFinite(recorded?.usage?.inputTokens)) return null;
  const others = sections.filter((s) => s !== old);
  const otherTokens = others.reduce((sum, s) => sum + (Number.isFinite(s.tokens) ? s.tokens : 0), 0);
  const window = Number.isFinite(recorded.budget?.contextTokens) ? recorded.budget.contextTokens : null;
  const chars = transcriptChars(rows, sessionTailBudgetFor({ contextWindow: window, otherSectionTokens: otherTokens }), zone);
  const perChar = old.chars > 0 && old.tokens > 0 ? old.tokens / old.chars : 1 / FALLBACK_CHARS_PER_TOKEN;
  const tokens = Math.ceil(chars * perChar);
  // The standing input and the sections' sum can differ (the peak round is what
  // the sections split); the transcript's change carries over in proportion.
  const sectionSum = otherTokens + old.tokens;
  const scale = sectionSum > 0 ? recorded.usage.inputTokens / sectionSum : 1;
  const inputTokens = Math.max(0, Math.round(recorded.usage.inputTokens - (old.tokens - tokens) * scale));
  const compactionCount = latestSummaryRow(rows)?.compactionCount;
  return Object.freeze({
    type: 'context:composition',
    sections: Object.freeze(sections.map((s) => (s === old
      ? Object.freeze({ id: s.id, label: s.label, chars, tokens, tokenSource: 'approx' })
      : s))),
    budget: recorded.budget,
    toolResults: recorded.toolResults ?? [],
    totals: Object.freeze({ chars: others.reduce((sum, s) => sum + (s.chars || 0), 0) + chars, tokens: otherTokens + tokens, tokenSource: 'approx' }),
    // The last answer now rides inside the transcript, so nothing is counted twice as output.
    usage: Object.freeze({ inputTokens, outputTokens: 0, usedTokens: inputTokens, source: 'approx' }),
    ...(Number.isInteger(compactionCount) ? { session: Object.freeze({ compactionCount, atBoundary: false }) } : {}),
    afterCompaction: true,
  });
};

/**
 * pure — the reading a resume replays: the last recorded one, unless a
 * compaction came after it, in which case the post-compaction derivation.
 * @param {Array<object>} rows - session rows, oldest first
 * @param {{zone?: string|null}} [opts]
 * @returns {{composition: object, at: (string|null)}|null}
 */
export const replayableComposition = (rows, opts = {}) => {
  const recorded = lastRecordedComposition(rows);
  const summary = latestSummaryRow(rows);
  if (!recorded || !summary?.timestamp) return recorded;
  const folded = !recorded.at || Date.parse(summary.timestamp) > Date.parse(recorded.at);
  if (!folded) return recorded;
  const derived = compositionAfterCompaction(recorded.composition, rows, opts);
  return derived ? { composition: derived, at: summary.timestamp } : recorded;
};
