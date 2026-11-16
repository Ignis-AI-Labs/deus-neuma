// sales-pool-acts.js — THE POOL, SEEN WHOLE: the sales seat's way through every company it gathered
// (sales/pool-view.js). Design note, 2026-11-16: […] A wide net fills the pool with thousands
// and the briefing names eight; this reads any slice of it — filtered by addresses at Hunter, named
// people, size, words, whether the site was read and lived, whether its people were pulled — a page
// at a time, under counts of the whole. It reads only the house's own records: nothing is asked of
// anyone and nothing is spent, so it carries no card.

import { officeContext } from './revenue-acts.js';
import { readCandidates, readSegments, readContactPeople } from '../sales/sales-store.js';
import { SIZES } from '../sales/company-index.js';
import { peopleByCompany } from '../sales/top-first.js';
import { poolFilter, filterPool, poolCounts, poolLine, POOL_PAGE, POOL_PAGE_MAX } from '../sales/pool-view.js';

const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;
const officerRefusal = { ok: false, status: 'denied', reason: 'the lead engine is the Mercator office\'s — only the seated Mercator reads its pool' };

const salesPoolIntent = Object.freeze({
  name: 'sales/candidates',
  policyTool: 'sales.candidates',
  fieldsForPrompt: `{segment?, state?: "waiting" | "scored" | "all", minAddresses?, minPeople?, sizes?: [${SIZES.map((s) => `"${s}"`).join(' | ')}], words?, site?: "unread" | "alive" | "dead", pulled?: boolean, source?, sort?: "addresses" | "people" | "traffic" | "newest", offset?, limit?}`,
  descriptionForPrompt: `THE LEAD ENGINE. See your whole pool of gathered companies and filter it down (free; reads only your own records). Each company with everything known: size, the addresses Hunter holds there (total, named people, general — the count Hunter's own screen shows), how busy its site is, what its site said when read, whether it is scored, and the people already pulled (top first). Filter by audience (segment), state (waiting to be scored — the default — scored, or all), minAddresses, minPeople (named people at Hunter), sizes, words (in its name, domain or description), site (unread, alive, dead), pulled (people already looked up or not), source; sort by addresses (default), people, traffic or newest; ${POOL_PAGE} a page (limit up to ${POOL_PAGE_MAX}, offset for the next). Narrow the net here, read the sites of the ones worth it (sales/read-sites), score them, then pull the people at the best (sales/contacts, up to ten at once).`,
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const filter = poolFilter(payload);
    if (filter.segment && !(await readSegments(context.wallet)).some((s) => s.id === filter.segment)) return { ok: false, status: 'invalid', reason: `"${filter.segment}" is not one of your audiences` };
    const badSize = filter.sizes.find((s) => !SIZES.includes(s));
    if (badSize) return { ok: false, status: 'invalid', reason: `"${badSize}" is not a size — sizes are: ${SIZES.join(', ')}` };
    return { ok: true, value: { context, filter } };
  },
  summarize: (payload) => `look through the gathered companies${payload?.segment ? ` of audience ${payload.segment}` : ''}`,
  execute: async ({ context, filter }) => {
    const [all, lookups] = await Promise.all([readCandidates(context.wallet), readContactPeople(context.wallet)]);
    const held = peopleByCompany(lookups);
    const pool = filter.segment ? all.filter((c) => c.segmentId === filter.segment) : all;
    const n = poolCounts(pool, held);
    const { matched, page } = filterPool(pool, filter, held);
    const shown = page.length ? `${filter.offset + 1}–${filter.offset + page.length} of ${matched.toLocaleString('en-US')}` : `none of ${matched.toLocaleString('en-US')}`;
    return { ok: true, detail: [
      `The pool${filter.segment ? ' of this audience' : ''}: ${n.all.toLocaleString('en-US')} companies — ${n.waiting.toLocaleString('en-US')} waiting to be scored, ${n.withAddresses.toLocaleString('en-US')} with addresses at Hunter (${n.withPeople.toLocaleString('en-US')} with named people), ${n.read.toLocaleString('en-US')} sites read (${n.dead.toLocaleString('en-US')} dead), ${n.pulled.toLocaleString('en-US')} with people pulled.`,
      `Matching your filter, sorted by ${filter.sort}: ${shown}.`,
      ...page.map((c) => `- ${poolLine(c, held)}`),
      ...(matched > filter.offset + page.length ? [`More: offset ${filter.offset + page.length}.`] : []),
    ].join('\n').slice(0, 12000) };
  },
});

export const salesPoolIntents = Object.freeze([salesPoolIntent]);
