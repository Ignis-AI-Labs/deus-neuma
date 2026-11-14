// THE SALES COVER — Founder's ruling D5 (2026-11-13): the operator approves an
// audience's pitch and its list once, then the sequence runs inside its
// limits. An email/send whose every recipient is a lead from an approved list
// of an approved audience goes without a card, but only:
//   - from the seated Mercator;
//   - as part of the sequence: the first email, then at most two follow-ups,
//     each at least FOLLOW_UP_DAYS after the last;
//   - never to a lead who wrote last — an answer to a person waits for the
//     operator, as ruled;
//   - within the day's cap on emails to leads, across the whole ledger — a
//     new sending address ramps up to it over three weeks (rampCap).
// Anything else asks, exactly as before. The do-not-contact list is judged
// earlier, at validate, and refuses outright.
// The judgement is PURE; salesSendAccess reads the house and never throws —
// anything it cannot read asks.

import { croDesignation } from '../revenue/cro-designation.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { readSegments, readProspects, readSenders } from './sales-store.js';
import { resolveEmailCredential } from '../email/email-credentials.js';
import { normalizeEmail } from './suppress-shape.js';
import { isOut, theyWroteLast, FOLLOW_UP_DAYS, MAX_TOUCHES } from './lead-upkeep.js';
import { createLogger } from '../logger.js';

export const DAILY_CAP = 20;
const DAY_MS = 86_400_000;
// A new sending address earns its volume: 5 a day in its first week, 10 in
// its second, 15 in its third, the full cap from day 21 (lead-engine-plan.md
// §3 step 10). Counted from the first day it wrote to a lead.
const RAMP = Object.freeze([[7, 5], [14, 10], [21, 15]]);

/** The day's cap for an address that first wrote to a lead at `firstAt` (null = never yet). pure. */
export const rampCap = (firstAt, now) => {
  const days = firstAt ? Math.floor((now - Date.parse(firstAt)) / DAY_MS) : 0;
  return (RAMP.find(([under]) => days < under) ?? [0, DAILY_CAP])[1];
};
const log = createLogger('Sales.Cover');

/**
 * Does the cover answer this send? pure.
 * @param {{recipients: string[], leads: object[], prospects: object[], segments: object[], now: number, cap?: number}} state
 * @returns {{covered: true} | {covered: false, reason: string}}
 */
export const judgeCover = ({ recipients, leads, prospects, segments, now, cap = DAILY_CAP }) => {
  const approved = new Set(segments.filter((s) => s.state === 'approved').map((s) => s.id));
  const day = new Date(now).toISOString().slice(0, 10);
  const sentToday = leads.flatMap((l) => l.touches || []).filter((t) => isOut(t) && String(t.at).slice(0, 10) === day).length;
  if (sentToday + recipients.length > cap) return { covered: false, reason: `the day's cap of ${cap} emails to leads is reached` };
  for (const address of recipients.map(normalizeEmail)) {
    const lead = leads.find((l) => normalizeEmail(l.contact) === address);
    if (!lead) return { covered: false, reason: `${address || 'a recipient'} is not a lead` };
    const prospect = prospects.find((p) => p.leadId === lead.id);
    if (!prospect?.listApproved || !approved.has(prospect.segmentId)) return { covered: false, reason: `${address} is not on an approved list` };
    if (theyWroteLast(lead)) return { covered: false, reason: `${address} wrote last — an answer waits for the operator` };
    const outs = (lead.touches || []).filter(isOut);
    if (outs.length >= MAX_TOUCHES) return { covered: false, reason: `${address} has had the first email and its follow-ups` };
    const last = outs.at(-1);
    if (last && now - Date.parse(last.at) < FOLLOW_UP_DAYS * DAY_MS) return { covered: false, reason: `${address} was written to less than ${FOLLOW_UP_DAYS} days ago` };
  }
  return { covered: true };
};

/**
 * The intent sweep's question for an email/send that would ask: does the sales
 * cover answer it? Returns 'allowed' when covered, else the access unchanged.
 * impure; never throws.
 */
export const salesSendAccess = async (connection, access, policyTool, value) => {
  if (access !== 'approval_required' || policyTool !== 'email.send') return access;
  try {
    const wallet = connection.walletAddress;
    const laneId = connection.companion?.neumaId;
    if (!wallet || !laneId || (await croDesignation.getOfficer(wallet))?.laneId !== laneId) return access;
    const recipients = Array.isArray(value?.to) ? value.to : [value?.to];
    const [leads, prospects, segments, senders, credentials] = await Promise.all([
      leadLedgerFor(wallet).then((l) => l.load()), readProspects(wallet), readSegments(wallet), readSenders(wallet), resolveEmailCredential(wallet),
    ]);
    const now = Date.now();
    const cap = rampCap(senders[String(credentials?.address ?? '').trim().toLowerCase()] ?? null, now);
    const verdict = judgeCover({ recipients, leads, prospects, segments, now, cap });
    if (!verdict.covered) return access;
    log.info('An email to an approved list went under the sales cover', { laneId, recipients: recipients.length });
    return 'allowed';
  } catch (err) {
    log.warn('A send could not be judged against the sales cover — it asks', { err: err.message });
    return access;
  }
};
