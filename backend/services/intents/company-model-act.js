/**
 * company/model — a seat holder files the business model of one of the
 * house's companies, worked out with the operator (Design note, 2026-11-15: […]).
 *
 * Filed by the holder of MANAGEMENT, SALES or MARKETING. It WAITS: the model
 * stands only when the operator approves it in BUSINESS MODEL, and every seat
 * then reads it in the company's file. Tier `allowed`: a record in the
 * house's own office, no egress, no spend.
 */
import { cosDesignation } from '../staff/cos-designation.js';
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { croDesignation } from '../revenue/cro-designation.js';
import { listCompanies } from '../marketing/companies.js';
import { MODEL_FIELDS, makeModel, fileModel } from '../positions/business-model.js';

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const SEATS = Object.freeze([cosDesignation, croDesignation, cmoDesignation]);

// impure — does this lane hold a seat that speaks for the house's companies?
const holdsASeat = async (connection) => {
  const lane = connection?.companion?.neumaId;
  const wallet = connection?.walletAddress;
  if (!lane || !wallet) return false;
  const officers = await Promise.all(SEATS.map((seat) => seat.getOfficer(wallet).catch(() => null)));
  return officers.some((o) => o?.laneId === lane);
};

export const companyModelIntent = Object.freeze({
  name: 'company/model',
  policyTool: 'company.model',
  fieldsForPrompt: `{company, ${MODEL_FIELDS.map((f) => `${f.key}${f.optional ? '?' : ''}`).join(', ')}}`,
  descriptionForPrompt: `File the business model of one house company, once you and your operator have worked it out. ${MODEL_FIELDS.map((f) => `${f.key}: ${f.label.toLowerCase()} (${f.ask})`).join(' ')} When a company has no approved model, work it out WITH your operator before any campaign or audience: ask one question at a time in plain words, wait for each answer, and push back on a vague one. "value" must be a result the buyer can check for themselves, never how it feels. Write only what your operator told you or the company's own pages state. It waits until your operator approves it in POSITIONS, COMPANY; tell them so.`,
  availableFor: async ({ connection }) => ((await holdsASeat(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    if (!(await holdsASeat(connection))) return { ok: false, status: 'denied', reason: 'only the member who holds management, sales or marketing files a company\'s business model' };
    const company = String(payload?.company ?? '').trim();
    const known = (await listCompanies(connection.walletAddress)).map((c) => c.id);
    if (!known.includes(company)) return invalid(`"${company}" is not a company of this house — the house's companies are: ${known.join(', ') || 'none yet'}`);
    try {
      return { ok: true, value: { wallet: connection.walletAddress, lane: connection.companion.neumaId, company, model: makeModel(payload) } };
    } catch (err) {
      return invalid(err.message);
    }
  },
  summarize: (payload) => `file the business model of ${String(payload?.company ?? '?').slice(0, 40)}`,
  execute: async ({ wallet, lane, company, model }) => {
    const filed = await fileModel(wallet, company, model, { by: lane });
    return filed.ok ? { ok: true, detail: `The business model of ${company} is filed and waits for your operator. Tell them: POSITIONS, COMPANY, read it and press APPROVE, or RETURN it with what should change.` } : { ok: false, reason: filed.reason };
  },
});
