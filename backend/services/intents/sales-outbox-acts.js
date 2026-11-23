/**
 * sales/draft-email — the sales seat stages an email for its operator's review (Design note, 2026-11-16:
 * […]).
 *
 * The seat writes the whole email. It is held to everything a send is held to, BEFORE it reaches
 * the operator: the mailbox is the house's, no secret rides in it, nobody on the do-not-contact
 * list, and to a lead only what the approved facts back, short, with one ask and its promise named,
 * to an address that exists. Then it waits in the outbox (sales/email-outbox.js), unsent. The
 * operator sends it, changes it, or returns it. Tier `allowed`: nothing leaves the house.
 *
 * The seat changes its own staged email by staging it again (Design note, 2026-11-17: […]): the
 * new version replaces the one waiting, or the one returned, in place. sales/withdraw-email takes one
 * back.
 */
import { officeContext } from './revenue-acts.js';
import { SEND_MAX_RECIPIENTS } from '../email/smtp-sender.js';
import { checkOutboundSecrets } from '../security/outbound-secrets.js';
import { suppressedRecipients, leadEmailRefusal } from '../sales/email-ledger.js';
import { stageDraft, withdrawDrafts, writtenAlready } from '../sales/email-outbox.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { normalizeEmail } from '../sales/suppress-shape.js';
import { readAddressChecks } from '../sales/sales-store.js';
import { addressNextStep } from './sales-hunter-acts.js';
import { formulaEmail, needsFormula } from '../sales/formula-gates.js';

// The fields sales/draft-email reads. Anything else is refused by name, never ignored (Design note, 2026-11-18: the seat
// filed a `campaign` field, nothing read it, and it took the silence for […]).
// hook, why, offer, askIndex, ask: THE FORMULA's parts for a first email to a lead (formula-gates.js, email-formula.js).
const DRAFT_FIELDS = new Set(['to', 'subject', 'text', 'promise', 'id', 'followUp', 'hook', 'why', 'offer', 'askIndex', 'ask']);

// impure — why this address may not be written to from the outbox: it must be a lead, so the email is tied to its
// lead (its campaign, its history, the checks a lead's email passes). A lead at the same company names the way.
const notALead = async (wallet, address) => {
  const leads = await (await leadLedgerFor(wallet)).load();
  const email = normalizeEmail(address);
  if (leads.some((l) => normalizeEmail(l.contact) === email)) return null;
  const domain = email?.split('@')[1] ?? '';
  const there = leads.find((l) => domain && normalizeEmail(l.contact)?.endsWith(`@${domain}`));
  return there
    ? `${email} is not on the lead list — the lead at ${domain} is [${there.id.slice(0, 8)}] ${there.name || there.contact} <${there.contact}>. Move that lead to this person first with sales/lead {lead: "${there.id.slice(0, 8)}", person: {name, role}, email: "${email}", emailSource}, then stage the email to them: it is then tied to the lead's campaign and history.`
    : `${email} is not on the lead list — an email from the outbox goes to a lead. File them first (sales/lead from a scored company, or sales/inbound for someone who wrote in), then stage it.`;
};

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const denied = (reason) => ({ ok: false, status: 'denied', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;

const salesDraftEmailIntent = Object.freeze({
  name: 'sales/draft-email',
  policyTool: 'sales.draft-email',
  fieldsForPrompt: '{to, subject, hook, why, offer, askIndex, ask, id?} for a FIRST email to a lead; {to, subject, text, promise, id?, followUp?} for any other',
  descriptionForPrompt: 'THE LEAD ENGINE. Stage an email to a lead for your operator to review. A FIRST EMAIL TO A LEAD IS BUILT FROM THE FORMULA, never written whole, and only past three gates: the address is CONFIRMED by a database (else sales/confirm-address, or another person), you RESEARCHED them (sales/research: who, what they do, what they are doing NOW, where, what they need, with sources), and they FIT this campaign (the fit in sales/research says yes); and the campaign\'s email plan is locked in by your operator (sales/email-plan). Then give: subject (why we are writing, 2-6 words: the platform puts the company\'s name in front and a capital on each major word, "Umbrae: Raising Our Seed Round"; a funding campaign\'s says we are raising), hook (one sentence on what THEY are doing now, from your research — it shows you know who they are), why (one sentence: why this campaign concerns them, now), offer (what we have for their need, in their terms, with one proof from the approved facts), askIndex (which of the campaign\'s asks) and ask (that ask, in your words for them, one question). The greeting and the campaign\'s sign-off are added for you, and the promise is the ask\'s. At most 120 words from hook to ask; no line another email of the campaign opened or offered with; never "a few ideas", "hope this finds you well", "I came across" or the like. Every person is different: write from what THEY need. ANY OTHER EMAIL (a reply, a follow-up): to, subject, text (the whole email, signed as the AI you are), promise. It is checked now exactly as a send is checked: the do-not-contact list, the approved facts (every claim and number must stand on one), the first-email shape, and that the address exists. A draft that fails is refused with the reason and nothing is staged: fix it and stage again. One that passes WAITS, unsent, in your operator\'s outbox (POSITIONS, CHIEF REVENUE OFFICER, EMAILS): they send it, change it, or return it with what should change. Say "staged for your review", never "sent". TO CHANGE ONE YOU STAGED, stage it again: when an email to that person already waits (or your operator returned it), the new version REPLACES it in place — same id, checked again — nothing has to be returned first; id names the one to replace when the address itself changes. sales/withdraw-email takes one back. NEVER THE SAME FIRST EMAIL TWICE: someone already emailed (the outbox sent them one, or the mailbox did) is refused unless this is a follow-up — write it as one (it adds something new, it does not repeat or rewrite the first; a sent email cannot be changed) and stage it with followUp: true. An answer to their own reply needs no flag.',
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return denied('the lead engine is the Mercator office\'s — only the seated Mercator stages an email to a lead');
    const unknown = Object.keys(payload ?? {}).filter((k) => !DRAFT_FIELDS.has(k) && !k.startsWith('_'));
    if (unknown.length) return invalid(`${unknown.join(', ')} ${unknown.length === 1 ? 'is not a field' : 'are not fields'} of sales/draft-email — it reads {to, subject, hook, why, offer, askIndex, ask, id} for a first email to a lead, {to, subject, text, promise, id, followUp} for any other. An email's campaign is its lead's: the lead's audience decides it, nothing in the email does.`);
    const to = Array.isArray(payload?.to) ? payload.to : (typeof payload?.to === 'string' ? [payload.to] : []);
    if (to.length === 0 || to.length > SEND_MAX_RECIPIENTS) return invalid('to is one address');
    if (typeof payload?.subject !== 'string' || !payload.subject.trim()) return invalid('a draft needs a subject');
    let blocked;
    try {
      blocked = await suppressedRecipients(context.wallet, to);
    } catch (err) {
      return denied(`the house's do-not-contact list or lead records could not be read (${err.message}) — nothing is staged until they can`);
    }
    if (blocked.length) return denied(`${blocked.join(', ')} ${blocked.length === 1 ? 'is' : 'are'} on the house's do-not-contact list — never written to again`);
    const stranger = await notALead(context.wallet, to[0]).catch(() => null);
    if (stranger) return invalid(stranger);
    // Never the same first email twice (Design note, 2026-11-18: someone already emailed hears again only by a follow-up.
    const followUp = payload?.followUp === true;
    if (!followUp) {
      const before = await writtenAlready(context.wallet, to, payload?.id ? String(payload.id).trim() : null).catch(() => null);
      if (before) return invalid(`${to.join(', ')} was already emailed on ${String(before.at).slice(0, 10)}${before.subject ? ` ("${before.subject}")` : ''}${before.id ? ` — sales/pipeline {step: "outbox", id: "${before.id}"} reads it whole` : ''}. A sent email cannot be changed, and a second first email is a mistake. If you mean to follow up, write it as a follow-up (something new, not the first again) and stage it with followUp: true.`);
    }
    // THE FORMULA (Design note, 2026-11-19: a first email to a lead passes the gates — confirmed, researched, a fit, its
    // campaign's plan locked in — and is built from its parts; any other email is written whole.
    const lead = (await (await leadLedgerFor(context.wallet)).load()).find((l) => normalizeEmail(l.contact) === normalizeEmail(to[0])) ?? null;
    let text = payload?.text;
    let promise = typeof payload?.promise === 'string' ? payload.promise : '';
    let subject = payload.subject; // a formula email's is the platform's: […]
    let formula = null;
    // A follow-up is one because an earlier email is on record: said of someone never written to, it is refused by name.
    if (followUp && lead && needsFormula(lead)) return invalid(`followUp: nothing was ever sent to ${to[0]} — this is a FIRST email, written from its campaign's plan: {to, subject, hook, why, offer, askIndex, ask}`);
    if (needsFormula(lead)) {
      const built = await formulaEmail(context.wallet, { lead, to: to[0], payload, by: context.laneId });
      if (built.refusal) return invalid(built.refusal);
      ({ subject, text, promise, formula } = built);
    } else if (typeof text !== 'string' || !text.trim()) return invalid('a draft needs {to, subject, text, promise} — the exact words that would leave under the house address');
    const secret = checkOutboundSecrets('the email', [...to, subject, text]);
    if (!secret.ok) return denied(secret.reason);
    let unchecked;
    try {
      unchecked = await leadEmailRefusal(context.wallet, { to, subject, text, promise, laneId: context.laneId });
    } catch (err) {
      return denied(`the house's do-not-contact list or lead records could not be read (${err.message}) — nothing is staged until they can`);
    }
    if (unchecked) return invalid(unchecked);
    return { ok: true, value: { context, to, subject, text, promise, formula, id: payload?.id ? String(payload.id).trim() : null, followUp } };
  },
  summarize: (payload) => `stage an email to ${Array.isArray(payload?.to) ? payload.to.join(', ') : String(payload?.to ?? '?')} for review: "${String(payload?.subject ?? '').slice(0, 100)}"`,
  execute: async ({ context, to, subject, text, promise, formula, id, followUp }) => {
    const staged = await stageDraft(context.wallet, { to, subject, text, promise, by: context.laneId, id, followUp, formula });
    if (!staged.ok) return { ok: false, reason: staged.reason };
    const done = staged.revised ? `Replaced [${staged.id}] in place (it was ${staged.revised === 'returned' ? 'returned by your operator' : 'waiting'}) with this version` : `Staged for your operator's review [${staged.id}]`;
    // What its address check said, and the one next step when no database confirmed it (address-confirm.js).
    const address = normalizeEmail(to[0]);
    const next = addressNextStep(address, (await readAddressChecks(context.wallet).catch(() => [])).find((c) => c.email === address));
    return { ok: true, detail: `${done}: to ${to.join(', ')}, "${subject}". It has NOT been sent. Tell them it waits in POSITIONS, CHIEF REVENUE OFFICER, EMAILS, in the outbox.${next}` };
  },
});

const salesWithdrawEmailIntent = Object.freeze({
  name: 'sales/withdraw-email',
  policyTool: 'sales.withdraw-email',
  fieldsForPrompt: '{id, why}',
  descriptionForPrompt: 'THE LEAD ENGINE. Take back an email you staged — one waiting for your operator, or one they returned — so it never goes: id from sales/pipeline {step: "outbox"}, why in a few words. To change an email, stage it again instead (sales/draft-email replaces it in place). Putting someone on the do-not-contact list withdraws what waits for them by itself.',
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return denied('the lead engine is the Mercator office\'s — only the seated Mercator withdraws a staged email');
    const id = String(payload?.id ?? '').trim();
    if (!id) return invalid('id: the staged email\'s id, from sales/pipeline {step: "outbox"}');
    return { ok: true, value: { context, id, why: String(payload?.why ?? '').trim() } };
  },
  summarize: (payload) => `withdraw staged email ${String(payload?.id ?? '?').slice(0, 40)}`,
  execute: async ({ context, id, why }) => {
    const out = await withdrawDrafts(context.wallet, { id, why, by: context.laneId });
    return out.ok ? { ok: true, detail: `Withdrawn [${id}]: it will not be sent${why ? ` (${why})` : ''}.` } : { ok: false, reason: out.reason };
  },
});

export const salesOutboxIntents = Object.freeze([salesDraftEmailIntent, salesWithdrawEmailIntent]);
