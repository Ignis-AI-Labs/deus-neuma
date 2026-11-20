// people-view.js — how the LEADS tab reads: ONE list of people, one row each (Design note, 2026-11-16: […]).
// A lead is a person with a status, so the lead list and the contact book are one list; the counts across the
// top are the filters. Pure.

/** Each kind, in the order the house works them, with its plain name and what it means. */
export const KIND_WORDS = Object.freeze({
  unsorted: ['NOT SORTED YET', 'nobody has said what these are to the house; sort each from its row, or hand them all to your sales member'],
  buyer: ['BUYERS', 'may pay the house; worked with the pitch, its checks and its follow-ups'],
  applicant: ['APPLICANTS', 'want to work for the house; answered plainly, never pitched'],
  partner: ['PARTNERS', 'want to build with the house'],
  investor: ['INVESTORS', 'may fund the house'],
  press: ['PRESS', 'write about the house'],
  vendor: ['VENDORS', 'sell to the house'],
  other: ['OTHER', 'wrote in; none of the above'],
});
export const kindWords = (kind) => KIND_WORDS[kind]?.[0] ?? String(kind).toUpperCase();

const OPEN = new Set(['cold', 'contacted', 'replied', 'qualified']);
const STATUS = Object.freeze({ cold: 'NOT WRITTEN TO YET', contacted: 'WRITTEN TO', replied: 'THEY WROTE — OWED AN ANSWER', qualified: 'QUALIFIED', won: 'WON', lost: 'CLOSED' });
/** A lead's status in the operator's words. */
export const statusWords = (lead) => STATUS[lead.status] ?? String(lead.status).toUpperCase();

/** On a row, short: the row's own DUE chip says what is owed, so the status says only where it stands. */
const ROW_STATUS = Object.freeze({ cold: 'NOT WRITTEN TO', replied: 'THEY WROTE' });
export const rowStatus = (lead) => ROW_STATUS[lead.status] ?? statusWords(lead);

/** What is due on a person, short enough for their row (the long form is the chip's hover). */
export const DUE_SHORT = Object.freeze({ suppressed: 'ON DO-NOT-CONTACT — CLOSE IT', sort: 'SORT IT', answer: 'ANSWER OWED', 'follow-up': 'FOLLOW-UP DUE', 'next-up': 'NO REPLY × 3 — NEXT PERSON UP', 'close-out': 'NO REPLY × 3 — CLOSE IT', duplicate: 'DUPLICATE', stale: 'UNTOUCHED 2 WEEKS', unreachable: 'NO WAY TO REACH' });

/** How sure an address is, as one word for a row. */
export const PROOF_SHORT = Object.freeze({ none: 'NO ADDRESS', published: 'ON A PAGE', verified: 'VERIFIED', confirmed: 'CONFIRMED', bounced: 'BOUNCED' });

/** Each channel a lead can come through, in the operator's words. */
export const SOURCE_WORDS = Object.freeze({ email: 'EMAIL', x: 'X (TWITTER)', linkedin: 'LINKEDIN', telegram: 'TELEGRAM', discord: 'DISCORD', facebook: 'FACEBOOK', youtube: 'YOUTUBE', tiktok: 'TIKTOK', bluesky: 'BLUESKY', mastodon: 'MASTODON', other: 'ELSEWHERE' });
export const sourceWords = (channel) => SOURCE_WORDS[channel] ?? String(channel ?? 'other').toUpperCase();

/** How sure an address is, in the operator's words, weakest to strongest (bounced apart). */
export const STATE_WORDS = Object.freeze({
  none: ['NO ADDRESS YET', null],
  published: ['READ ON A PAGE', null],
  verified: ['VERIFIED BY A PROVIDER', null],
  confirmed: ['CONFIRMED — THEY WROTE FROM IT', 'on'],
  bounced: ['BOUNCED — NEVER WRITTEN TO AGAIN', 'alert'],
});

const isAddress = (v) => /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(String(v ?? ''));

/**
 * Every person once: the contact book's records, each joined to its lead and to what is due on that lead. A
 * lead the book folded into another record still gets its own row, so no lead is ever missing from the list.
 * Order: owed an answer, then anything else due, then active leads newest first, then everyone else by company.
 * @param {{contacts?: object[], leads?: object[], upkeep?: object[]}} engine
 */
export const peopleRows = ({ contacts = [], leads = [], upkeep = [] } = {}) => {
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const dueBy = new Map();
  for (const d of upkeep) dueBy.set(d.leadId, [...(dueBy.get(d.leadId) ?? []), d]);
  const used = new Set();
  const row = (c, lead) => ({
    key: lead ? `l:${lead.id}` : `c:${c.email ?? ''}|${c.name}|${c.company ?? ''}`,
    name: c.name || c.email || '', title: c.title || '', company: c.company || c.domain || '', domain: c.domain || '', email: c.email ?? null, reach: c.reach ?? null,
    state: c.state ?? 'none', found: c.source ?? null, lead: lead ?? null, due: lead ? dueBy.get(lead.id) ?? [] : [],
    active: Boolean(lead && OPEN.has(lead.status)), owed: lead?.status === 'replied',
  });
  const rows = contacts.map((c) => {
    const lead = c.lead ? { ...c.lead, ...(leadById.get(c.lead.id) ?? {}) } : null;
    if (lead) used.add(lead.id);
    return row(c, lead);
  });
  for (const l of leads) if (!used.has(l.id)) rows.push(row({ name: l.name, email: isAddress(l.contact) ? l.contact : null, reach: isAddress(l.contact) ? null : l.contact, source: l.source }, l));
  const rank = (r) => (r.owed ? 0 : r.due.length ? 1 : r.active ? 2 : r.lead ? 3 : 4);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.lead && b.lead ? String(b.lead.updatedAt ?? '').localeCompare(String(a.lead.updatedAt ?? '')) : 0)
    || Number(!a.company) - Number(!b.company) || a.company.localeCompare(b.company) || a.name.localeCompare(b.name));
};

/** The ways to read the one list, each with its count; a view with nobody in it is left out (EVERYONE always stands). */
export const VIEWS = Object.freeze([
  ['active', 'ACTIVE LEADS', (r) => r.active],
  ['due', 'DUE', (r) => r.due.length > 0],
  ['closed', 'WON OR CLOSED', (r) => Boolean(r.lead) && !r.active],
  ['contacts', 'NOT LEADS YET', (r) => !r.lead],
  ['all', 'EVERYONE', () => true],
]);
export const viewCounts = (rows) => VIEWS.map(([id, label, is]) => ({ id, label, n: rows.filter(is).length, tone: id === 'due' ? 'alert' : null })).filter((v) => v.n || v.id === 'all');

/** The view the tab opens on: what is due, else the active leads, else everyone. */
export const firstView = (rows) => (rows.some((r) => r.due.length) ? 'due' : rows.some((r) => r.active) ? 'active' : 'all');

const inView = (rows, view) => rows.filter((VIEWS.find(([id]) => id === view) ?? VIEWS.at(-1))[2]);
const tally = (rows, keyOf, wordsOf) => {
  const by = new Map();
  for (const r of rows) { const k = keyOf(r); if (k) by.set(k, (by.get(k) ?? 0) + 1); }
  return [...by].map(([id, n]) => ({ id, label: wordsOf(id), n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
};

/** Within a view: what the leads are, and where they came from, each with its count. */
export const kindCounts = (rows, view) => {
  const order = Object.keys(KIND_WORDS);
  return tally(inView(rows, view), (r) => r.lead?.kind, kindWords).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).map((k) => ({ ...k, tone: k.id === 'unsorted' ? 'alert' : null }));
};
export const sourceCounts = (rows, view) => tally(inView(rows, view), (r) => r.lead?.channel, sourceWords);

/** The campaign a lead is tied to, as the sheet says it: its name; an audience under no campaign; or nothing for a lead no audience found. */
export const campaignWords = (lead) => (lead?.origin ? lead.origin.campaign ?? 'NO CAMPAIGN' : null);
/** …and in full, for the cell's hover: the campaign, the audience that found the lead, the company it is sold for. */
export const originWords = (lead) => (lead?.origin ? [lead.origin.campaign ? `campaign: ${lead.origin.campaign}` : 'under no campaign', `audience: ${lead.origin.audience}`, lead.origin.company ? `for ${lead.origin.company}` : null].filter(Boolean).join(' · ') : 'not found by an audience: it wrote in, or was added by hand');
const NO_ORIGIN = '(none)';
/** Within a view: the campaigns the leads are tied to, each with its count (leads tied to none counted together). */
export const campaignCounts = (rows, view) => tally(inView(rows, view).filter((r) => r.lead), (r) => r.lead.origin?.campaignId ?? (r.lead.origin ? `audience:${r.lead.origin.audienceId}` : NO_ORIGIN),
  (id) => { const lead = rows.find((r) => r.lead && (r.lead.origin?.campaignId ?? (r.lead.origin ? `audience:${r.lead.origin.audienceId}` : NO_ORIGIN)) === id)?.lead; return id === NO_ORIGIN ? 'NO CAMPAIGN (WROTE IN OR ADDED BY HAND)' : lead.origin.campaign ?? `NO CAMPAIGN · ${lead.origin.audience}`; });
const campaignKey = (lead) => lead.origin?.campaignId ?? (lead.origin ? `audience:${lead.origin.audienceId}` : NO_ORIGIN);

const hit = (r, q) => [r.name, r.title, r.company, r.domain, r.email, r.reach, r.lead?.origin?.campaign, r.lead?.origin?.audience].some((v) => String(v ?? '').toLowerCase().includes(q));

/** The rows that show: one view, narrowed by kind, by source and by the search words. */
export const narrow = (rows, { view = 'all', kind = '', source = '', campaign = '', query = '' } = {}) => {
  const q = String(query).trim().toLowerCase();
  return inView(rows, view).filter((r) => (!kind || r.lead?.kind === kind) && (!source || r.lead?.channel === source) && (!campaign || (r.lead && campaignKey(r.lead) === campaign)) && (!q || hit(r, q)));
};

/** The tab's own line: every count that matters, nothing else. */
export const peopleLine = (rows, stats) => {
  const n = (is) => rows.filter(is).length;
  const [active, owed, due, unsorted] = [n((r) => r.active), n((r) => r.owed), n((r) => r.due.length > 0), n((r) => r.lead?.kind === 'unsorted')];
  return [
    `${active} ACTIVE LEAD${active === 1 ? '' : 'S'}`,
    owed ? { text: `${owed} OWED AN ANSWER`, tone: 'alert' } : null,
    unsorted ? { text: `${unsorted} NOT SORTED YET`, tone: 'alert' } : null,
    due ? { text: `${due} DUE`, tone: 'alert' } : { text: 'NOTHING DUE', tone: 'on' },
    `${rows.length} ${rows.length === 1 ? 'PERSON' : 'PEOPLE'} KNOWN`,
    stats?.confirmed ? { text: `${stats.confirmed} CONFIRMED ADDRESS${stats.confirmed === 1 ? '' : 'ES'}`, tone: 'on' } : null,
    stats?.bounced ? { text: `${stats.bounced} BOUNCED`, tone: 'alert' } : null,
  ].filter(Boolean);
};

/** What the seat's holder is asked, to scan the mailbox for people who wrote in and are on no list. */
export const SCAN_ASK = 'Scan the house mailbox for leads we missed, with sales/mail-scan. For each sender on no list, read their message, tell me in one line who they are and what they want, and file the real ones with sales/inbound under what they are: a buyer, an applicant, a partner, an investor, press, a vendor or other. Do not answer anyone yet. Tell me who you filed, who you left out, and why.';

/** What the seat's holder is asked, to say what every unsorted lead is. */
export const SORT_ASK = 'Sort every lead your briefing lists as NOT SORTED YET, in one sales/kind filing. Judge each from its own words (its note, its source, its message): a buyer may pay us, a vendor is selling to us, a partner wants to build or list with us, an applicant wants to work for us, an investor may fund us, press writes about us; anything else is other. Then tell me, one line each, what you filed each one as and why. Where you cannot tell, say so and ask me.';

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** The whole book as a spreadsheet file's text (one person a row). */
export const contactsCsv = (contacts = [], leads = []) => {
  const origin = new Map(leads.map((l) => [l.id, l.origin ?? null]));
  return [
  ['name', 'title', 'company', 'domain', 'email', 'address is', 'other way to reach', 'filed as', 'lead status', 'came from', 'campaign', 'audience', 'first seen', 'source'].map(cell).join(','),
  ...contacts.map((c) => [c.name, c.title, c.company, c.domain, c.email, c.state, c.reach, c.lead?.kind, c.lead?.status, c.lead?.channel, origin.get(c.lead?.id)?.campaign, origin.get(c.lead?.id)?.audience, c.at, c.source].map(cell).join(',')),
].join('\r\n');
};
