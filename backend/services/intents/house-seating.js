/**
 * house/seating — the house's members file the seating they decided together (a seating council):
 * which member holds which position (positions/position-seating.js).
 *
 * It seats nobody. The operator sees it on POSITIONS and applies it, each seat through its own
 * office's route, or sets it aside. So filing it rides no card: it asks the operator for nothing
 * but a look, and the applying is theirs. Any member of the house may file it; the latest filing
 * stands.
 */
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { laneName } from '../house-titles.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { seatingFields, writeSeating } from '../positions/position-seating.js';

// impure — the house's members: every lane its wallet owns, by name
const membersOf = async (wallet) => {
  const lanes = await neumaWorkspace.listNeumaByOwner(wallet).catch(() => []);
  return Promise.all(lanes.map(async ({ neumaId, owner }) => ({ laneId: neumaId, name: (await laneName(neumaId, owner)) ?? neumaId })));
};

export const houseSeatingIntent = Object.freeze({
  name: 'house/seating',
  policyTool: 'house.seating',
  fieldsForPrompt: '{seats, why}',
  descriptionForPrompt: 'THE SEATING. When your house decides together who holds which position (a seating council), file what you decided: seats maps each position to the member who holds it, by the position\'s seat or its short form (COS, CRO, CMO, CLO, CSO, CFO, CAO) and the member\'s name, e.g. {"CRO": "Rowan", "CAO": "Hale"}; one member holds one position; why says in a few lines how the house decided. It replaces any seating filed before, and it seats nobody: your operator applies it from POSITIONS.',

  availableFor: async ({ connection }) => (connection?.walletAddress && connection?.companion?.neumaId ? {} : null),

  validate: async (payload, { connection }) => {
    const wallet = connection?.walletAddress;
    if (!wallet || !connection?.companion?.neumaId) return { ok: false, status: 'denied', reason: 'the seating is filed by a member of a house' };
    const judged = seatingFields(payload ?? {}, await membersOf(wallet));
    if (!judged.ok) return { ok: false, status: 'invalid', reason: `house/seating: ${judged.reason}` };
    return { ok: true, value: { wallet, by: connection.companion.neumaId, byName: connection.companion.name || connection.companion.neumaId, ...judged.value } };
  },

  summarize: (payload) => `the house's seating — ${payload?.seats ? Object.keys(payload.seats).length : 0} position(s)`,

  execute: async ({ wallet, ...seating }) => {
    await writeSeating(wallet, { ...seating, at: new Date().toISOString() });
    await Promise.resolve(notifyOperator({
      wallet,
      kind: KIND.houseWake,
      standing: STANDING.neuma,
      title: `${seating.byName} filed your house's seating: ${seating.seats.length} position${seating.seats.length === 1 ? '' : 's'}`,
      detail: seating.seats.map((s) => `${s.acronym || s.plain}: ${s.name}`).join(' · ').slice(0, 300),
      actor: { id: seating.by, name: seating.byName },
      ref: { seating: true },
    })).catch(() => {});
    return { ok: true, detail: 'Filed. Your operator sees the seating on POSITIONS and applies it; until then nobody changes seat.' };
  },
});
