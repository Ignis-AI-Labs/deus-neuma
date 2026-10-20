/**
 * house/review-packet — the seated Optio files ONE current review packet for
 * the operator: what waits on them, in the order they should read it, the
 * blocked asks marked (Design note, 2026-10-16: […]).
 *
 * THE OFFICE LAW: validate re-verifies that the filing lane IS its house's
 * seated Optio, and that every ask it names is an open ask of that house,
 * before anything is written (house-clock/review-packet.js packetFields). The
 * tier is `allowed`: the packet only orders what is already filed — it
 * answers nothing, grants nothing, and leaves the house only as the
 * operator's own tray card. So it rides a wake with no card.
 */
import { cosDesignation } from '../staff/cos-designation.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { readAsks } from '../house-clock/wake-ledger.js';
import { packetFields, writePacket } from '../house-clock/review-packet.js';

const officeRefusal = { ok: false, status: 'denied', reason: 'the review packet is the Optio office\'s — only the house\'s seated chief of staff files it (house/post reaches them).' };

// impure — whether this connection's lane is its house's seated Optio
const isSeatedOptio = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  if (!neumaId || !connection.walletAddress) return false;
  const officer = await cosDesignation.getOfficer(connection.walletAddress).catch(() => null);
  return officer?.laneId === neumaId;
};

export const houseReviewPacketIntent = Object.freeze({
  name: 'house/review-packet',
  policyTool: 'house.review-packet',
  fieldsForPrompt: '{summary, order, blocked?}',
  descriptionForPrompt: 'THE OPTIO OFFICE. Bring what waits on your operator back to them as ONE review packet: summary is a short account of what needs them and why (group related asks; say what is blocked and what is nice to have); order lists the open ask ids (your briefing names them) in the order they should read them; blocked names the ones work cannot move past without them. It replaces your last packet. It answers nothing: your operator answers each ask in the house clock.',

  availableFor: async ({ connection }) => ((await isSeatedOptio(connection)) ? {} : null),

  validate: async (payload, { connection }) => {
    if (!(await isSeatedOptio(connection))) return officeRefusal;
    const asks = await readAsks(connection.walletAddress);
    const judged = packetFields(payload ?? {}, asks);
    if (!judged.ok) return { ok: false, status: 'invalid', reason: judged.reason };
    return { ok: true, value: { wallet: connection.walletAddress, by: connection.companion.neumaId, byName: connection.companion.name || connection.companion.neumaId, ...judged.value } };
  },

  summarize: (payload) => `review packet — ${Array.isArray(payload?.order) ? payload.order.length : 0} ask(s) for the operator`,

  execute: async ({ wallet, ...packet }) => {
    const stored = await writePacket(wallet, packet);
    await Promise.resolve(notifyOperator({
      wallet,
      kind: KIND.houseWake,
      standing: STANDING.neuma,
      title: `${packet.byName}'s review packet: ${packet.order.length} for you${packet.blocked.length ? `, ${packet.blocked.length} blocked` : ''}`,
      detail: packet.summary.slice(0, 300),
      actor: { id: packet.by, name: packet.byName },
      ref: { packetAt: stored.at },
    })).catch(() => {});
    return { ok: true, detail: `Filed. Your operator sees this packet on top of the house clock's ASKS, ${packet.order.length} ask(s) in your order.` };
  },
});
