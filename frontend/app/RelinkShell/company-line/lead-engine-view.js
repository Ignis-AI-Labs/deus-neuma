// lead-engine-view.js — the pure shaping behind the LEAD ENGINE section: each
// segment with its pool sorted strongest first, the words for every state and
// every upkeep item, and which presses the operator has on a segment.
// PURE.

export const MATCH_WORDS = Object.freeze({ 1: 'NO MATCH', 2: 'WEAK MATCH', 3: 'STRONG MATCH' });

export const STATE_WORDS = Object.freeze({
  draft: 'DRAFT — WAITS FOR YOUR APPROVAL',
  approved: 'APPROVED — ITS LEADS MAY BE CONTACTED',
  paused: 'PAUSED — NOTHING FOUND OR CONTACTED',
  retired: 'RETIRED',
});

export const UPKEEP_WORDS = Object.freeze({
  suppressed: 'ON THE DO-NOT-CONTACT LIST — CLOSE IT',
  answer: 'REPLIED — WAITING FOR AN ANSWER',
  'follow-up': 'NO REPLY — FOLLOW-UP DUE',
  'close-out': 'NO REPLY AFTER THREE EMAILS — CLOSE IT',
  duplicate: 'THE SAME PERSON AS ANOTHER LEAD',
  stale: 'UNTOUCHED FOR TWO WEEKS',
  unreachable: 'NO WAY TO REACH THEM',
});

export const SUPPRESS_REASONS = Object.freeze([
  { value: 'asked', label: 'Asked to be left alone' },
  { value: 'unsubscribed', label: 'Unsubscribed' },
  { value: 'bounced', label: 'Address bounced' },
  { value: 'customer', label: 'Already a customer' },
  { value: 'competitor', label: 'A competitor' },
  { value: 'other', label: 'Other' },
]);

/** What an approved list lets happen, in one line for the operator. */
export const LIST_WORDS = 'Approving the list lets the Mercator email these companies\' people without asking you each time: the first email and at most two follow-ups, three days apart, 20 a day. Replies still come to you.';

const meanFit = (p) => p.fit.reduce((n, s) => n + s.score, 0) / (p.fit.length || 1);

/**
 * The segments still in play, newest first, each with its pool (strongest
 * first) and its counts.
 * @param {{segments?: object[], prospects?: object[]}} engine
 */
export const segmentRows = (engine) => {
  const prospects = engine?.prospects ?? [];
  return [...(engine?.segments ?? [])].filter((s) => s.state !== 'retired').reverse().map((segment) => {
    const mine = prospects.filter((p) => p.segmentId === segment.id);
    const pool = mine.filter((p) => p.stage === 'found').sort((a, b) => b.match - a.match || meanFit(b) - meanFit(a));
    return {
      segment,
      pool,
      listable: segment.state === 'approved' ? pool.filter((p) => p.match >= 2 && !p.listApproved).length : 0,
      counts: { strong: pool.filter((p) => p.match === 3).length, weak: pool.filter((p) => p.match === 2).length, none: pool.filter((p) => p.match === 1).length, onLedger: mine.filter((p) => p.stage === 'promoted').length },
    };
  });
};

/** The operator's presses on a segment in this state, in order. */
export const segmentMoves = (state) => ({
  draft: [{ state: 'approved', label: 'APPROVE' }, { state: 'retired', label: 'RETIRE' }],
  approved: [{ state: 'paused', label: 'PAUSE' }, { state: 'retired', label: 'RETIRE' }],
  paused: [{ state: 'approved', label: 'APPROVE AGAIN' }, { state: 'retired', label: 'RETIRE' }],
}[state] ?? []);

/** Is this an email address or a company domain the list can hold? */
export const suppressTargetOk = (v) => /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(v).trim())
  || /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(String(v).trim());
