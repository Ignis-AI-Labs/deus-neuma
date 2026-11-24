/**
 * sales/mail-scan, sales/inbound and sales/kind — the leads that came to the
 * house on their own, and what each one is (Design note, 2026-11-16: […]):
 *   sales/mail-scan  read the mailbox's envelopes and name every sender who is
 *                    on no list (not a lead, not do-not-contact, not a machine,
 *                    not the house). Read-only; never a body.
 *   sales/inbound    put one of those senders on the lead list under the kind
 *                    they are. Only an address that really wrote to the house.
 *   sales/kind       re-file a lead already on the list under another kind.
 *
 * The seated Mercator's alone, and the scan also needs the mailbox to be the
 * seat's to hold. Tier `allowed`: a read of the house's own mailbox and a
 * record in its own office; the reply itself rides email/send, gated as ever.
 */
import { officeContext } from './revenue-acts.js';
import { emailBinding, canNeumaUseEmail } from '../email/email-binding.js';
import { scanMailbox, scanText, SCAN_DEFAULT } from '../sales/mail-scan.js';
import { SCAN_MAX_MESSAGES } from '../email/imap-reader.js';
import { normalizeEmail, suppressionMatcher } from '../sales/suppress-shape.js';
import { readSuppressions } from '../sales/sales-store.js';
import { leadLedgerFor, LEAD_KINDS, kindOf } from '../leads/lead-ledger.js';

const officerRefusal = { ok: false, status: 'denied', reason: 'the lead engine is the Mercator office\'s — only the seated Mercator files to it (house/post reaches them; the operator seats the office)' };
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;
const holdsMailbox = async (context) => canNeumaUseEmail(await emailBinding.load(context.wallet).catch(() => ({})), context.laneId);
const availableFor = async ({ connection }) => ((await seated(connection)) ? {} : null);
const KIND_WORDS = 'buyer (may pay the house), applicant (wants to work for it), partner (wants to build with it), investor (may fund it), press (writes about it), vendor (sells to it), other';

const mailScanIntent = Object.freeze({
  name: 'sales/mail-scan',
  policyTool: 'sales.mail-scan',
  fieldsForPrompt: `{messages?: number (how far back, up to ${SCAN_MAX_MESSAGES}; ${SCAN_DEFAULT} when left out)}`,
  descriptionForPrompt: 'THE LEAD ENGINE. Scan the house mailbox for people who wrote in and are on no list: not on the lead list, not on the do-not-contact list, not a machine, not the house itself. It reads who wrote, the subject and the date, never a body. Then read each one\'s message with read_email and file the real ones with sales/inbound under the kind they are. Run it when your operator asks, and after any long quiet stretch.',
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    if (!(await holdsMailbox(context))) return { ok: false, status: 'denied', reason: 'the mailbox is not yours to hold — the operator gives it to the member who holds this seat in POSITIONS, CHIEF REVENUE OFFICER, MAILBOX' };
    const n = payload?.messages === undefined ? SCAN_DEFAULT : Number(payload.messages);
    if (!Number.isInteger(n) || n < 1 || n > SCAN_MAX_MESSAGES) return invalid(`messages: a whole number, 1 to ${SCAN_MAX_MESSAGES}`);
    return { ok: true, value: { context, limit: n } };
  },
  summarize: (payload) => `scan the mailbox for missed leads (${payload?.messages ?? SCAN_DEFAULT} messages)`,
  execute: async ({ context, limit }, { signal } = {}) => {
    const scan = await scanMailbox(context.wallet, { limit, signal });
    return scan.ok ? { ok: true, detail: scanText(scan) } : { ok: false, reason: `The mailbox could not be scanned: ${scan.detail}.` };
  },
});

const inboundIntent = Object.freeze({
  name: 'sales/inbound',
  policyTool: 'sales.inbound',
  fieldsForPrompt: `{email, name, kind: ${LEAD_KINDS.map((k) => `"${k}"`).join(' | ')}, about, uid?}`,
  descriptionForPrompt: `THE LEAD ENGINE. Put someone who wrote to the house onto the lead list, filed under what they are: ${KIND_WORDS}. email: the address they wrote from (it must be a sender the mailbox scan can see). name: who they are, as their message says. about: one line on what they want, in their own terms. uid: the message you read. They are marked as having written last, so the list shows them as owed an answer. Only a buyer is worked with the sales pitch and its checks; anyone else is answered plainly.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const email = normalizeEmail(payload?.email);
    if (!email) return invalid('email: the address they wrote from');
    const name = String(payload?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (name.length < 2) return invalid('name: who they are, as their message says');
    if (!LEAD_KINDS.includes(payload?.kind)) return invalid(`kind: what they are to the house — ${KIND_WORDS}`);
    const about = String(payload?.about ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (about.length < 5) return invalid('about: one line on what they want');
    if (suppressionMatcher(await readSuppressions(context.wallet)).email(email)) return invalid(`${email} is on the do-not-contact list`);
    const ledger = await leadLedgerFor(context.wallet);
    const held = (await ledger.load()).find((l) => normalizeEmail(l.contact) === email);
    if (held) return invalid(`${email} is already on the lead list as "${held.name}" (${kindOf(held)}) — re-file them with sales/kind if they are something else`);
    return { ok: true, value: { context, ledger, email, name, kind: payload.kind, about, uid: Number(payload?.uid) || null } };
  },
  summarize: (payload) => `file ${payload?.email ?? '?'} as ${payload?.kind ?? '?'}`,
  execute: async ({ context, ledger, email, name, kind, about, uid }, { signal } = {}) => {
    // Never a guessed address: the real mailbox is read only after policy admits the filing.
    const scan = await scanMailbox(context.wallet, { limit: SCAN_MAX_MESSAGES, signal });
    if (!scan.ok) return { ok: false, reason: `the mailbox could not be read to confirm they wrote: ${scan.detail}` };
    const sender = scan.missed.find((s) => s.email === email);
    if (!sender) return { ok: false, reason: `${email} is not a sender the mailbox shows — only someone who wrote to the house is filed here (a company you found yourself goes through sales/prospect and sales/lead)` };
    const message = sender.messages.find((m) => m.uid === uid) ?? sender.messages[0];
    const lead = await ledger.add({
      name, contact: email, channelId: 'email', kind, status: 'replied', direction: 'in',
      source: `mailbox: they wrote first · uid ${message.uid} "${message.subject}"`,
      ownerNeumaId: context.laneId, addedBy: context.laneId, note: about,
    });
    return { ok: true, detail: `Lead [${lead.id.slice(0, 8)}] ${name} <${email}> is on the lead list as ${kind}, owed an answer. ${kind === 'buyer' ? 'Answer with email/send; it is checked against the approved facts.' : 'Answer plainly with email/send; your operator approves it.'}` };
  },
});

const SORT_MAX = 40;
// pure — one filing of sales/kind as its list: {id, kind, why} alone, or leads: [{id, kind, why}, …].
const sortList = (payload) => (Array.isArray(payload?.leads) ? payload.leads.slice(0, SORT_MAX) : [{ id: payload?.id, kind: payload?.kind, why: payload?.why }]);

const kindIntent = Object.freeze({
  name: 'sales/kind',
  policyTool: 'sales.kind',
  fieldsForPrompt: `{id, kind: ${LEAD_KINDS.map((k) => `"${k}"`).join(' | ')}, why} for one | {leads: [{id, kind, why}, …]} to sort up to ${SORT_MAX} at once`,
  descriptionForPrompt: `THE LEAD ENGINE. Say what a lead is to the house, or re-file one that was filed wrong: ${KIND_WORDS}. Sort every lead your briefing lists as NOT SORTED YET in ONE filing (leads: […]). Judge each from its own words (its note, its source, its message), never from a guess: someone offering the house a service is a vendor, someone proposing to build or list together is a partner, someone who may pay the house is a buyer. id: the lead (the 8 characters shown in your briefing). why: what in their own words shows it.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const ledger = await leadLedgerFor(context.wallet);
    const all = await ledger.load();
    const list = sortList(payload);
    if (!list.length) return invalid('leads: at least one {id, kind, why}');
    const moves = [];
    const problems = [];
    for (const [n, item] of list.entries()) {
      const at = list.length > 1 ? `leads[${n}]: ` : '';
      const id = String(item?.id ?? '').trim();
      const why = String(item?.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const hits = id.length >= 8 ? all.filter((l) => l.id.startsWith(id)) : [];
      if (!LEAD_KINDS.includes(item?.kind)) problems.push(`${at}kind: ${KIND_WORDS}`);
      else if (why.length < 5) problems.push(`${at}why: what in their own words shows it`);
      else if (hits.length !== 1) problems.push(`${at}"${id}" names ${hits.length ? 'more than one lead' : 'no lead'} on the list`);
      else if (kindOf(hits[0]) === item.kind) problems.push(`${at}"${hits[0].name}" is already filed as ${item.kind}`);
      else moves.push({ lead: hits[0], kind: item.kind, why });
    }
    if (problems.length) return invalid(problems.slice(0, 8).join('; '));
    return { ok: true, value: { context, ledger, moves } };
  },
  summarize: (payload) => (Array.isArray(payload?.leads) ? `sort ${payload.leads.length} lead(s) by what they are` : `re-file lead ${payload?.id ?? '?'} as ${payload?.kind ?? '?'}`),
  execute: async ({ context, ledger, moves }) => {
    const done = [];
    for (const { lead, kind, why } of moves) {
      const moved = await ledger.touch(lead.id, { kind, note: `filed as ${kind}: ${why}`, by: context.laneId });
      if (!moved.ok) return { ok: false, reason: `${done.length} filed, then "${lead.name}" failed: ${moved.error}` };
      done.push(`"${lead.name}" is now filed as ${kind}.`);
    }
    return { ok: true, detail: done.join(' ') };
  },
});

export const salesInboundIntents = Object.freeze([mailScanIntent, inboundIntent, kindIntent]);
