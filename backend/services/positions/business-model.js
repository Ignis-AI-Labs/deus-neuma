// THE BUSINESS MODEL OF EACH COMPANY — what it sells, who pays, what it costs
// and what OBJECTIVELY changes for the buyer (Design note, 2026-11-15: […]).
//
// Written before any campaign or audience: every seat that speaks for a
// company reads it in the company file. Two ways in. The operator who knows
// the model types it (it stands at once). The operator who does not works it
// out with a seat's holder, who asks one question at a time and files it
// (company/model); it stands when the operator approves it.
//
// The record is append-only events in the revenue office:
//   { type: 'filed', company, model, by, at }     by 'operator' stands at once
//   { type: 'approved', company, proposalId, at }  { type: 'returned', company, proposalId, note, at }
// The shape, the fold and the text are PURE; the reads and writes are impure.

import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';

const serialize = createWriteChain();
const FILE = 'business-models.jsonl';
const NOTE_MAX = 300;

// Each part: what the operator is asked, in the order a stranger needs the answers.
export const MODEL_FIELDS = Object.freeze([
  { key: 'sells', label: 'WHAT YOU SELL', ask: 'The product or service, in one plain sentence a stranger understands.', max: 600 },
  { key: 'buyer', label: 'WHO PAYS FOR IT', ask: 'The kind of company or person, and the role that decides.', max: 400 },
  { key: 'problem', label: 'THEIR PROBLEM TODAY', ask: 'What it costs them now, in time, money or risk, without you.', max: 600 },
  { key: 'value', label: 'WHAT CHANGES FOR THEM', ask: 'The result they can check for themselves: a number, a saving, a thing they could not do before. Not how it feels.', max: 600 },
  { key: 'price', label: 'WHAT IT COSTS AND HOW YOU EARN', ask: 'The price or the fee, and when it is paid. "Free, we earn a fee on each trade" is an answer.', max: 400 },
  { key: 'proof', label: 'WHAT PROVES IT', ask: 'A record, a number or a page anyone can open. Leave empty if there is none yet.', max: 600, optional: true },
  { key: 'next', label: 'WHAT YOU ARE AFTER NEXT', ask: 'What the company wants from the next three months: buyers, users, funding, partners.', max: 400, optional: true },
].map(Object.freeze));

const clean = (v, max = Infinity) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** pure — a model from what was written; throws in words on a missing needed part, or one too long to keep whole (never cut short in silence). */
export const makeModel = (input) => {
  const model = Object.fromEntries(MODEL_FIELDS.map((f) => [f.key, clean(input?.[f.key])]));
  const missing = MODEL_FIELDS.filter((f) => !f.optional && model[f.key].length < 3);
  if (missing.length) throw new Error(`a business model needs: ${missing.map((f) => `${f.key} (${f.label.toLowerCase()})`).join(', ')}`);
  const long = MODEL_FIELDS.filter((f) => model[f.key].length > f.max);
  if (long.length) throw new Error(`too long to keep whole — shorten: ${long.map((f) => `${f.key} (${model[f.key].length} characters, at most ${f.max})`).join(', ')}. Say the one thing that matters; details belong in the facts sheet`);
  return model;
};

/**
 * pure — each company's model from its events.
 * @returns {Map<string, {approved: ?object, proposal: ?object, proposalId: ?string, by: ?string, at: ?string, returned: ?string}>}
 *   approved: the model that stands · proposal: one a member filed, waiting on the operator
 */
export const foldModels = (events) => {
  const by = new Map();
  for (const [index, e] of events.entries()) {
    if (!e?.company) continue;
    const row = by.get(e.company) ?? { approved: null, proposal: null, proposalId: null, by: null, at: null, returned: null };
    if (e.type === 'filed' && e.model) {
      if (e.by === 'operator') Object.assign(row, { approved: e.model, proposal: null, proposalId: null, by: null, at: e.at, returned: null });
      else Object.assign(row, { proposal: e.model, proposalId: `filed-${index}`, by: e.by ?? null, at: e.at, returned: null });
    } else if (e.type === 'approved' && row.proposal && (!e.proposalId || e.proposalId === row.proposalId)) {
      Object.assign(row, { approved: row.proposal, proposal: null, proposalId: null, at: e.at });
    } else if (e.type === 'returned' && row.proposal && (!e.proposalId || e.proposalId === row.proposalId)) {
      Object.assign(row, { proposal: null, proposalId: null, returned: e.note ?? 'returned' });
    }
    by.set(e.company, row);
  }
  return by;
};

/** pure — one model as the lines a seat reads. */
export const modelLines = (model) => MODEL_FIELDS.filter((f) => model[f.key]).map((f) => `${f.label.toLowerCase()}: ${model[f.key]}`);

/** impure — every company's model of one house. */
export const readModels = async (wallet) => foldModels((await readJsonLines(officeFile(wallet, 'revenue', FILE))).records);

const append = (wallet, event) => appendJsonLine(officeFile(wallet, 'revenue', FILE), { ...event, at: new Date().toISOString() });

/** A model is written for a company. By the operator it stands; by a member it waits for the operator. */
export const fileModel = (wallet, company, input, { by }) => serialize(async () => {
  try {
    await append(wallet, { type: 'filed', company: String(company), model: makeModel(input), by });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

/** The operator's answer to the exact member proposal they read: it stands, or it goes back with what should change. */
export const settleModel = (wallet, company, { approve, note, proposalId }) => serialize(async () => {
  const current = (await readModels(wallet)).get(String(company));
  if (!current?.proposal) return { ok: false, reason: 'no business model waits for this company' };
  if (!proposalId || current.proposalId !== String(proposalId)) return { ok: false, reason: 'that business model proposal is no longer waiting; read the current one and answer it' };
  await append(wallet, approve
    ? { type: 'approved', company: String(company), proposalId: current.proposalId }
    : { type: 'returned', company: String(company), proposalId: current.proposalId, note: clean(note, NOTE_MAX) || 'returned without a note' });
  return { ok: true };
});
