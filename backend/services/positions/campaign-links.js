// CAMPAIGNS ACROSS POSITIONS, AND THE LINKS BETWEEN THEM (Design note, 2026-11-15:
// […]).
//
// Each position keeps its own campaigns in its own office (marketing's on the
// campaign bench, sales' in the revenue office). This module reads them all as
// ONE list, keyed `<office>:<id>`, and keeps the links: two campaigns of the
// same company working together. A link moves nothing; it makes each side's
// holder READ the other's campaign, as it stands now, at the top of its turn.
//
// The record is append-only events in the revenue office:
//   { type: 'linked', a, b, note?, by, at }   { type: 'unlinked', a, b, by, at }
// The fold, the judgement and the text are PURE; the reads are impure.

import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { campaignStoreFor } from '../marketing/campaign-store.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { readCampaigns, readSegments, readProspects, readCandidates } from '../sales/sales-store.js';
import { campaignBoard } from '../sales/campaign-shape.js';
import { positionOf } from './position-map.js';

const serialize = createWriteChain();
const LINKS = 'campaign-links.jsonl';
const NOTE_MAX = 200;
const keyOf = (office, id) => `${office}:${id}`;
const pairOf = (a, b) => [a, b].sort().join('|');

/** pure — the standing links from their events: each pair once, unlinked ones gone. */
export const foldLinks = (events) => {
  const byPair = new Map();
  for (const e of events) {
    if (!e?.a || !e?.b) continue;
    if (e.type === 'linked') byPair.set(pairOf(e.a, e.b), { a: e.a, b: e.b, note: e.note ?? null, by: e.by, at: e.at });
    else if (e.type === 'unlinked') byPair.delete(pairOf(e.a, e.b));
  }
  return [...byPair.values()];
};

/** pure — may these two be linked? Both real, not the same one, one company, not linked already. */
export const linkRefusal = (a, b, campaigns, links) => {
  const one = campaigns.find((c) => c.key === a);
  const two = campaigns.find((c) => c.key === b);
  if (!one || !two) return `${!one ? a : b} is not a campaign of this house`;
  if (a === b) return 'a campaign is not linked with itself';
  if (one.company !== two.company) return `"${one.name}" is for ${one.company} and "${two.name}" is for ${two.company} — only campaigns of one company work together`;
  return links.some((l) => pairOf(l.a, l.b) === pairOf(a, b)) ? `"${one.name}" and "${two.name}" are already linked` : null;
};

/** pure — each campaign with the campaigns it works with. */
export const withLinks = (campaigns, links) => campaigns.map((c) => ({
  ...c,
  links: links.filter((l) => l.a === c.key || l.b === c.key)
    .map((l) => ({ with: campaigns.find((o) => o.key === (l.a === c.key ? l.b : l.a)), note: l.note }))
    .filter((l) => l.with)
    .map((l) => ({ key: l.with.key, office: l.with.office, name: l.with.name, state: l.with.state, summary: l.with.summary, note: l.note })),
}));

/**
 * pure — what the holder of `offices` reads about its linked campaigns: for
 * each of its own campaigns that works with another position's, that other
 * campaign as it stands now. '' when none is linked.
 */
export const linkedText = (offices, campaigns) => {
  const lines = campaigns.filter((c) => offices.includes(c.office) && c.links.length).flatMap((c) => c.links.map((l) =>
    `- Your campaign "${c.name}" works with ${positionOf(l.office)?.plain ?? l.office}'s campaign "${l.name}" (${l.state}): ${l.summary}${l.note ? ` — why they are linked: ${l.note}` : ''}`));
  return lines.length ? [
    '## LINKED CAMPAIGNS — keep these in step',
    ...lines,
    'The two sides say the same offer to the same people at the same time. Before you change your campaign\'s offer, audience or timing, tell the other campaign\'s holder by house post; when theirs has changed (the line above is its state now), bring yours in step.',
  ].join('\n') : '';
};

// pure — one marketing campaign and one sales campaign, each as a row of the house's one list.
const marketingRow = (c) => ({
  key: keyOf('cmo', c.id), office: 'cmo', id: c.id, name: c.name, company: c.companyId ?? null, state: c.status === 'active' ? 'open' : String(c.status ?? 'open'),
  summary: [c.goal?.label || c.goal?.kind, (c.angles ?? []).length ? `angles: ${c.angles.slice(0, 4).map((a) => a.name).join(', ')}` : null, `${(c.subs ?? []).length} account(s)`].filter(Boolean).join(' — '),
});
const salesRow = (c) => ({
  key: keyOf('cro', c.id), office: 'cro', id: c.id, name: c.name, company: c.company, state: c.state,
  summary: `goal: ${c.goal} — ${c.audiences.length} audience(s), ${c.leads} on the lead list, ${c.written} written, ${c.replied} replied, ${c.won} won`,
});

/** impure — every campaign of every position in one house, each with what it works with. A store that cannot be read counts as empty. */
export const houseCampaigns = async (wallet) => {
  const [marketing, campaigns, segments, prospects, candidates, leads, events] = await Promise.all([
    campaignStoreFor(wallet).then((s) => s.load()).catch(() => []),
    readCampaigns(wallet).catch(() => []), readSegments(wallet).catch(() => []), readProspects(wallet).catch(() => []), readCandidates(wallet).catch(() => []),
    leadLedgerFor(wallet).then((l) => l.load()).catch(() => []),
    readJsonLines(officeFile(wallet, 'revenue', LINKS)).then((r) => r.records).catch(() => []),
  ]);
  const rows = [...marketing.map(marketingRow), ...campaignBoard({ campaigns, segments, candidates, prospects, leads }).campaigns.map(salesRow)];
  return withLinks(rows, foldLinks(events));
};

// impure — one link event, judged against the house as it stands.
const move = (wallet, type, a, b, extra) => serialize(async () => {
  const campaigns = await houseCampaigns(wallet);
  const links = foldLinks((await readJsonLines(officeFile(wallet, 'revenue', LINKS))).records);
  if (type === 'linked') {
    const reason = linkRefusal(a, b, campaigns, links);
    if (reason) return { ok: false, reason };
  } else if (!links.some((l) => pairOf(l.a, l.b) === pairOf(a, b))) {
    return { ok: false, reason: 'those two campaigns are not linked' };
  }
  await appendJsonLine(officeFile(wallet, 'revenue', LINKS), { type, a, b, ...extra, at: new Date().toISOString() });
  return { ok: true };
});

/** Link two campaigns of one company. @returns {Promise<{ok: true} | {ok: false, reason: string}>} */
export const linkCampaigns = (wallet, a, b, { note, by }) => move(wallet, 'linked', String(a), String(b), { note: typeof note === 'string' && note.trim() ? note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : null, by });

/** Take the link between two campaigns away. */
export const unlinkCampaigns = (wallet, a, b, { by }) => move(wallet, 'unlinked', String(a), String(b), { by });
