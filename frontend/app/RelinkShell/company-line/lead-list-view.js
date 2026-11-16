// lead-list-view.js — how the lead list reads, filed by what each lead is to the house. Pure.

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

const OPEN = new Set(['cold', 'contacted', 'replied', 'qualified']);
const STATUS = Object.freeze({ cold: 'NOT WRITTEN TO YET', contacted: 'WRITTEN TO', replied: 'THEY WROTE — OWED AN ANSWER', qualified: 'QUALIFIED', won: 'WON', lost: 'CLOSED' });

/** A lead's status in the operator's words. */
export const statusWords = (lead) => STATUS[lead.status] ?? String(lead.status).toUpperCase();

/** The list as groups, one per kind that holds anyone, each with its leads (owed an answer first, then newest). */
export const leadGroups = (leads = [], kinds = Object.keys(KIND_WORDS)) => ['unsorted', ...kinds.filter((k) => k !== 'unsorted')].map((kind) => {
  const of = leads.filter((l) => l.kind === kind).sort((a, b) => (b.status === 'replied') - (a.status === 'replied') || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { kind, label: KIND_WORDS[kind]?.[0] ?? kind.toUpperCase(), what: KIND_WORDS[kind]?.[1] ?? '', leads: of, open: of.filter((l) => OPEN.has(l.status)).length, owed: of.filter((l) => l.status === 'replied').length, unsorted: kind === 'unsorted' };
}).filter((g) => g.leads.length);

/** One group's line: how many, how many still open, how many are owed an answer. */
export const groupLine = (g) => [g.unsorted ? { text: `${g.leads.length} TO SORT`, tone: 'alert' } : `${g.leads.length} LEAD${g.leads.length === 1 ? '' : 'S'}`, `${g.open} OPEN`, ...(g.owed ? [{ text: `${g.owed} OWED AN ANSWER`, tone: 'alert' }] : [])];

/** The whole list's line: its size, then each kind's count. */
export const listLine = (groups) => {
  const total = groups.reduce((n, g) => n + g.leads.length, 0);
  const owed = groups.reduce((n, g) => n + g.owed, 0);
  return [`${total} LEAD${total === 1 ? '' : 'S'}`, ...groups.map((g) => (g.unsorted ? { text: `${g.leads.length} NOT SORTED YET`, tone: 'alert' } : `${g.leads.length} ${g.label}`)), ...(owed ? [{ text: `${owed} OWED AN ANSWER`, tone: 'alert' }] : [])];
};

/** What the seat's holder is asked, to scan the mailbox for people who wrote in and are on no list. */
export const SCAN_ASK = 'Scan the house mailbox for leads we missed, with sales/mail-scan. For each sender on no list, read their message, tell me in one line who they are and what they want, and file the real ones with sales/inbound under what they are: a buyer, an applicant, a partner, an investor, press, a vendor or other. Do not answer anyone yet. Tell me who you filed, who you left out, and why.';

/** Each channel a lead can come through, in the operator's words. */
export const SOURCE_WORDS = Object.freeze({ email: 'EMAIL', x: 'X (TWITTER)', linkedin: 'LINKEDIN', telegram: 'TELEGRAM', discord: 'DISCORD', facebook: 'FACEBOOK', youtube: 'YOUTUBE', tiktok: 'TIKTOK', bluesky: 'BLUESKY', mastodon: 'MASTODON', other: 'ELSEWHERE' });
export const sourceWords = (channel) => SOURCE_WORDS[channel] ?? String(channel ?? 'other').toUpperCase();

/** Where the leads came from, most first: each channel with how many leads and how many of them are owed an answer. */
export const sourceCounts = (leads = []) => {
  const by = new Map();
  for (const l of leads) {
    const row = by.get(l.channel) ?? by.set(l.channel, { channel: l.channel, label: sourceWords(l.channel), n: 0, owed: 0 }).get(l.channel);
    row.n += 1;
    if (l.status === 'replied') row.owed += 1;
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
};

/** The leads of one source, or all of them when no source is chosen. */
export const fromSource = (leads = [], channel = '') => (channel ? leads.filter((l) => l.channel === channel) : leads);

/** What the seat's holder is asked, to say what every unsorted lead is. */
export const SORT_ASK = 'Sort every lead your briefing lists as NOT SORTED YET, in one sales/kind filing. Judge each from its own words (its note, its source, its message): a buyer may pay us, a vendor is selling to us, a partner wants to build or list with us, an applicant wants to work for us, an investor may fund us, press writes about us; anything else is other. Then tell me, one line each, what you filed each one as and why. Where you cannot tell, say so and ask me.';
