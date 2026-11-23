/**
 * sales/call — a call the sales member VERIFIED is written onto its lead (Design note, 2026-11-20: the seat found a booking
 * in the mailbox and verified it two ways, and […]: it stood nowhere the operator
 * looks). Filed, it stands under CALLS in the pipeline with how far off it is, on the operator's house calendar at
 * its real time, and is announced an hour and ten minutes before — the same record a call read off a calendar makes
 * (sales/booked-calls.js).
 *
 * The seat says where it verified the call (`source`): the booking notice or the accepted invitation, by its mail
 * number. Nothing is guessed: the time carries its own zone, and the lead is one already on the ledger.
 *
 * THE OFFICE LAW holds as for every sales act: only the seated Mercator files. Tier `allowed`: one note on a lead
 * in the house's own office, nothing outward.
 */
import { officeContext } from './revenue-acts.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { normalizeEmail } from '../sales/suppress-shape.js';
import { readCall, bookCall, cancelCall, callOf } from '../sales/booked-calls.js';

const officerRefusal = { ok: false, status: 'denied', reason: 'the lead engine is the Mercator office\'s — only the seated Mercator files to it (house/post reaches them; the operator seats the office)' };
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;

const salesCallIntent = Object.freeze({
  name: 'sales/call',
  policyTool: 'sales.call',
  fieldsForPrompt: '{lead, at, title, link?, source} | {lead, cancelled: true, source}',
  descriptionForPrompt: 'THE LEAD ENGINE. Write a call you VERIFIED onto its lead, so it stands under CALLS in the pipeline, on your operator\'s calendar, and is announced before it starts. lead: the lead\'s [id] from your briefing, or its email address. at: when it starts, WITH its time zone exactly as the booking says it ("2026-11-23T19:00:00-07:00") — never a bare time. title: what the call is, as the booking names it. link: the https address it is joined at, if the booking gives one. source: where you verified it (the booking notice or accepted invitation, e.g. "mail #412, Calendly New Event"). A call that was RESCHEDULED is filed again with its new time, as soon as you read the notice: it replaces the old time everywhere and your operator is told it moved. A call that was CANCELLED: {lead, cancelled: true, source} — it leaves CALLS and the calendar, your operator is told, and the lead stays open. Do not file a call you only expect: one the other person booked or accepted.',
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const key = String(payload?.lead ?? '').trim();
    const leads = await (await leadLedgerFor(context.wallet)).load();
    const hits = key.includes('@') ? leads.filter((l) => normalizeEmail(l.contact) === normalizeEmail(key)) : leads.filter((l) => l.id === key || (key.length >= 8 && l.id.startsWith(key)));
    if (hits.length !== 1) return invalid(hits.length ? `lead: "${key}" names ${hits.length} leads — give one full id` : `lead: "${key}" is no lead on this house's ledger — a call is written onto a lead; register the person first (sales/inbound for someone who wrote in), then file the call`);
    const source = String(payload?.source ?? '').replace(/\s+/g, ' ').trim();
    if (source.length < 4) return invalid('source: where you verified this (the booking, rescheduling or cancellation notice, or the accepted invitation, by its mail number) — a call is filed once verified, never on expectation');
    if (payload?.cancelled === true) return callOf(hits[0]) ? { ok: true, value: { context, lead: hits[0], off: true, source } } : invalid(`no call is booked with ${hits[0].name || hits[0].contact} — there is nothing to call off`);
    const read = readCall(payload);
    if (!read.ok) return invalid(read.reason);
    return { ok: true, value: { context, lead: hits[0], call: read.call, source } };
  },
  summarize: (payload) => (payload?.cancelled === true ? `call off the call with ${payload?.lead ?? '?'}` : `book a call with ${payload?.lead ?? '?'} at ${payload?.at ?? '?'}`),
  execute: async ({ context, lead, call, source, off }) => {
    if (off) {
      const gone = await cancelCall(context.wallet, { leadId: lead.id, by: context.laneId, why: `verified from ${source}` });
      return gone.ok ? { ok: true, detail: `The call with ${lead.name || lead.contact} (was ${gone.was.at}) is called off: it has left CALLS and your operator's calendar, and they were told. The lead stays open — if they asked for another time, answer them.` } : { ok: false, status: 'failed', reason: gone.reason };
    }
    const done = await bookCall(context.wallet, { leadId: lead.id, call, by: context.laneId, source });
    if (!done.ok) return { ok: false, status: 'failed', reason: done.reason };
    const who = lead.name || lead.contact;
    return { ok: true, detail: done.again ? `The call with ${who} at ${call.at} was already on the record — nothing changed.` : done.moved ? `The call with ${who} MOVED to ${call.at} (was ${done.from}). CALLS, your operator's calendar and the reminders follow the new time, and your operator was told.` : `The call with ${who} is booked for ${call.at} ("${call.title}"). It stands under CALLS in the pipeline and on your operator's calendar, and is announced an hour and ten minutes before. Hand your operator the brief for it before then.` };
  },
});

export const salesCallIntents = Object.freeze([salesCallIntent]);
