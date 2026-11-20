// LEAD PROVENANCE — which partner found each company, and which gave each address (Design note, 2026-11-18: […]).
//
// Every record of the pipeline already names its source id: a gathered company its list or search
// (candidates.jsonl `source`), a contacts lookup its provider (`contacts` events), an imported lead its tool
// (`source: 'imported from explee …'`). This names the partner behind each id, and follows a lead back to both: the
// company through the prospect it was promoted from (prospect → the company gathered under the same audience), the
// address through the lookup that returned it, or the company's own pages when no provider did. Pure.

/** The partner behind each source id the pipeline records. */
export const PARTNERS = Object.freeze({
  'hunter-discover': 'Hunter', hunter: 'Hunter', 'hunter-find': 'Hunter', 'hunter-verify': 'Hunter',
  tomba: 'Tomba', 'tomba-find': 'Tomba', 'tomba-verify': 'Tomba',
  apollo: 'Apollo', 'apollo-find': 'Apollo', 'apollo-discover': 'Apollo', 'apollo-verify': 'Apollo', 'tomba-discover': 'Tomba',
  'company-index': 'Company index', 'base-protocols': 'DefiLlama', 'base-tokens': 'GeckoTerminal',
});
// Not a partner: what the seat read itself, and what the operator put on the list by hand.
export const OWN_PAGES = 'Company site';
export const WEB = 'Web search';
export const BY_HAND = 'Added by hand';

/** pure — the partner behind a source id, or null for one the pipeline does not know. */
export const partnerOf = (source) => PARTNERS[String(source ?? '').toLowerCase()] ?? null;

const IMPORTED = /^imported from ([^·(]+)/i;
const low = (v) => String(v ?? '').trim().toLowerCase();
// pure — "explee" → "Explee": the tool a lead was imported from, as a name.
const toolName = (raw) => raw.trim().replace(/^\w/, (c) => c.toUpperCase());

/**
 * pure — per lead id, { company, address }: the partner that found the lead's company and the one that gave its
 * address (either null when the record does not say).
 * @param {{leads?: object[], prospects?: object[], candidates?: object[], lookups?: {domain: string, source: string, people: object[]}[]}} records
 * @returns {Map<string, {company: ?string, address: ?string}>}
 */
export const leadProvenance = ({ leads = [], prospects = [], candidates = [], lookups = [] } = {}) => {
  const gathered = new Map(); // `${segmentId}|${domain}` (and the domain alone) → the company's source id
  for (const c of candidates) {
    if (!c?.domain || !c.source) continue;
    gathered.set(`${c.segmentId}|${low(c.domain)}`, c.source);
    if (!gathered.has(low(c.domain))) gathered.set(low(c.domain), c.source);
  }
  const addressFrom = new Map(); // an address → the provider whose lookup returned it (the first one on record)
  for (const look of lookups) {
    for (const p of look.people ?? []) if (p?.email && !addressFrom.has(low(p.email))) addressFrom.set(low(p.email), look.source);
  }
  const prospectOf = new Map(prospects.filter((p) => p.leadId).map((p) => [p.leadId, p]));
  const out = new Map();
  for (const lead of leads) {
    const tool = IMPORTED.exec(String(lead.source ?? ''));
    if (tool) { out.set(lead.id, { company: toolName(tool[1]), address: toolName(tool[1]) }); continue; }
    const p = prospectOf.get(lead.id);
    const companySource = p ? (gathered.get(`${p.segmentId}|${low(p.domain)}`) ?? gathered.get(low(p.domain))) : null;
    const company = companySource ? partnerOf(companySource) : p ? (p.placed || p.source === 'operator' ? BY_HAND : WEB) : null;
    const providerSource = addressFrom.get(low(lead.contact));
    const onTheirPages = p && (p.people ?? []).some((x) => low(x.email) === low(lead.contact));
    const address = providerSource ? partnerOf(providerSource) : onTheirPages || p ? OWN_PAGES : null;
    out.set(lead.id, { company, address });
  }
  return out;
};

/** pure — credits spent per partner, from the lookups on record (a lookup without a count spent one). */
export const spentByPartner = (lookups = []) => {
  const out = {};
  for (const l of lookups) {
    const who = partnerOf(l.source);
    if (who) out[who] = (out[who] ?? 0) + (Number.isFinite(Number(l.spent)) ? Number(l.spent) : 1);
  }
  return out;
};
