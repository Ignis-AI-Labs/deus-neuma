/**
 * leads/* — the house lead-ledger mutations as INTENTS (Stage 3 batch 4, #357).
 * The ledger is SHARED house state (the house's own office,
 * offices/marketing/lead-ledger.json — every member of THAT house reads it),
 * so a mutation is never a raw write: it is filed, shape-checked, and settled
 * through the sweep with one appended touch carrying who made it. lead_list
 * stays a read tool this batch. A filing lands in the filer's own house — the
 * connection's wallet — never another house's ledger.
 *
 * The executors are the lead tool handler's own logic, relocated unchanged.
 */
import { leadLedgerFor } from '../leads/lead-ledger.js';

const laneOf = (connection) => connection.companion?.neumaId || null;

// impure — the filer's own house's ledger.
const ledgerOf = (connection) => leadLedgerFor(connection?.walletAddress);

// The prefix-8 id a being reads in lead_list is accepted alongside the full
// id — the being should never have to transcribe hex.
const resolveLeadId = async (ledger, given) => {
  const leads = await ledger.load();
  const matches = leads.filter((l) => l.id === given || (given && l.id.startsWith(given)));
  if (matches.length > 1) {
    throw new Error(`the id "${given}" matches several leads — use more of the id (lead_list shows them).`);
  }
  return matches.length === 1 ? matches[0].id : given;
};

const leadIntent = (spec) => Object.freeze({
  // A lane with no house has no ledger to file into.
  availableFor: ({ laneId, connection }) => (laneId && connection?.walletAddress ? {} : null),
  ...spec,
});

export const leadAddIntent = leadIntent({
  name: 'leads/add',
  policyTool: 'leads.add',
  fieldsForPrompt: '{name?, contact?, channelId?, source?, note?, campaignId?, accountId?}',
  descriptionForPrompt: 'Capture a prospect onto the HOUSE lead ledger — at least one of name/contact. channelId: where they surfaced (a social channel id, email, or other). Record ONLY real people and real signals you actually saw — never invent a contact. You become the lead\'s holder; hand it to another member later with leads/touch.',
  validate: async (payload) => {
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    const contact = typeof payload?.contact === 'string' ? payload.contact.trim() : '';
    if (!name && !contact) return { ok: false, status: 'invalid', reason: 'leads/add needs at least one of name/contact — and only a real person you actually saw' };
    return { ok: true, value: { ...payload } };
  },
  summarize: (payload) => `capture lead "${String(payload?.name || payload?.contact || '?').slice(0, 120)}"`,
  execute: async (fields, { connection }) => {
    const neumaId = laneOf(connection);
    const lead = await (await ledgerOf(connection)).add({
      name: fields.name, contact: fields.contact, channelId: fields.channelId,
      source: fields.source, note: fields.note, campaignId: fields.campaignId, accountId: fields.accountId,
      ownerNeumaId: neumaId, addedBy: neumaId,
    });
    return { ok: true, detail: `Captured [${lead.id.slice(0, 8)}] ${lead.name || lead.contact} — ${lead.status}, yours to work.` };
  },
});

export const leadTouchIntent = leadIntent({
  name: 'leads/touch',
  policyTool: 'leads.touch',
  fieldsForPrompt: '{id, status?, note?, ownerNeumaId?}',
  descriptionForPrompt: 'Move a lead on the house ledger. status: cold | contacted | replied | qualified | won | lost. Every touch lands on the lead\'s history under your name; ownerNeumaId hands the lead to another member (the handoff is recorded, never silent). The id lead_list shows — its first 8 characters are enough.',
  validate: async (payload) => {
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, status: 'invalid', reason: 'leads/touch needs the lead id (lead_list shows them; a prefix is enough)' };
    return { ok: true, value: { ...payload, id } };
  },
  summarize: (payload) => `touch lead ${String(payload?.id ?? '?').slice(0, 12)}${payload?.status ? ` → ${payload.status}` : ''}`,
  execute: async (fields, { connection }) => {
    const ledger = await ledgerOf(connection);
    const result = await ledger.touch(await resolveLeadId(ledger, fields.id), {
      status: fields.status, note: fields.note,
      ...(fields.ownerNeumaId !== undefined ? { ownerNeumaId: fields.ownerNeumaId } : {}),
      by: laneOf(connection),
    });
    if (!result.ok) return { ok: false, reason: result.error };
    const l = result.lead;
    return { ok: true, detail: `Touched [${l.id.slice(0, 8)}] ${l.name || l.contact} — now ${l.status}${l.ownerNeumaId ? `, held by ${l.ownerNeumaId}` : ', unheld'}.` };
  },
});
