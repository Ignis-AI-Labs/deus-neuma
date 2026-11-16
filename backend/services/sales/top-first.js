// TOP FIRST — whom the house writes to at a company, and whom next when they do not answer.
//
// Design note, 2026-11-16: […] The people a lookup brings back are ordered by rank — the founder or chief executive first,
// then the rest of the chiefs, then the heads of the work the house sells into (partnerships,
// business development, growth, ecosystem, listings, treasury), then any other decision maker —
// and a company whose first person never answered is not closed: the next one up is named.
// PURE.

// The words of a rank, matched on whole words, case-insensitive.
const TOP = /\b(?:co-?founder|founder|ceo|chief executive|owner|president|managing (?:director|partner)|general partner)\b/i;
const CHIEF = /\b(?:chief [a-z]+ officer|c[a-z]o|chairman|chairwoman|chair)\b/i;
const SENIOR = /\b(?:vp|vice president|head|director|partner|lead|principal)\b/i;
const OFFERING = /\b(?:partnerships?|business development|bd|biz ?dev|growth|ecosystem|listings?|treasury|tokenomics|defi|liquidity|strategy|strategic)\b/i;

/**
 * How near the top a person is: 0 the founder or chief executive, 1 another chief, 2 a head of the
 * work the house sells into, 3 any other head, 4 someone in that work or a decision maker by the
 * provider's word, 5 anyone else. Pure.
 * @param {{role?: string, seniority?: string|null, decisionMaker?: boolean}} person
 */
export const rankOf = (person) => {
  const role = String(person?.role ?? '');
  if (TOP.test(role)) return 0;
  if (CHIEF.test(role)) return 1;
  if (SENIOR.test(role)) return OFFERING.test(role) ? 2 : 3;
  return OFFERING.test(role) || person?.decisionMaker || person?.seniority === 'executive' ? 4 : 5;
};

/** The people of a company, top first; within a rank an address the provider confirmed comes first. Pure. */
export const topFirst = (people = []) => [...people].sort((a, b) => rankOf(a) - rankOf(b)
  || Number(b.checked === 'valid') - Number(a.checked === 'valid') || (Number(b.confidence) || 0) - (Number(a.confidence) || 0));

/** The domain an address is at, lower case, or ''. Pure. */
export const domainOfAddress = (email) => String(email ?? '').split('@')[1]?.trim().toLowerCase() ?? '';

/**
 * Everyone the house holds at each company, from every lookup on record, top first, one row an address. Pure.
 * @param {Array<{domain: string, people?: object[]}>} lookups
 * @returns {Map<string, object[]>}
 */
export const peopleByCompany = (lookups = []) => {
  const by = new Map();
  for (const { domain, people = [] } of lookups) {
    const key = String(domain ?? '').toLowerCase();
    if (!key || !people.length) continue;
    const held = by.get(key) ?? [];
    for (const p of people) if (p?.email && !held.some((h) => h.email === p.email)) held.push(p);
    by.set(key, held);
  }
  for (const [key, held] of by) by.set(key, topFirst(held));
  return by;
};

/**
 * The next person to write to at a lead's company: the highest-ranked one the house holds that no
 * lead on the ledger is already written to. null when there is nobody left. Pure.
 * @param {{contact?: string}} lead
 * @param {Map<string, object[]>} held peopleByCompany
 * @param {Set<string>} onLedger every address already on the lead list (lower case)
 * @param {(email: string) => boolean} [skip] an address never to name (the do-not-contact list)
 */
export const nextUp = (lead, held, onLedger, skip = () => false) => {
  const domain = domainOfAddress(lead?.contact);
  return (held.get(domain) ?? []).find((p) => !onLedger.has(String(p.email).toLowerCase()) && !skip(p.email)) ?? null;
};

/** The rule as the sales seat reads it. */
export const TOP_FIRST_RULE = 'Write to the TOP first: the founder or chief executive, whatever the company\'s size — nobody is too senior to write to, and a small project\'s founder is exactly who decides. Then the person who owns what you are offering (partnerships, business development, growth, listings, treasury). When the top one has not answered after the follow-ups, write to the next person at the same company, top first — the upkeep names them.';
