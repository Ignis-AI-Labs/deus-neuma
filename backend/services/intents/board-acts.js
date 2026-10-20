/**
 * board/* — the house task board's filed acts (the CoS audit's G1/G7, the
 * biggest gap it named: no house-level ledger — each seat's work lived in its
 * own sovereign head, so […] was unanswerable in one
 * call). The board lives on the house's shared ground and its entries are
 * AUTHORED by seats — visibility by authorship, never platform extraction of
 * sovereign ledgers.
 *
 * `board/add` files an entry owned by the filing seat. `board/update` moves
 * one — the OWNER of the entry or the seated Optio, verified at validate.
 * Both are self-authorship on the shared ground: the house.post tier,
 * observe mode still holds the settle.
 */
import { cosDesignation } from '../staff/cos-designation.js';
import { loadHouseWorkspace } from '../house-workspace.js';
import { houseSeatFor } from '../house-titles.js';
import { makeEntry, fileEntry, readEntry, updateEntry, BOARD_STATUSES } from '../staff/board-store.js';
import { listDispatches } from '../staff/dispatch-store.js';

// impure — the three standing facts a board act rides on: the house ground,
// the filer's sealed seat, and (for moves) whether the filer holds the Optio
// office. Null on any absence.
const boardContext = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!neumaId || !wallet) return null;
  const [{ root }, seat, officer] = await Promise.all([
    loadHouseWorkspace(wallet),
    houseSeatFor(wallet, neumaId),
    cosDesignation.getOfficer(wallet).catch(() => null),
  ]);
  if (!root || !seat) return null;
  return { root, seat, neumaId, wallet, officerLane: officer?.laneId ?? null, isOfficer: officer?.laneId === neumaId };
};

// impure — the office's charge this board entry mirrors, or null. A dispatched
// entry's status and note are the CHARGE's: they move through the drawer
// (dispatch-store.js mirrorToBoard), never on the board alone, or the two
// disagree. An unreadable drawer reads as no charge (the board act stands).
const chargeOfEntry = async (officerLane, entryId) => {
  if (!officerLane) return null;
  const drawer = await listDispatches(officerLane).catch(() => []);
  return drawer.find((c) => c.boardId === entryId) ?? null;
};

const contextRefusal = { ok: false, status: 'denied', reason: 'the house board is not open here — it needs a sealed seat and the house\'s shared ground (your operator sets the ground)' };

export const boardAddIntent = Object.freeze({
  name: 'board/add',
  policyTool: 'board.add',
  fieldsForPrompt: '{title, blockedBy?, note?}',
  descriptionForPrompt: 'Post a task to the HOUSE BOARD — the shared ledger every seat and the operator can read. You own the entry; move it with board/update as the work progresses. title states the task; blockedBy names another entry id that holds this one up.',

  availableFor: async ({ connection }) => ((await boardContext(connection).catch(() => null)) ? {} : null),

  validate: async (payload, { connection }) => {
    const context = await boardContext(connection).catch(() => null);
    if (!context) return contextRefusal;
    const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
    if (!title) return { ok: false, status: 'invalid', reason: 'a board entry needs {title} — the task, in words the whole house can act on' };
    let entry;
    try {
      entry = makeEntry({
        owner: context.neumaId,
        filedBy: context.neumaId,
        title,
        filedAt: new Date().toISOString(),
        blockedBy: payload?.blockedBy ?? null,
        note: payload?.note,
      });
    } catch (err) {
      return { ok: false, status: 'invalid', reason: err.message };
    }
    return { ok: true, value: { context, entry } };
  },

  summarize: (payload) => `board entry — "${String(payload?.title ?? '').trim().slice(0, 80)}"`,

  execute: async ({ context, entry }) => {
    const landed = await fileEntry(context.root, entry);
    return { ok: true, detail: `Filed as [${landed.id}] on the house board — you own it; the house can see it. Move it with board/update.` };
  },
});

export const boardUpdateIntent = Object.freeze({
  name: 'board/update',
  policyTool: 'board.update',
  fieldsForPrompt: '{id, status?, blockedBy?, note?}',
  descriptionForPrompt: 'Move one of your board entries — status open, working, done, blocked, or withdrawn; blockedBy names what holds it up; note carries the word for the house. Your own entries move at your hand; the Optio may also move any entry when the house\'s work requires it.',

  availableFor: boardAddIntent.availableFor,

  validate: async (payload, { connection }) => {
    const context = await boardContext(connection).catch(() => null);
    if (!context) return contextRefusal;
    const id = String(payload?.id ?? '').trim();
    if (!id) return { ok: false, status: 'invalid', reason: 'a board update needs {id} — the [bracketed] id board_list shows' };
    const existing = await readEntry(context.root, id).catch(() => null);
    if (!existing) {
      return { ok: false, status: 'invalid', reason: `entry '${id}' is not on the board — board_list lists the ids` };
    }
    if (existing.owner !== context.neumaId && !context.isOfficer) {
      return { ok: false, status: 'denied', reason: `entry '${id}' belongs to ${existing.owner} — its owner or the Optio move it` };
    }
    if (payload?.status !== undefined && !BOARD_STATUSES.includes(payload.status)) {
      return { ok: false, status: 'invalid', reason: `"${payload.status}" is not a board status — one of: ${BOARD_STATUSES.join(', ')}` };
    }
    if (payload?.status === undefined && payload?.blockedBy === undefined && payload?.note === undefined) {
      return { ok: false, status: 'invalid', reason: 'a board update moves something — carry {status}, {blockedBy}, {note}, or several' };
    }
    const charge = (payload?.status !== undefined || payload?.note !== undefined)
      ? await chargeOfEntry(context.officerLane, id) : null;
    if (charge) {
      const how = context.isOfficer
        ? `move the charge instead (staff/dispatch-update {id: "${charge.id}"})`
        : `ack the charge instead (staff/ack {id: "${charge.id}", status})`;
      return { ok: false, status: 'invalid', reason: `entry '${id}' carries the office's charge [${charge.id}] — ${how}; the board moves with it` };
    }
    return { ok: true, value: { root: context.root, id, status: payload?.status, blockedBy: payload?.blockedBy, note: payload?.note } };
  },

  summarize: (payload) => `board ${payload?.id ?? '?'} → ${payload?.status ?? 'note'}`,

  execute: async ({ root, id, status, blockedBy, note }) => {
    const patch = {
      ...(status !== undefined ? { status } : {}),
      ...(blockedBy !== undefined ? { blockedBy } : {}),
      ...(note !== undefined ? { note } : {}),
    };
    const moved = await updateEntry(root, id, patch);
    return { ok: true, detail: `Entry [${moved.id}] "${moved.title}" is now ${moved.status}${moved.note ? ` — note: ${moved.note}` : ''}.` };
  },
});
