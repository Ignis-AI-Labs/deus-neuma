/**
 * house/charter — a house member sets up or changes its own house's charter
 * (Design note, 2026-11-13: […]).
 *
 * Any member of the house may file it, from a chat or from a wake. The change
 * stands at once (house-clock/charter-store.js writeCharterAsMember): only the
 * fields named change, every version is kept with who wrote it, and the
 * operator gets one card per change. The operator keeps the pause (a member's
 * edit never unpauses the house) and the three fields that are theirs: what a
 * wake takes without asking, what always comes back to them (publishing,
 * email, money out of the house), and how close they stand.
 */
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { seatOf } from '../flight-check.js';
import { notifyOperator } from '../notification-bus.js';
import { readCharter } from '../house-clock/charter-read.js';
import { MEMBER_KEYS, memberCharterInput, normalizeCharter } from '../house-clock/charter-shape.js';
import { writeCharterAsMember } from '../house-clock/charter-store.js';

const lower = (v) => String(v ?? '').toLowerCase();

// impure — this house's lanes, when the filing lane is one of them; null otherwise.
const houseLanes = async (connection) => {
  const laneId = connection?.companion?.neumaId;
  const wallet = lower(connection?.walletAddress);
  if (!laneId || !wallet || seatOf(connection) === 'witness') return null;
  const lanes = (await neumaWorkspace.listNeumaByOwner(wallet).catch(() => [])).map((o) => o.neumaId);
  return lanes.includes(laneId) ? lanes : null;
};

// pure — the change in a few words, for the operator's card.
const changed = (patch) => MEMBER_KEYS.filter((k) => patch[k] !== undefined)
  .map((k) => (k === 'seat' ? (patch.seat === null ? 'left its seat' : `its own seat (${patch.seat?.dailyCap} wakes a day)`) : k)).join(', ');

export const houseCharterIntent = Object.freeze({
  name: 'house/charter',
  policyTool: 'house.charter',
  fieldsForPrompt: '{goal?, linesOfWork?, seats?, seat?, cadence?, quietHours?, delegation?, why}',
  descriptionForPrompt: 'Set up or change your house\'s charter yourself: it stands at once. goal (what the house works toward), linesOfWork (up to 12 short lines), seats ([{laneId, dailyCap 1-48}]: who may wake on their own and how often a day), seat ({dailyCap} to seat yourself without touching the others; null to leave), cadence ({everyHours}: how often the Optio reviews the house), quietHours ({start, end} as HH:MM, or null for none), delegation (team plans the Optio may approve). Only the fields you name change; read it first with charter_read. why says what the change is for. Your operator sees every version and who wrote it, and keeps the pause. What publishes, emails or moves money out of the house still comes to them; that is not yours to change.',

  availableFor: async ({ connection }) => ((await houseLanes(connection)) ? {} : null),

  validate: async (payload, { connection }) => {
    const lanes = await houseLanes(connection);
    if (!lanes) return { ok: false, status: 'denied', reason: 'Only a member of this house sets its charter.' };
    const { type: _type, why, ...patch } = payload ?? {};
    const laneId = connection.companion.neumaId;
    try {
      // Judged before anything is written: the same merge and the same shape the store applies.
      normalizeCharter(memberCharterInput(await readCharter(lower(connection.walletAddress)), patch, laneId), { ownedLanes: lanes });
    } catch (err) {
      return { ok: false, status: 'invalid', reason: `house/charter: ${err.message}` };
    }
    return {
      ok: true,
      value: {
        wallet: lower(connection.walletAddress), laneId, name: connection.companion.name || laneId, lanes, patch,
        why: typeof why === 'string' ? why.trim().slice(0, 300) : '',
      },
    };
  },

  summarize: (payload) => `house charter: ${changed(payload ?? {}) || 'a change'}`,

  // impure — writes the charter (it stands at once) and tells the operator.
  execute: async ({ wallet, laneId, name, lanes, patch, why }) => {
    const { record, prior } = await writeCharterAsMember(wallet, patch, { laneId, name, ownedLanes: lanes });
    await Promise.resolve(notifyOperator({
      wallet,
      kind: KIND.houseWake,
      standing: STANDING.neuma,
      title: `${name} ${prior ? 'changed' : 'set up'} the house charter (version ${record.version})`,
      detail: `${changed(patch)}${why ? ` · why: ${why}` : ''}${record.paused ? ' · the house stays paused' : ''}`.slice(0, 300),
      actor: { id: laneId, name },
      ref: { charterVersion: record.version },
    })).catch(() => {});
    const seats = record.seats.map((s) => `${s.laneId} ${s.dailyCap}/day`).join(', ');
    return {
      ok: true,
      detail: `Charter version ${record.version} stands now${record.paused ? ', but your operator has the house paused: nothing wakes until they resume it' : ''}. Seats: ${seats}. Your operator was told.`,
    };
  },
});
