/**
 * sales/find-address — the address of ONE named person at a company the house gathered, from the
 * operator's own Hunter key (Design note, 2026-11-16: […]).
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
import { readProspects, readCandidates, noteContacts, readContactLookups } from '../sales/sales-store.js';
import { readSpend, spentThisMonth, spendRefusal, attachedProviders } from '../sales/lead-spend.js';
import { findAddress, FIND_COST, checkWords } from '../sales/address-check.js';

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const denied = (reason) => ({ ok: false, status: 'denied', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;

const salesFindAddressIntent = Object.freeze({
  name: 'sales/find-address',
  policyTool: 'sales.find-address',
  fieldsForPrompt: '{domain, name, role?}',
  descriptionForPrompt: 'THE LEAD ENGINE. The address of ONE named person at a company you gathered or pooled, when you read who they are on the company\'s own pages and no address stands there: name is their full name, role what the page calls them. It asks your operator\'s Hunter account and spends one credit only when an address is found, so use it for the one person worth writing to, never for a list (sales/contacts returns a company\'s people in one lookup). An address Hunter only guessed is told to you as a guess and is not kept: do not write to it.',
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
    const hunter = (await attachedProviders()).find((a) => a.id === 'hunter');
    if (!hunter) return denied('no Hunter key is attached — the operator adds one in SETTINGS, API, Lead data (a free Hunter account gives 50 credits a month)');
    const [rule, lookups] = await Promise.all([readSpend(context.wallet), readContactLookups(context.wallet)]);
    const refusal = spendRefusal({ rule, spent: spentThisMonth(lookups, Date.now()), cost: FIND_COST });
    if (refusal) return denied(refusal);
    return { ok: true, value: { context, domain, name, role: String(payload?.role ?? '').trim().slice(0, 80), apiKey: hunter.apiKey } };
  },
  summarize: (payload) => `find the address of ${String(payload?.name ?? '?').slice(0, 40)} at ${payload?.domain ?? '?'}`,
  execute: async ({ context, domain, name, role, apiKey }, { signal } = {}) => {
    const asked = await findAddress({ domain, name, apiKey, signal });
    if (!asked.ok) return { ok: false, reason: `Hunter could not be asked: ${asked.why}.` };
    const found = asked.found;
    if (!found) { await noteContacts(context.wallet, domain, 'hunter-find', [], context.laneId, 0); return { ok: true, detail: `Hunter holds no address for ${name} at ${domain} (no credit spent). Look for one on the company's own pages, or write to a general address the company publishes.` }; }
    const confirmed = found.status === 'valid';
    if (!found.sourceUrl && !confirmed) {
      await noteContacts(context.wallet, domain, 'hunter-find', [], context.laneId, FIND_COST);
      return { ok: true, detail: `Hunter GUESSED ${found.email} for ${name} from the company's address pattern (${found.score}% sure): it has seen it on no page and it ${checkWords(found.status ?? 'unknown')}. It is not kept, and you do not write to it (1 credit spent).` };
    }
    const person = { name, role: role || found.role || 'role not stated', email: found.email, confidence: found.score, sourceUrl: found.sourceUrl ?? found.linkedin ?? `https://${domain}`, basis: confirmed ? 'verified' : 'published', checked: found.status };
    await noteContacts(context.wallet, domain, 'hunter-find', [person], context.laneId, FIND_COST);
    return { ok: true, detail: `${name} at ${domain}: ${found.email} — ${confirmed ? 'the address exists (Hunter checked it)' : `it ${checkWords(found.status ?? 'unknown')}`}${found.sourceUrl ? `; seen on ${found.sourceUrl}` : ''} (1 credit spent). File them under people in sales/prospect with this address and that page, then sales/lead.` };
  },
});

export const salesHunterIntents = Object.freeze([salesFindAddressIntent]);
