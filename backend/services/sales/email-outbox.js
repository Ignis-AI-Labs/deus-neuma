// THE OUTBOX — sales emails staged for the operator's review before anything leaves.
//
// Design note, 2026-11-16: […]
//
// The sales seat WRITES an email and STAGES it (sales/draft-email): it passes every check a send
// passes (do-not-contact, the approved facts, the first-email shape, the address check, the claims
// reader) and then waits here, unsent. The operator reads it in POSITIONS, CHIEF REVENUE OFFICER,
// LEADS, may change its words, and SENDS it (one, the checked ones, or all) or RETURNS it with what
// should change. A send from here is the same send as any other: the house mailbox, the lead
// marked contacted, the promise kept on its record.
//
// REVIEW FIRST is the setting, ON until the operator turns it off: while it is on, an email to a
// lead the house sells to goes ONLY through this outbox (email/send to such a lead is refused and
// the seat is told to stage it). Off, the earlier rule stands: an approved list's emails go by
// themselves within the sales cover, the rest ask on a card.
//
// THE SEAT REVISES ITS OWN (Design note, 2026-11-17: […]). Staging again to someone whose email waits, or came back,
// REPLACES that email in place — same id, checked again in full, waiting again — and the seat may withdraw one it
// staged. Nothing has to be returned by the operator first.
//
// The record is append-only events in the revenue office (`email-outbox.jsonl`):
//   staged    { id, draft: { to, subject, text, promise?, by, factsSheetId, at } }
//   revised   { id, draft: { …the same } }             the seat's new version of its waiting or returned email
//   edited    { id, subject, text, by }            the operator's own change to the words
//   returned  { id, note }      sent { id, from, messageId }      withdrawn { id, why?, by? }
//   uncertain { id, from, messageId }  DATA accepted, acknowledgement lost: never resent from here
//   review    { on }            the setting
// The fold is PURE; the reads, writes and the send are impure.

import { randomBytes } from 'node:crypto';
import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { resolveEmailCredential } from '../email/email-credentials.js';
import { sendEmail } from '../email/smtp-sender.js';
import { fromFor } from '../email/send-as.js';
import { normalizeEmail } from './suppress-shape.js';
import { suppressedRecipients, recordSent, leadEmailRefusal, addressRefusal, companyOfRecipients } from './email-ledger.js';
import { readSalesFacts } from './sales-store.js';
import { leadLedgerFor, kindOf, UNSORTED, personTouches } from '../leads/lead-ledger.js';
import { isOut, theyWroteLast } from './lead-upkeep.js';

const serialize = createWriteChain();
const FILE = 'email-outbox.jsonl';
const SUBJECT_MAX = 200;
const TEXT_MAX = 6000;
const NOTE_MAX = 400;
const fileOf = (wallet) => officeFile(wallet, 'revenue', FILE);
// The emails the seat may still change: one waiting for the operator, or one they returned.
const OPEN_STATES = Object.freeze(['waiting', 'returned']);
const line = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * pure — the outbox from its events.
 * @returns {{review: boolean, drafts: object[]}} review: is REVIEW FIRST on (it is until turned off) · drafts: every
 *   staged email, newest first, each `waiting`, `sent`, `returned` or `withdrawn`, with the seat's revisions and the
 *   operator's edits applied (revised: how many times the seat rewrote it)
 */
export const foldOutbox = (events) => {
  let review = true;
  const by = new Map();
  for (const e of events) {
    if (e?.type === 'review') { review = e.on !== false; continue; }
    if (e?.type === 'staged' && e.id && e.draft?.to) { by.set(e.id, { id: e.id, ...e.draft, state: 'waiting', edited: false, note: null, sentAt: null, from: null }); continue; }
    const d = by.get(e?.id);
    if (!d || !OPEN_STATES.includes(d.state)) continue;
    if (e.type === 'revised' && e.draft?.to) { Object.assign(d, { formula: null, ...e.draft, state: 'waiting', edited: false, note: null, revised: (d.revised ?? 0) + 1 }); continue; }
    if (e.type === 'withdrawn') { Object.assign(d, { state: 'withdrawn', why: e.why ?? null }); continue; }
    if (d.state !== 'waiting') continue;
    if (e.type === 'edited') Object.assign(d, { subject: e.subject, text: e.text, edited: true });
    else if (e.type === 'returned') Object.assign(d, { state: 'returned', note: e.note ?? '' });
    else if (e.type === 'sent') Object.assign(d, { state: 'sent', sentAt: e.at, from: e.from ?? null });
    else if (e.type === 'uncertain') Object.assign(d, { state: 'uncertain', sentAt: e.at, from: e.from ?? null });
  }
  return { review, drafts: [...by.values()].reverse() };
};

/** pure — the outbox in one line, as the operator's screen says it. */
export const outboxLine = ({ drafts }) => {
  const n = (state) => drafts.filter((d) => d.state === state).length;
  return [n('waiting') ? { text: `${n('waiting')} TO REVIEW`, tone: 'alert' } : { text: 'NOTHING WAITS', tone: 'on' }, `${n('sent')} SENT`, ...(n('uncertain') ? [`${n('uncertain')} MAYBE SENT`] : []), ...(n('returned') ? [`${n('returned')} RETURNED`] : [])];
};

/** pure — what the seat is told about its outbox: what waits, and what came back with why. */
export const outboxText = ({ review, drafts }) => {
  const waiting = drafts.filter((d) => d.state === 'waiting');
  const back = drafts.filter((d) => d.state === 'returned');
  const uncertain = drafts.filter((d) => d.state === 'uncertain');
  return [
    review
      ? 'REVIEW FIRST is ON: your operator reads every email to a lead before it goes. Write each one and stage it with sales/draft-email; email/send to a lead is refused. Staging is not sending: say "staged for your review", never "sent".'
      : 'REVIEW FIRST is off: an email to a lead on an approved list goes by itself within the sales cover; you may still stage one with sales/draft-email when you want your operator to read it first.',
    waiting.length ? `Staged and waiting for your operator: ${waiting.length} (${waiting.slice(0, 8).map((d) => d.to.join(', ')).join('; ')}${waiting.length > 8 ? `; and ${waiting.length - 8} more` : ''}) — sales/pipeline {step: "outbox"} lists every one, whole. To change one, stage it again: it REPLACES the waiting email in place (same id, checked again) — the operator never has to return it first. sales/withdraw-email takes one back.` : null,
    ...uncertain.slice(0, 5).map((d) => `MAYBE SENT [${d.id}] — to ${d.to.join(', ')}, "${d.subject}": the server accepted the message data but its acknowledgement was lost. Reconcile delivery before writing again; do not resend this draft.`),
    ...back.slice(0, 5).map((d) => `RETURNED by your operator [${d.id}] — to ${d.to.join(', ')}, "${d.subject}": ${String(d.note || 'no note').replace(/[.!?]+$/, '')}. Rewrite it and stage it again: it replaces this one.`),
    back.length > 5 ? `And ${back.length - 5} more returned — sales/pipeline {step: "outbox"} lists every one, whole.` : null,
  ].filter(Boolean).join('\n');
};

/** impure — one house's outbox. */
export const readOutbox = async (wallet) => foldOutbox((await readJsonLines(fileOf(wallet))).records);

const append = (wallet, event) => appendJsonLine(fileOf(wallet), { ...event, at: new Date().toISOString() });

/** impure — the operator turns REVIEW FIRST on or off. */
export const setReview = (wallet, on) => serialize(async () => { await append(wallet, { type: 'review', on: Boolean(on) }); return { ok: true, review: Boolean(on) }; });

/**
 * impure — while REVIEW FIRST is on: why an email may not be SENT directly to these people (one of them is a lead the
 * house sells to, or one nobody has sorted yet), or null.
 */
export const reviewRefusal = async (wallet, to) => {
  if (!(await readOutbox(wallet)).review) return null;
  const wanted = new Set(to.map(normalizeEmail).filter(Boolean));
  const leads = (await (await leadLedgerFor(wallet)).load()).filter((l) => wanted.has(normalizeEmail(l.contact)) && ['buyer', UNSORTED].includes(kindOf(l)));
  return leads.length ? `your operator reviews every email to a lead before it goes (REVIEW FIRST is on): stage this one with sales/draft-email {to, subject, text, promise} and tell them it waits in POSITIONS, CHIEF REVENUE OFFICER, EMAILS. They turn REVIEW FIRST off in SETTINGS when they want approved lists to go by themselves` : null;
};

// pure — why these words cannot be staged as they are (too long to be an email), or null. Never cut silently.
const sizeRefusal = (subject, text) => (String(subject).trim().length > SUBJECT_MAX ? `the subject is ${String(subject).trim().length} characters — keep it under ${SUBJECT_MAX}`
  : String(text).trim().length > TEXT_MAX ? `the email is ${String(text).trim().length} characters — an email to a lead is short; keep it under ${TEXT_MAX}` : null);

/**
 * impure — stage an email the seat wrote. The caller has already run every check a send runs. When an email to the same
 * person already waits for the operator, or came back from them — or `id` names one — this one REPLACES it in place:
 * the same id, waiting again (Design note, 2026-11-17: editing a staged email takes no extra steps).
 * @returns {Promise<{ok: true, id: string, revised: ?string} | {ok: false, reason: string}>} revised: the state the
 *   replaced email was in (waiting or returned), null for a new one
 */
export const stageDraft = (wallet, { to, subject, text, promise, by, id, followUp = false, formula = null }) => serialize(async () => {
  const recipients = to.map(normalizeEmail).filter(Boolean);
  const tooBig = sizeRefusal(subject, text);
  if (tooBig) return { ok: false, reason: tooBig };
  const open = (await readOutbox(wallet)).drafts.filter((d) => OPEN_STATES.includes(d.state));
  const named = id ? open.find((d) => d.id === id) : null;
  if (id && !named) return { ok: false, reason: `no email [${id}] waits in your outbox or came back from your operator — sales/pipeline {step: "outbox"} lists every one; leave out id to stage a new one` };
  const toSame = (d) => d.to.some((a) => recipients.includes(a));
  const target = named ?? open.find((d) => d.state === 'waiting' && toSame(d)) ?? open.find(toSame) ?? null;
  const clash = open.find((d) => d.state === 'waiting' && d !== target && toSame(d));
  if (clash) return { ok: false, reason: `an email to ${clash.to.join(', ')} already waits [${clash.id}] — stage this one with id "${clash.id}" to replace it` };
  const facts = await readSalesFacts(wallet).catch(() => null);
  const draft = { to: recipients, subject: line(subject, SUBJECT_MAX), text: String(text).trim(), ...(promise ? { promise: line(promise, 300) } : {}), ...(followUp ? { followUp: true } : {}), ...(formula ? { formula } : {}), by, factsSheetId: facts?.approved?.id ?? null, at: new Date().toISOString() };
  if (target) {
    await append(wallet, { type: 'revised', id: target.id, draft });
    return { ok: true, id: target.id, revised: target.state };
  }
  const fresh = `m-${randomBytes(4).toString('hex')}`;
  await append(wallet, { type: 'staged', id: fresh, draft });
  return { ok: true, id: fresh, revised: null };
});

/**
 * impure — the seat takes back an email it staged (waiting or returned): it never goes. With `to` instead of an id,
 * every open email to an address that `to` matches (the do-not-contact list withdraws what waits for its people).
 * @param {{id?: string, to?: (address: string) => boolean, why?: string, by?: string}} which
 * @returns {Promise<{ok: true, ids: string[]} | {ok: false, reason: string}>}
 */
export const withdrawDrafts = (wallet, { id, to, why, by }) => serialize(async () => {
  const open = (await readOutbox(wallet)).drafts.filter((d) => OPEN_STATES.includes(d.state));
  const hits = id ? open.filter((d) => d.id === id) : open.filter((d) => typeof to === 'function' && d.to.some(to));
  if (id && !hits.length) return { ok: false, reason: `no email [${id}] waits in your outbox or came back from your operator — sales/pipeline {step: "outbox"} lists every one` };
  for (const d of hits) await append(wallet, { type: 'withdrawn', id: d.id, ...(why ? { why: line(why, NOTE_MAX) } : {}), ...(by ? { by } : {}) });
  return { ok: true, ids: hits.map((d) => d.id) };
});

// AN EMAIL IS NEVER SENT TWICE BY ACCIDENT (Design note, 2026-11-18: […]). Someone already written to — an
// email the outbox sent them, or one the mailbox recorded on their lead — is written to again only by a follow-up
// staged as one (followUp), or by an answer to their own reply. A changed first email cannot be unsent.
/** pure — the outbox's sent emails to any of these addresses (another than `except`). */
export const sentTo = (drafts, recipients, except = null) => drafts.filter((d) => d.id !== except && (d.state === 'sent' || d.state === 'uncertain') && d.to.some((a) => recipients.includes(a)));

/**
 * impure — the last email already sent to any of these people, or null (nobody was written to, or they wrote last:
 * answering them is no second email).
 * @returns {Promise<?{at: string, subject: ?string, id: ?string}>}
 */
export const writtenAlready = async (wallet, recipients, except = null) => {
  const wanted = recipients.map(normalizeEmail).filter(Boolean);
  const leads = (await (await leadLedgerFor(wallet)).load()).filter((l) => wanted.includes(normalizeEmail(l.contact)));
  if (leads.some((l) => theyWroteLast({ ...l, touches: personTouches(l) }))) return null;
  const sent = sentTo((await readOutbox(wallet)).drafts, wanted, except).map((d) => ({ at: d.sentAt ?? d.at, subject: d.subject, id: d.id }));
  const touched = leads.flatMap((l) => personTouches(l).filter(isOut).map((t) => ({ at: t.at, subject: /"([^"]*)"/.exec(String(t.note ?? ''))?.[1] ?? null, id: null })));
  return [...sent, ...touched].sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1) ?? null;
};

const waitingDraft = async (wallet, id) => (await readOutbox(wallet)).drafts.find((d) => d.id === id && d.state === 'waiting') ?? null;

/** impure — the operator changes a waiting email's words. */
export const editDraft = (wallet, id, { subject, text }) => serialize(async () => {
  const draft = await waitingDraft(wallet, id);
  if (!draft) return { ok: false, reason: 'no such email waits in the outbox' };
  const tooBig = sizeRefusal(subject ?? draft.subject, text ?? draft.text);
  if (tooBig) return { ok: false, reason: tooBig };
  const next = { subject: line(subject ?? draft.subject, SUBJECT_MAX), text: String(text ?? draft.text).trim() };
  if (!next.subject || next.text.length < 20) return { ok: false, reason: 'an email needs a subject and its words' };
  await append(wallet, { type: 'edited', id, ...next, by: 'operator' });
  return { ok: true };
});

/** impure — the operator sends a waiting email back to the seat with what should change. */
export const returnDraft = (wallet, id, note) => serialize(async () => {
  if (!(await waitingDraft(wallet, id))) return { ok: false, reason: 'no such email waits in the outbox' };
  await append(wallet, { type: 'returned', id, note: line(note, NOTE_MAX) });
  return { ok: true };
});

/**
 * impure — the operator sends ONE waiting email. Checked again at the moment it goes: the do-not-contact list always;
 * the facts, the shape, the address and the claims in full when the operator changed its words or the approved facts
 * changed since it was staged (what the seat's staging already proved is not asked of the model twice).
 * @returns {Promise<{ok: true, id: string, to: string[], from: string} | {ok: false, id: string, reason: string}>}
 */
// acceptRisk: the OPERATOR sends a first email to an address no database confirmed live, knowing it may bounce (the
// outbox's SEND ANYWAY) — never the seat's.
export const sendDraft = (wallet, id, { signal, acceptRisk = false } = {}) => serialize(async () => {
  const no = (reason) => ({ ok: false, id, reason });
  const draft = await waitingDraft(wallet, id);
  if (!draft) return no('no such email waits in the outbox');
  if (!draft.followUp) {
    const before = await writtenAlready(wallet, draft.to, id);
    if (before) return no(`${draft.to.join(', ')} was already emailed on ${String(before.at).slice(0, 10)}${before.subject ? ` ("${before.subject}")` : ''} — this would be a second first email. Delete it, or have it rewritten and staged as a follow-up`);
  }
  const blocked = await suppressedRecipients(wallet, draft.to);
  if (blocked.length) return no(`${blocked.join(', ')} ${blocked.length === 1 ? 'is' : 'are'} on the do-not-contact list — never written to again`);
  const facts = await readSalesFacts(wallet).catch(() => null);
  // Every send checks its address again — staging's check may be hours old, and a first email goes only to an address
  // a database confirmed live (2026-11-19, a stored "verified" that hard-bounced). Its words are checked again only
  // when they or the facts changed.
  const refusal = draft.edited || (facts?.approved?.id ?? null) !== draft.factsSheetId
    ? await leadEmailRefusal(wallet, { to: draft.to, subject: draft.subject, text: draft.text, promise: draft.promise, laneId: draft.by, acceptRisk })
    : await addressRefusal(wallet, { to: draft.to, laneId: draft.by, acceptRisk });
  if (refusal) return no(refusal);
  const credentials = await resolveEmailCredential(wallet).catch(() => null);
  if (!credentials) return no('the house mailbox is not connected');
  // From the member who wrote it, when it has its own address on the mailbox (send-as.js), else its company's.
  const sender = fromFor(credentials, { company: await companyOfRecipients(wallet, draft.to).catch(() => null), member: draft.by });
  if (!sender.ok) return no(sender.detail);
  const outcome = await sendEmail(credentials, { to: draft.to, subject: draft.subject, text: draft.text, from: sender.from }, { signal });
  if (outcome.uncertain) {
    await recordSent(wallet, { to: outcome.to, subject: draft.subject, promise: draft.promise, by: draft.by, from: outcome.from, messageId: outcome.messageId, uncertain: true });
    await append(wallet, { type: 'uncertain', id, from: outcome.from, messageId: outcome.messageId ?? null });
    return { ok: false, id, uncertain: true, reason: `the email may have been sent: ${outcome.detail}. Reconcile delivery before writing again; this draft cannot be resent` };
  }
  if (!outcome.ok) return no(`the email was not sent: ${outcome.detail}`);
  await recordSent(wallet, { to: outcome.to, subject: draft.subject, promise: draft.promise, by: draft.by, from: outcome.from, messageId: outcome.messageId });
  await append(wallet, { type: 'sent', id, from: outcome.from, messageId: outcome.messageId ?? null });
  return { ok: true, id, to: outcome.to, from: outcome.from };
});
