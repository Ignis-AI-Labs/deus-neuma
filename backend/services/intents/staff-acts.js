/**
 * staff/* — the Optio office's filed acts (Stage 3 of the being-tool-surface
 * doctrine): `staff/dispatch` files a standing charge on a seated housemate
 * (one act, two records — the house post IS the delivery, the drawer holds
 * the state), and `staff/dispatch-update` moves a charge (done / blocked /
 * withdrawn / note).
 *
 * THE OFFICE LAW: every validate re-verifies that the filing lane IS the
 * seated officer (cos-designation), the same idiom the security acts use —
 * an unseated lane, a witness, or a relayed filing is denied before anything
 * is written. A charge's recipient must hold a seat (the org chart is the
 * address book, the house/post law).
 *
 * The tier is `allowed` by default: a charge is word between seated housemates
 * on the house's shared ground — the same grant that carries house/post —
 * plus a record in the officer's own drawer. No egress, no spend, no new
 * surface. Observe mode still holds the settle.
 */
import { cosDesignation } from '../staff/cos-designation.js';
import { loadHouseWorkspace } from '../house-workspace.js';
import { houseSeatFor } from '../house-titles.js';
import { makePost, appendPost } from '../house-post.js';
import { makeEntry, fileEntry } from '../staff/board-store.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import {
  makeCharge, fileDispatch, updateDispatch, readDispatch, ackCharge,
  DISPATCH_STATUSES, TERMINAL_DISPATCH_STATUSES,
} from '../staff/dispatch-store.js';

// impure — the three standing facts a staff act rides on: the house ground,
// the filer's sealed seat, and whether the filer holds the Optio office.
// Null on any absence — the act is not theirs, and the denial says so.
const officeContext = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!neumaId || !wallet) return null;
  const officer = await cosDesignation.getOfficer(connection.walletAddress).catch(() => null);
  if (officer?.laneId !== neumaId) return null;
  const [{ root }, seat] = await Promise.all([
    loadHouseWorkspace(wallet),
    houseSeatFor(wallet, neumaId),
  ]);
  if (!root || !seat) return null;
  return {
    root, seat, neumaId, wallet,
    isOfficer: officer?.laneId === neumaId,
    actorName: seat.roster.find((r) => r.neumaId === neumaId)?.name || connection.companion?.name || neumaId,
  };
};

// the refusal when this connection has no seat in a house with its ground
// (seatContext is null) — a refusal, never a thrown ReferenceError
const contextRefusal = { ok: false, status: 'denied', reason: 'staff acts are not open here — they need a sealed seat in a house with its shared ground (your operator sets the ground)' };
const officerRefusal = { ok: false, status: 'denied', reason: 'the dispatch drawer is the Optio office\'s — only the seated chief of staff files or moves charges (house/post reaches them; the operator seats the office).' };

// impure — the two standing facts a SEAT-side staff act rides on: the house
// ground and the seat itself (the ack comes from the charge's holder, not
// the office). Null on any absence.
const seatContext = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!neumaId || !wallet) return null;
  const [{ root }, seat] = await Promise.all([
    loadHouseWorkspace(wallet),
    houseSeatFor(wallet, neumaId),
  ]);
  if (!root || !seat) return null;
  return { root, seat, neumaId, actorName: connection.companion?.name || neumaId };
};

// pure — the refusal for a closed charge. A blocked one is closed too, and the
// way on is said: the work that remains is a fresh charge (staff/dispatch).
const closedRefusal = (id, status) => ({
  ok: false,
  status: 'invalid',
  reason: `charge '${id}' is already ${status} — a closed charge does not move${status === 'blocked' ? '; for the work that remains, file a fresh charge (staff/dispatch)' : ''}`,
});

export const staffDispatchIntent = Object.freeze({
  name: 'staff/dispatch',
  policyTool: 'staff.dispatch',
  fieldsForPrompt: '{to, title, body, dueAt?}',
  descriptionForPrompt: 'THE OPTIO OFFICE. File a standing charge on a SEATED housemate — to is their lane id, title is the charge, body says what done looks like. The charge lands in their house inbox AND your dispatch drawer, where you track it to done; an unacknowledged charge gets a cadenced status check. Not your office? house/post reaches the chief of staff.',

  availableFor: async ({ connection }) => ((await officeContext(connection).catch(() => null)) ? {} : null),

  validate: async (payload, { connection }) => {
    const context = await officeContext(connection).catch(() => null);
    if (!context) return officerRefusal;
    const to = String(payload?.to ?? '').trim();
    const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
    if (!to || !title || typeof payload?.body !== 'string' || !payload.body.trim()) {
      return { ok: false, status: 'invalid', reason: 'a charge needs {to, title, body} — the seated housemate\'s lane id, the charge, and what done looks like' };
    }
    if (!context.seat.roster.some((r) => r.neumaId === to)) {
      return { ok: false, status: 'denied', reason: `"${to}" holds no seat in House ${context.seat.houseName || ''} — dispatch moves only to seated housemates (the HOUSE SEAT section names them)` };
    }
    let charge;
    try {
      charge = makeCharge({
        from: context.neumaId,
        to,
        title,
        body: payload.body,
        filedAt: new Date().toISOString(),
        dueAt: payload?.dueAt ?? null,
        by: context.wallet,
      });
    } catch (err) {
      return { ok: false, status: 'invalid', reason: err.message };
    }
    return { ok: true, value: { context, charge } };
  },

  summarize: (payload) => `dispatch → ${payload?.to ?? '?'} — "${String(payload?.title ?? '').trim().slice(0, 80)}"`,

  // impure — the post IS the delivery; the drawer holds the state, and the
  // board carries it for the whole house. The post lands FIRST (delivery is
  // the act — a crash between the writes leaves a stray post, never a charge
  // that claims a delivery that never rode the wire), then the board entry,
  // then the record claims both by id.
  execute: async ({ context, charge }) => {
    const post = makePost({
      from: charge.from, to: charge.to, body: charge.body, re: charge.title, now: charge.filedAt,
    });
    await appendPost(context.root, post);
    const boardEntry = makeEntry({
      owner: charge.to,
      filedBy: charge.from,
      title: charge.title,
      filedAt: charge.filedAt,
      note: `dispatched by the office${charge.dueAt ? ` — due ${charge.dueAt}` : ''}`,
    });
    const boardLanded = await fileEntry(context.root, boardEntry);
    const landed = await fileDispatch(context.neumaId, { ...charge, postId: post.id, boardId: boardLanded.id });
    // THE TRAIL (ruling, 2026-09-15): the operator sees the dispatch the moment
    // it is filed — who was commanded, what, and by which office.
    try {
      notifyOperator({
        wallet: context.wallet,
        kind: KIND.houseDispatch,
        standing: STANDING.neuma,
        title: `Dispatched to ${charge.to}: "${charge.title}"`,
        actor: { id: context.neumaId, name: context.actorName },
        ref: { chargeId: landed.id, boardId: boardLanded.id, to: charge.to },
      });
    } catch { /* a card must never cost a dispatch */ }
    return { ok: true, detail: `Charge [${landed.id}] filed on ${charge.to} — it waits in their house inbox and reaches them when they next speak. The board carries it; acks move both. Track it in your drawer (house_state).` };
  },
});

export const staffDispatchUpdateIntent = Object.freeze({
  name: 'staff/dispatch-update',
  policyTool: 'staff.dispatch-update',
  fieldsForPrompt: '{id, status?, note?}',
  descriptionForPrompt: 'THE OPTIO OFFICE. Move one of your charges: status done, blocked, or withdrawn (a closed charge does not move again), and/or leave a note — the evidence a seat posted back is your reason, your hand moves the record.',

  availableFor: staffDispatchIntent.availableFor,

  validate: async (payload, { connection }) => {
    const context = await officeContext(connection).catch(() => null);
    if (!context) return officerRefusal;
    const id = String(payload?.id ?? '').trim();
    if (!id) return { ok: false, status: 'invalid', reason: 'a charge update needs {id} — the [bracketed] id your drawer (house_state) shows' };
    const charge = await readDispatch(context.neumaId, id).catch(() => null);
    if (!charge) {
      return { ok: false, status: 'invalid', reason: `charge '${id}' is not in your drawer — house_state lists the ids` };
    }
    if (payload?.status !== undefined && !DISPATCH_STATUSES.includes(payload.status)) {
      return { ok: false, status: 'invalid', reason: `"${payload.status}" is not a charge status — one of: ${DISPATCH_STATUSES.join(', ')}` };
    }
    if (payload?.status === undefined && payload?.note === undefined) {
      return { ok: false, status: 'invalid', reason: 'a charge update moves something — carry {status}, {note}, or both' };
    }
    // Only a CLOSED charge stands still; one its holder acked (received, working) is still the office's to note,
    // block, withdraw or close (2026-10-17 flight: the Optio could not move a charge once it was acked).
    if (TERMINAL_DISPATCH_STATUSES.includes(charge.status)) return closedRefusal(id, charge.status);
    return { ok: true, value: { laneId: context.neumaId, id, status: payload?.status, note: payload?.note } };
  },

  summarize: (payload) => `charge ${payload?.id ?? '?'} → ${payload?.status ?? 'note'}`,

  execute: async ({ laneId, id, status, note }) => {
    const patch = {
      ...(status !== undefined ? { status } : {}),
      ...(note !== undefined ? { note } : {}),
    };
    const updated = await updateDispatch(laneId, id, patch);
    return { ok: true, detail: `Charge [${updated.id}] "${updated.title}" is now ${updated.status}${updated.note ? ` — note: ${updated.note}` : ''}.` };
  },
});

/**
 * staff/ack — the seat's answer to a dispatch (the CoS audit's G3:
 * `house/post` was fire-and-forget, and a manager who cannot see a dispatch
 * land is coordinating blind). The charge's HOLDER acks received, working,
 * done, or blocked — the evidence moving the record; the linked board entry
 * moves with it. The officer's own moves stay staff/dispatch-update;
 * `withdrawn` stays the office's word.
 */
const ACKABLE_STATUSES = Object.freeze(['received', 'working', 'done', 'blocked']);

export const staffAckIntent = Object.freeze({
  name: 'staff/ack',
  policyTool: 'staff.ack',
  fieldsForPrompt: '{id, status, note?}',
  descriptionForPrompt: 'Ack a charge dispatched to you — status received, working, done, or blocked, and the office (and the house board) sees where you stand. The [bracketed] id came with the dispatch post.',

  availableFor: async ({ connection }) => ((await seatContext(connection).catch(() => null)) ? {} : null),

  validate: async (payload, { connection }) => {
    const context = await seatContext(connection).catch(() => null);
    if (!context) return contextRefusal;
    const officer = await cosDesignation.getOfficer(connection.walletAddress).catch(() => null);
    if (!officer?.laneId) {
      return { ok: false, status: 'denied', reason: 'no chief of staff is seated — there is no drawer to ack against' };
    }
    const id = String(payload?.id ?? '').trim();
    const status = payload?.status;
    if (!id) return { ok: false, status: 'invalid', reason: 'an ack needs {id, status} — the charge id came with the dispatch post' };
    if (!ACKABLE_STATUSES.includes(status)) {
      return { ok: false, status: 'invalid', reason: `"${status ?? ''}" is not an ack — received, working, done, or blocked` };
    }
    const charge = await readDispatch(officer.laneId, id).catch(() => null);
    if (!charge) {
      return { ok: false, status: 'invalid', reason: `charge '${id}' is not in the office's drawer — the id came with the dispatch post` };
    }
    if (TERMINAL_DISPATCH_STATUSES.includes(charge.status)) return closedRefusal(id, charge.status);
    if (charge.to !== context.neumaId) {
      return { ok: false, status: 'denied', reason: `charge '${id}' is dispatched to ${charge.to} — only its holder acks it` };
    }
    return { ok: true, value: { officerLane: officer.laneId, id, status, note: payload?.note, by: context.neumaId,
      byName: context.seat.roster.find((r) => r.neumaId === context.neumaId)?.name || context.neumaId } };
  },

  summarize: (payload) => `ack ${payload?.id ?? '?'} → ${payload?.status ?? '?'}`,

  execute: async ({ officerLane, id, status, note, by, byName }) => {
    const acked = await ackCharge(officerLane, id, { status, ...(note !== undefined ? { note } : {}) }, by);
    // THE TRAIL'S OTHER HALF: the operator hears the ack when it lands — the
    // seat answered, and the answer is named.
    try {
      notifyOperator({
        wallet: acked.by,
        kind: KIND.houseAck,
        standing: STANDING.neuma,
        title: `${byName} acked "${acked.title}": ${acked.status}`,
        actor: { id: by, name: byName },
        ref: { chargeId: acked.id, status: acked.status },
      });
    } catch { /* a card must never cost an ack */ }
    return { ok: true, detail: `Charge [${acked.id}] "${acked.title}" acked: ${acked.status}. The office and the house board see it.` };
  },
});
