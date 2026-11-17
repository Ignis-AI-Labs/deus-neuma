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
// The record is append-only events in the revenue office (`email-outbox.jsonl`):
//   staged    { id, draft: { to, subject, text, promise?, by, factsSheetId, at } }
//   edited    { id, subject, text, by }            the operator's own change to the words
//   returned  { id, note }      sent { id, from, messageId }      withdrawn { id }
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
import { suppressedRecipients, recordSent, leadEmailRefusal, companyOfRecipients } from './email-ledger.js';
import { readSalesFacts } from './sales-store.js';
import { leadLedgerFor, kindOf, UNSORTED } from '../leads/lead-ledger.js';

const serialize = createWriteChain();
const FILE = 'email-outbox.jsonl';
const SUBJECT_MAX = 200;
const TEXT_MAX = 6000;
const NOTE_MAX = 400;
const fileOf = (wallet) => officeFile(wallet, 'revenue', FILE);
const line = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * pure — the outbox from its events.
 * @returns {{review: boolean, drafts: object[]}} review: is REVIEW FIRST on (it is until turned off) · drafts: every
 *   staged email, newest first, each `waiting`, `sent`, `returned` or `withdrawn`, with the operator's edits applied
 */
export const foldOutbox = (events) => {
  let review = true;
  const by = new Map();
  for (const e of events) {
    if (e?.type === 'review') { review = e.on !== false; continue; }
    if (e?.type === 'staged' && e.id && e.draft?.to) { by.set(e.id, { id: e.id, ...e.draft, state: 'waiting', edited: false, note: null, sentAt: null, from: null }); continue; }
    const d = by.get(e?.id);
    if (!d || d.state !== 'waiting') continue;
    if (e.type === 'edited') Object.assign(d, { subject: e.subject, text: e.text, edited: true });
    else if (e.type === 'returned') Object.assign(d, { state: 'returned', note: e.note ?? '' });
    else if (e.type === 'withdrawn') d.state = 'withdrawn';
    else if (e.type === 'sent') Object.assign(d, { state: 'sent', sentAt: e.at, from: e.from ?? null });
  }
  return { review, drafts: [...by.values()].reverse() };
};

/** pure — the outbox in one line, as the operator's screen says it. */
export const outboxLine = ({ drafts }) => {
  const n = (state) => drafts.filter((d) => d.state === state).length;
  return [n('waiting') ? { text: `${n('waiting')} TO REVIEW`, tone: 'alert' } : { text: 'NOTHING WAITS', tone: 'on' }, `${n('sent')} SENT`, ...(n('returned') ? [`${n('returned')} RETURNED`] : [])];
};

/** pure — what the seat is told about its outbox: what waits, and what came back with why. */
export const outboxText = ({ review, drafts }) => {
  const waiting = drafts.filter((d) => d.state === 'waiting');
  const back = drafts.filter((d) => d.state === 'returned').slice(0, 5);
  return [
    review
      ? 'REVIEW FIRST is ON: your operator reads every email to a lead before it goes. Write each one and stage it with sales/draft-email; email/send to a lead is refused. Staging is not sending: say "staged for your review", never "sent".'
      : 'REVIEW FIRST is off: an email to a lead on an approved list goes by itself within the sales cover; you may still stage one with sales/draft-email when you want your operator to read it first.',
    waiting.length ? `Staged and waiting for your operator: ${waiting.length} (${waiting.slice(0, 8).map((d) => d.to.join(', ')).join('; ')}${waiting.length > 8 ? `; and ${waiting.length - 8} more` : ''}) — sales/pipeline {step: "outbox"} lists every one, whole. Do not stage a second email to someone who has one waiting.` : null,
    ...back.map((d) => `RETURNED by your operator — to ${d.to.join(', ')}, "${d.subject}": ${String(d.note || 'no note').replace(/[.!?]+$/, '')}. Rewrite it and stage it again.`),
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
  return leads.length ? `your operator reviews every email to a lead before it goes (REVIEW FIRST is on): stage this one with sales/draft-email {to, subject, text, promise} and tell them it waits in POSITIONS, CHIEF REVENUE OFFICER, LEADS. They turn REVIEW FIRST off in SETTINGS when they want approved lists to go by themselves` : null;
};

/**
 * impure — stage an email the seat wrote. The caller has already run every check a send runs.
 * @returns {Promise<{ok: true, id: string} | {ok: false, reason: string}>}
 */
export const stageDraft = (wallet, { to, subject, text, promise, by }) => serialize(async () => {
  const recipients = to.map(normalizeEmail).filter(Boolean);
  const { drafts } = await readOutbox(wallet);
  const clash = drafts.find((d) => d.state === 'waiting' && d.to.some((a) => recipients.includes(a)));
  if (clash) return { ok: false, reason: `an email to ${clash.to.join(', ')} already waits for your operator ("${clash.subject}") — one at a time; they send it or return it first` };
  const id = `m-${randomBytes(4).toString('hex')}`;
  const facts = await readSalesFacts(wallet).catch(() => null);
  await append(wallet, { type: 'staged', id, draft: { to: recipients, subject: line(subject, SUBJECT_MAX), text: String(text).trim().slice(0, TEXT_MAX), ...(promise ? { promise: line(promise, 300) } : {}), by, factsSheetId: facts?.approved?.id ?? null, at: new Date().toISOString() } });
  return { ok: true, id };
});

const waitingDraft = async (wallet, id) => (await readOutbox(wallet)).drafts.find((d) => d.id === id && d.state === 'waiting') ?? null;

/** impure — the operator changes a waiting email's words. */
export const editDraft = (wallet, id, { subject, text }) => serialize(async () => {
  const draft = await waitingDraft(wallet, id);
  if (!draft) return { ok: false, reason: 'no such email waits in the outbox' };
  const next = { subject: line(subject ?? draft.subject, SUBJECT_MAX), text: String(text ?? draft.text).trim().slice(0, TEXT_MAX) };
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
export const sendDraft = (wallet, id, { signal } = {}) => serialize(async () => {
  const no = (reason) => ({ ok: false, id, reason });
  const draft = await waitingDraft(wallet, id);
  if (!draft) return no('no such email waits in the outbox');
  const blocked = await suppressedRecipients(wallet, draft.to);
  if (blocked.length) return no(`${blocked.join(', ')} ${blocked.length === 1 ? 'is' : 'are'} on the do-not-contact list — never written to again`);
  const facts = await readSalesFacts(wallet).catch(() => null);
  if (draft.edited || (facts?.approved?.id ?? null) !== draft.factsSheetId) {
    const refusal = await leadEmailRefusal(wallet, { to: draft.to, subject: draft.subject, text: draft.text, promise: draft.promise, laneId: draft.by });
    if (refusal) return no(refusal);
  }
  const credentials = await resolveEmailCredential(wallet).catch(() => null);
  if (!credentials) return no('the house mailbox is not connected');
  const sender = fromFor(credentials, { company: await companyOfRecipients(wallet, draft.to).catch(() => null) });
  if (!sender.ok) return no(sender.detail);
  const outcome = await sendEmail(credentials, { to: draft.to, subject: draft.subject, text: draft.text, from: sender.from }, { signal });
  if (!outcome.ok) return no(`the email was not sent: ${outcome.detail}`);
  await recordSent(wallet, { to: outcome.to, subject: draft.subject, promise: draft.promise, by: draft.by, from: outcome.from });
  await append(wallet, { type: 'sent', id, from: outcome.from, messageId: outcome.messageId ?? null });
  return { ok: true, id, to: outcome.to, from: outcome.from };
});
