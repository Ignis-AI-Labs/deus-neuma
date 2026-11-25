// THE PEOPLE A COMPANY NAMES ITSELF — when no lead-data provider holds anyone at a company, who its own pages say
// leads it, so their address can be looked for by name.
//
// Measured 2026-11-23/24: for small on-chain teams a provider held a person at 1 fit in 11, and the house wrote to
// nobody at the other ten. Their own sites often name the founders (a team section, an about page), and an address
// finder asked for a NAMED person at a domain answers far more often than a search for […].
// So: the page the run already read is asked who leads the company, and each name is kept ONLY when the page itself
// carries it, letter for letter — a model's guess at a founder is never looked up, never paid for, never written to.
// The messages and the reading are PURE; the asking and the lookup are the run's (lead-run.js).

export const PEOPLE_FROM_PAGE = 2; // names looked up for one company
const PAGE_MAX = 12_000;
const one = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const flat = (v) => one(v).toLowerCase();
// A person's name as a page writes it: two to four words, letters (any alphabet), with the marks names carry.
const NAME = /^\p{L}[\p{L}'’.-]*(?: \p{L}[\p{L}'’.-]*){1,3}$/u;
const TOP = /\b(founder|co-?founder|ceo|chief executive|cto|chief technology|coo|president|managing (director|partner)|head of|lead|director|owner|partner)\b/i;

/** pure — the question, about the page the run read. */
export const peopleMessages = ({ company, text }) => [
  { role: 'system', content: 'You read a company\'s own web page and list the people it names as leading the company. You only copy what the page says. You never use anything you know from elsewhere, and you never guess.' },
  { role: 'user', content: `Company: ${one(company?.name)} (${one(company?.domain)})\n\nPAGE TEXT:\n${String(text ?? '').slice(0, PAGE_MAX)}\n\nList up to three people this page names as founders, executives or leaders OF THIS COMPANY, the most senior first. One a line, exactly as:\nFull Name | their role as the page states it\nCopy each name letter for letter from the page. Do not list investors, advisers, customers, authors of quotes or people of other companies. If the page names no such person, answer with the single word NONE.` },
];

/**
 * pure — the people in an answer that the page itself carries.
 * @param {?string} answer @param {string} text - the page the question was about
 * @param {{name?: string}} [company]
 * @returns {Array<{name: string, role: string}>} the most senior first, at most three
 */
export const readPeople = (answer, text, company = {}) => {
  const page = flat(text);
  const firm = flat(company?.name);
  const seen = new Set();
  const out = [];
  for (const line of String(answer ?? '').split('\n')) {
    const [rawName, rawRole = ''] = line.replace(/^[\s\-*\d.)]+/, '').split('|');
    const name = one(rawName);
    const role = one(rawRole).slice(0, 80);
    if (!NAME.test(name) || name.length > 60 || seen.has(flat(name)) || flat(name) === firm || !page.includes(flat(name))) continue;
    seen.add(flat(name));
    out.push({ name, role: role || 'role not stated' });
  }
  return out.sort((a, b) => Number(TOP.test(b.role)) - Number(TOP.test(a.role))).slice(0, 3);
};

/** pure — where a company can be reached by hand, from what its own site links: X, Telegram and the rest, in words. */
export const reachWords = (socials = {}) => ['telegram', 'x', 'discord', 'linkedin', 'github'].filter((k) => socials?.[k]).map((k) => `${k === 'x' ? 'X' : k[0].toUpperCase() + k.slice(1)} ${socials[k]}`).join(' · ');
