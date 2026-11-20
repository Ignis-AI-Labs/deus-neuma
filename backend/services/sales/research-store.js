// research-store — what the house learned about each person it may write to, kept for good, and whether they fit each
// campaign (email-formula.js gates two and three). Design note, 2026-11-19: […]
// A card is about a PERSON (by address), never about a campaign: any campaign reads it. A fit is about a person AND a
// campaign: a […] for one says nothing of the next. Append-only events in the house's revenue office:
//   { type: 'card', card, by, at }    { type: 'fit', email, campaignId, verdict: 'yes'|'no', why, by, at }
//   { type: 'entity', entity: {domain, entityType, quote, source, verified, why}, by, at }   what a COMPANY is
//                                     (company-entity.js) — read from its own site, kept for every campaign
// impure (the house's files).

import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';

const FILE = 'research.jsonl';
const serialize = createWriteChain();
const fileOf = (wallet) => officeFile(wallet, 'revenue', FILE);

/** pure — the latest card of each address, and the latest fit of each address for each campaign. */
const foldResearch = (events) => {
  const cards = new Map();
  const fits = new Map();
  const entities = new Map();
  for (const e of events) {
    if (e?.type === 'entity' && e.entity?.domain) entities.set(e.entity.domain, { ...e.entity, by: e.by, at: e.at });
    else if (e?.type === 'card' && e.card?.email) cards.set(e.card.email, { ...e.card, by: e.by, at: e.at });
    else if (e?.type === 'fit' && e.email && e.campaignId) fits.set(`${e.email}|${e.campaignId}`, { email: e.email, campaignId: e.campaignId, verdict: e.verdict, why: e.why, by: e.by, at: e.at });
  }
  return { cards, fits, entities };
};

/** The house's research: { cards: Map<email, card>, fits: Map<"email|campaignId", fit>, entities: Map<domain, entity> }. */
export const readResearch = async (wallet) => foldResearch((await readJsonLines(fileOf(wallet))).records);

/** Keep a research card (email-formula.js makeResearch shaped it). */
export const noteResearch = (wallet, card, by) => serialize(() => appendJsonLine(fileOf(wallet), { type: 'card', card, by, at: new Date().toISOString() }));

/** Keep whether a person fits a campaign, and why. */
export const noteFit = (wallet, { email, campaignId, verdict, why }, by) => serialize(() =>
  appendJsonLine(fileOf(wallet), { type: 'fit', email, campaignId, verdict: verdict === 'yes' ? 'yes' : 'no', why: String(why ?? '').replace(/\s+/g, ' ').trim().slice(0, 400), by, at: new Date().toISOString() }));

/** Keep what a company is (company-entity.js makeEntity shaped it; verified: whether its quote was found on its page). */
export const noteEntity = (wallet, entity, by) => serialize(() => appendJsonLine(fileOf(wallet), { type: 'entity', entity, by, at: new Date().toISOString() }));
