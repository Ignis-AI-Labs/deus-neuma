/**
 * sales/find-address — the address of ONE named person at a company the house gathered, from the
 * operator's own Hunter key (Design note, 2026-11-16: […]), or Tomba's or
 * Apollo's, named with source (Design note, 2026-11-18: […]). With no source the cheapest attached finder answers (address-check.js FINDERS).
 *
 * The seat reads a person on a company's own pages (a founder, a head of partnerships) and the
 * page gives no address. Hunter's Email Finder is asked for that one person; Hunter charges a
 * credit only when it finds an address. It is kept only if Hunter saw it on a public page or has
 * confirmed that it exists: an address that is only a guess from the company's pattern is told to
 * the seat as a guess and never kept. Paid, so the operator's rule decides (lead-spend.js); the
 * key never reaches the being. The Mercator's alone, behind the `lead-sources` switch.
 */
import { officeContext } from './revenue-acts.js';
import { isConnectionOn } from '../connections/connection-switches.js';
import { readProspects, readCandidates, noteContacts, readContactLookups, readAddressChecks } from '../sales/sales-store.js';
import { readSpend, readSpendReservations, spentThisMonth, spendRefusal, reserveSpend, releaseSpend, attachedProviders } from '../sales/lead-spend.js';
import { FINDERS, checkWords } from '../sales/address-check.js';
import { confirmAddress, settledWords, RISKY } from '../sales/address-confirm.js';
import { normalizeEmail } from '../sales/suppress-shape.js';

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const denied = (reason) => ({ ok: false, status: 'denied', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;

const salesFindAddressIntent = Object.freeze({
  name: 'sales/find-address',
  policyTool: 'sales.find-address',
  fieldsForPrompt: '{domain, name, role?, source?}',
  descriptionForPrompt: 'THE LEAD ENGINE. The address of ONE named person at a company you gathered or pooled, when you read who they are on the company\'s own pages and no address stands there: name is their full name, role what the page calls them. It asks your operator\'s Hunter account (or Tomba\'s or Apollo\'s, named with source: "hunter" | "tomba" | "apollo", when that one is attached) and spends one credit only when an address is found, so use it for the one person worth writing to, never for a list (sales/contacts returns a company\'s people in one lookup). An address the provider only guessed is told to you as a guess and is not kept: do not write to it.',
  availableFor: async ({ connection }) => ((await seated(connection)) && isConnectionOn('lead-sources') ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return denied('the lead engine is the Mercator office\'s — only the seated Mercator files to it');
    if (!isConnectionOn('lead-sources')) return denied('the LEAD SOURCES connection is off — the operator turns it on in POSITIONS, CHIEF REVENUE OFFICER, SETTINGS');
    const domain = String(payload?.domain ?? '').trim().toLowerCase();
    const name = String(payload?.name ?? '').replace(/\s+/g, ' ').trim();
    if (name.split(' ').length < 2 || name.length > 80) return invalid('name: the person\'s full name, first and last, as their company\'s page writes it');
    const [candidates, prospects] = await Promise.all([readCandidates(context.wallet), readProspects(context.wallet)]);
    if (!candidates.some((c) => c.domain === domain) && !prospects.some((p) => p.domain === domain)) return invalid(`"${domain}" is not a company you gathered or pooled`);
    const all = (await attachedProviders()).filter((a) => FINDERS[a.id]);
    const named = payload?.source ? String(payload.source).trim().toLowerCase() : null;
    const attached = named ? all.find((a) => a.id === named) : all[0];
    if (!all.length) return denied('no lead data key is attached — the operator adds one in SETTINGS, API, Lead data (a free Hunter account gives 50 credits a month)');
    if (!attached) return invalid(`source: one of the providers your operator attached (${all.map((a) => a.id).join(', ')})`);
    const [rule, lookups, reservations] = await Promise.all([readSpend(context.wallet), readContactLookups(context.wallet), readSpendReservations(context.wallet)]);
    const refusal = spendRefusal({ rule, spent: spentThisMonth([...lookups, ...reservations], Date.now()), cost: FINDERS[attached.id].cost });
    if (refusal) return denied(refusal);
    return { ok: true, value: { context, domain, name, role: String(payload?.role ?? '').trim().slice(0, 80), attached } };
  },
  summarize: (payload) => `find the address of ${String(payload?.name ?? '?').slice(0, 40)} at ${payload?.domain ?? '?'}`,
  execute: async ({ context, domain, name, role, attached }, { signal } = {}) => {
    const finder = FINDERS[attached.id];
    const who = finder.name;
    const source = `${attached.id}-find`;
    const reserved = await reserveSpend(context.wallet, finder.cost);
    if (!reserved.ok) return { ok: false, reason: reserved.reason };
    try {
      const asked = await finder.find(attached, { domain, name, signal });
      if (!asked.ok) return { ok: false, reason: `${who} could not be asked: ${asked.why}.` };
      const { found, spent } = asked;
      const paid = spent ? `${spent} credit${spent === 1 ? '' : 's'} spent` : 'no credit spent';
      if (!found) { await noteContacts(context.wallet, domain, source, [], context.laneId, spent); return { ok: true, detail: `${who} holds no address for ${name} at ${domain} (${paid}). Look for one on the company's own pages, or write to a general address the company publishes.` }; }
      const confirmed = found.status === 'valid';
      if (!found.sourceUrl && !confirmed) {
        await noteContacts(context.wallet, domain, source, [], context.laneId, spent);
        return { ok: true, detail: `${who} GUESSED ${found.email} for ${name} (${found.score}% sure): it has seen it on no page and it ${checkWords(found.status ?? 'unknown', who)}. It is not kept, and you do not write to it (${paid}).` };
      }
      const person = { name, role: role || found.role || 'role not stated', email: found.email, confidence: found.score, sourceUrl: found.sourceUrl ?? found.linkedin ?? `https://${domain}`, basis: confirmed ? 'verified' : 'published', checked: found.status };
      await noteContacts(context.wallet, domain, source, [person], context.laneId, spent);
      return { ok: true, detail: `${name} at ${domain}: ${found.email} — ${confirmed ? `the address exists (${who} checked it)` : `it ${checkWords(found.status ?? 'unknown', who)}`}${found.sourceUrl ? `; seen on ${found.sourceUrl}` : ''} (${paid}). File them under people in sales/prospect with this address and that page, then sales/lead.` };
    } finally {
      await releaseSpend(context.wallet, reserved.reservation.id);
    }
  },
});

// CONFIRM OR FIND (Design note, 2026-11-19: […]): address-confirm.js, once an address; a settled one is
// answered from the record, spending nothing.
const salesConfirmAddressIntent = Object.freeze({
  name: 'sales/confirm-address',
  policyTool: 'sales.confirm-address',
  fieldsForPrompt: '{email}',
  descriptionForPrompt: 'THE LEAD ENGINE. For an address whose check came back NOT CONFIRMED (RISKY: its server did not answer, takes any address, or it is a personal mailbox) or WILL BOUNCE: every database your operator attached that has not checked it checks it now; if none confirms it, the same person is looked for by name (PAID LEAD DATA) and any other address found is checked the same way. The first one confirmed becomes theirs: the lead and the email waiting for them move to it, by themselves. If nothing confirms it, the address is SETTLED — NO DATABASE CAN CONFIRM — and you STOP: do not check it, look for it or ask again; tell your operator, who decides to send it as it is or to write to someone else at the company. Run it ONCE an address; a settled one answers from the record.',
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return denied('the lead engine is the Mercator office\'s — only the seated Mercator files to it');
    const email = normalizeEmail(payload?.email);
    if (!email) return invalid('email: the address whose check came back not confirmed');
    const check = (await readAddressChecks(context.wallet)).find((c) => c.email === email);
    if (!check) return invalid(`${email} has not been checked yet: staging an email to it checks it (sales/draft-email), or your operator presses CHECK ADDRESSES`);
    if (check.status === 'valid') return invalid(`${email} is confirmed already (${check.confirmedBy.join(', ')}) — nothing to do`);
    if (check.settled) return denied(settledWords(email, check.settled));
    return { ok: true, value: { context, email } };
  },
  summarize: (payload) => `confirm ${String(payload?.email ?? '?').slice(0, 80)}, or find one that is`,
  execute: async ({ context, email }, { signal } = {}) => {
    const out = await confirmAddress(context.wallet, { email, by: context.laneId, signal });
    return { ok: true, detail: out.words };
  },
});

/** pure — what a staged email's address check means for the seat: nothing when confirmed, the next step when not. */
export const addressNextStep = (email, check) => {
  if (!check || check.status === 'valid') return '';
  if (check.settled) return ` ${settledWords(email, check.settled)}`;
  return RISKY.includes(check.status) ? ` Its address is NOT CONFIRMED (${check.checker}: ${check.status}) — run sales/confirm-address {email: "${email}"} once: every database checks it, then another address for them is looked for; if nothing confirms it, it is marked NO DATABASE CAN CONFIRM and you stop.` : '';
};

export const salesHunterIntents = Object.freeze([salesFindAddressIntent, salesConfirmAddressIntent]);
