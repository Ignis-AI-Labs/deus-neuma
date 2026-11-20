// lead-engine-view.js — the pure shaping behind the LEAD ENGINE section: each
// segment with its pool sorted strongest first, the words for every state and
// every upkeep item, and which presses the operator has on a segment.
// PURE.

import { audiencePipeline } from '../../../../backend/services/sales/lead-pipeline.js';

export const MATCH_WORDS = Object.freeze({ 1: 'NO MATCH', 2: 'WEAK MATCH', 3: 'STRONG MATCH' });

export const STATE_WORDS = Object.freeze({
  draft: 'DRAFT — WAITS FOR YOUR APPROVAL',
  approved: 'APPROVED — ITS LEADS MAY BE CONTACTED',
  paused: 'PAUSED — NOTHING FOUND OR CONTACTED',
  retired: 'RETIRED',
});

export const UPKEEP_WORDS = Object.freeze({
  bounced: 'THE ADDRESS BOUNCED — FIND THE RIGHT ONE',
  suppressed: 'ON THE DO-NOT-CONTACT LIST — CLOSE IT',
  sort: 'NOT SORTED YET — SAY WHAT THEY ARE',
  answer: 'REPLIED — WAITING FOR AN ANSWER',
  'follow-up': 'NO REPLY — FOLLOW-UP DUE',
  'next-up': 'NO REPLY AFTER THREE EMAILS — WRITE TO THE NEXT PERSON AT THE COMPANY',
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
  const candidates = engine?.candidates ?? [];
  // THE PIPELINE (lead-pipeline.js, the same function the sales seat's briefing reads): where each company stands.
  const held = new Map((engine?.pulled ?? []).map((domain) => [domain, [{ domain }]]));
  return [...(engine?.segments ?? [])].filter((s) => s.state !== 'retired').reverse().map((segment) => {
    const mine = prospects.filter((p) => p.segmentId === segment.id);
    const pool = mine.filter((p) => p.stage === 'found').sort((a, b) => b.match - a.match || meanFit(b) - meanFit(a));
    const listableIds = segment.state === 'approved' ? mine.filter((p) => p.match >= 2 && p.stage !== 'dropped' && !p.listApproved).map((p) => p.id) : [];
    return {
      segment,
      pool,
      // every company gathered for this audience from a lead source, scored or not (AudienceCompanies.jsx)
      gathered: candidates.filter((c) => c.segmentId === segment.id),
      // the companies of this audience already on the lead list, each with the people read for it
      leads: mine.filter((p) => p.stage === 'promoted'),
      // What APPROVE THE LIST would cover — the server's own rule (prospect-shape.js listable), so this press and the
      // WAITING ON YOU row always count the same companies: a weak or strong match not dropped and not yet on an
      // approved list, whether still to judge or already on the lead list (2026-11-16: the rows counted leads the
      // press did not, so a row Founder could not act on never cleared).
      listableIds,
      listable: listableIds.length,
      counts: { strong: pool.filter((p) => p.match === 3).length, weak: pool.filter((p) => p.match === 2).length, none: pool.filter((p) => p.match === 1).length, onLedger: mine.filter((p) => p.stage === 'promoted').length },
      road: audiencePipeline({ segment, candidates: candidates.filter((c) => c.segmentId === segment.id), prospects: mine, leads: engine?.leads ?? [], searches: (engine?.searches ?? []).filter((x) => x.segmentId === segment.id), held, drafts: engine?.outbox?.drafts ?? [] }),
    };
  });
};

/** The road of an audience as the desk draws it: each step's count and words, and which step is next. Pure. */
export const roadSteps = ({ steps, next }) => {
  const n = (v) => Number(v).toLocaleString('en-US');
  return [
    { id: 'discover', label: 'GATHER', words: `${n(steps.discover.gathered)} FOUND · ${steps.discover.searches} SEARCH${steps.discover.searches === 1 ? '' : 'ES'}` },
    { id: 'filter', label: 'FILTER', words: `${n(steps.filter.kept)} SHORTLISTED · ${n(steps.filter.passed)} PASSED · ${n(steps.filter.unsorted)} TO FILTER` },
    { id: 'verify', label: 'VERIFY', words: `${n(steps.verify.alive)} ALIVE · ${n(steps.verify.dead)} DEAD · ${n(steps.verify.unread)} TO READ` },
    { id: 'score', label: 'SCORE', words: `${steps.score.strong} STRONG · ${steps.score.weak} WEAK · ${steps.score.none} NO FIT · ${n(steps.score.toScore)} TO SCORE` },
    { id: 'contacts', label: 'CONTACTS', words: `PEOPLE AT ${steps.contacts.withPeople} OF ${steps.contacts.fits} FITS` },
    { id: 'leads', label: 'LEADS', words: `${steps.leads.leads} ON THE LIST${steps.leads.toFile ? ` · ${steps.leads.toFile} TO FILE` : ''}` },
    { id: 'approve', label: 'APPROVE', words: steps.approve.waiting ? `${steps.approve.waiting} WAIT FOR YOU` : 'NOTHING WAITING', you: steps.approve.waiting > 0 },
    { id: 'outreach', label: 'OUTREACH', words: `${steps.outreach.written} SENT · ${steps.outreach.replied} REPLIED${steps.outreach.staged ? ` · ${steps.outreach.staged} FOR YOUR REVIEW` : ''}${steps.outreach.unwritten ? ` · ${steps.outreach.unwritten} TO WRITE` : ''}`, you: steps.outreach.staged > 0 },
  ].map((s) => ({ ...s, next: next?.id === s.id }));
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

/** How long an upkeep item has stood: a waiting reply in hours (it is answered the same day), the rest in days. pure. */
export const upkeepAge = (d) => {
  if (d.kind === 'answer' && Number.isFinite(d.hours)) return d.hours < 48 ? ` (${d.hours} H)` : ` (${d.days} DAYS)`;
  return d.days ? ` (${d.days} DAYS)` : '';
};
