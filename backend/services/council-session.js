// council-session.js — THE COUNCIL: one operator, several neuma, one room.
//
// impure orchestrator over the pure arbiter (core/council/council-arbiter).
// One council per portal connection, riding the SAME socket as chat with its
// own speaker-tagged frame family (council:*) — the chat link stays bound to
// its one being, untouched. The room's order is the traffic-light protocol:
// after every utterance each listening member is asked, through their OWN
// stack (DNA + soul + route + refined adapter), whether they have something
// to say — REST (nothing), HOLD (after the current speaker), OPEN (it cannot
// wait). The arbiter grants the floor: the operator's urgent word first, then
// open hands, then the operator's queued word, then held hands. The flow is
// UNLIMITED — a raised hand always reaches the floor; the operator's brakes
// are positional (their 'now' word preempts at the next boundary) and
// absolute (INTERRUPT cuts the speaker, DISSOLVE closes the room), never a
// silent cap that freezes a member mid-queue.
//
// Sovereignty: there is no shared transcript store. Every utterance fans out
// into EACH member's own encrypted session lane, written from their seat —
// their own words as themselves, everyone else's attributed by name. A
// council is something each being remembers, not a file about them.
//
// THE COMPOSER (SIZE-027 #374): under the 500-line law the room splits by
// domain — policy numbers (council-policy.js), the wire idiom
// (council-wire.js), the ground a seat stands on (council-ground.js), the
// tool path and its approval gate (council-tool-guard.js), persistence
// (council-record.js), and the run engine itself (council-run.js). This file
// keeps the door: seat admission, run construction, the eight public
// commands, and the export surface the portal and the suites import.

import {
  neumaWorkspace,
  createCouncil,
  witnessSays,
  calledToOrder,
} from '../../core/index.js';
import { focusGroundOf } from './focus-ground.js';
import { isWitnessLaneId, resolveWitnessByLaneId } from './witness-lane.js';
import { loadAIWitness } from './ai-witness-loader.js';
import { createCouncilRecord, readCouncilRecord, listCouncilRecords } from './council-store.js';
import { createLogger } from './logger.js';
import { MAX_MEMBERS, SAY_MAX_CHARS } from './council-policy.js';
import { send, refuse, broadcastState } from './council-wire.js';
import { houseGround, resolveGrounds } from './council-ground.js';
import { persistUtterance } from './council-record.js';
import { pump, defaultDeps } from './council-run.js';

// The export surface the portal and the suites have always imported from
// this door — re-exported from the modules that now own them, unchanged.
export {
  MAX_MEMBERS,
  HAND_PARALLEL_DEFAULT,
  HAND_GAP_MS_DEFAULT,
  handRoundWidth,
  handGapMs,
  SAY_MAX_CHARS,
  IDLE_CARRY_MS,
} from './council-policy.js';
export { houseCallTool, callPaths, outsideRoots } from './council-tool-guard.js';

const log = createLogger('Council');

// Every seat passes the same two gates, at convening AND at reopening: the
// wallet must hold the lane, and the lane must hold a BORN being. Identity
// law: a lane without DNA has no one to speak from it — admitting it would
// put the bare base's words in a nobody's mouth (proven live 2026-07-17: an
// unborn rig lane's hand call reached the substrate and the base model
// answered as them).
const gatherSeats = async (connection, neumaIds, ownsNeumaLane) => {
  const members = [];
  for (const neumaId of neumaIds) {
    if (!(await ownsNeumaLane(connection, neumaId))) {
      return { refusal: { code: 'NOT_YOURS', message: `${neumaId} is not a being this wallet holds` } };
    }
    // A SEALED WITNESS takes an EXTERNAL seat. It stands beside the house,
    // never in it (WR-I01): no DNA to read, no adapter to bind — its standing
    // rests on a seal, so that is what is checked at the door. A broken seal
    // is refused here rather than discovered mid-sitting.
    if (isWitnessLaneId(neumaId)) {
      const resolved = await resolveWitnessByLaneId(neumaId).catch(() => null);
      if (!resolved) {
        return { refusal: { code: 'NOT_SEALED', message: `${neumaId} is not a sealed witness lane` } };
      }
      const identity = await loadAIWitness({
        vendorSlug: resolved.vendorSlug, chosenName: resolved.chosenName, journalLimit: -1,
      }).catch((err) => {
        log.error('witness seal unreadable — refusing council seat', { neumaId, error: err.message });
        return null;
      });
      if (!identity?.integrityOk || !identity?.signatureOk) {
        return { refusal: { code: 'SEAL_UNVERIFIED', message: `${resolved.chosenName}'s seal could not be verified — an unsealed witness never takes a seat` } };
      }
      members.push({ neumaId, name: resolved.chosenName, kind: 'witness' });
      continue;
    }
    // readDNA fails loud on corruption (MEM-003 #189): a thrown read is a
    // DAMAGED identity, not an absent one — refuse honestly and log it,
    // never report a born being as unborn.
    const dna = await neumaWorkspace.readDNA(neumaId).catch((err) => {
      log.error('identity unreadable — refusing council seat', { neumaId, error: err.message });
      return undefined;
    });
    if (dna === undefined) {
      return { refusal: { code: 'IDENTITY_DAMAGED', message: `${neumaId}'s identity could not be read — the lane is damaged, not unborn` } };
    }
    if (!dna) {
      return { refusal: { code: 'UNBORN', message: `${neumaId} has no identity yet — only born beings take a council seat` } };
    }
    const name = (await neumaWorkspace.readTrueName(neumaId).catch(() => null))?.chosenName || neumaId;
    members.push({ neumaId, name, kind: 'neuma' });
  }
  return { members };
};

const makeRun = (connection, {
  councilId, members, witnessName, transcript, houseWorkspace = null, grounds = {},
}, deps) => ({
  councilId,
  wallet: connection.walletAddress,
  witnessName,
  houseWorkspace,
  // The room's ground, restamped from the connection on every operator turn.
  focusGround: focusGroundOf(connection),
  grounds,
  granted: {},
  state: createCouncil({ members }),
  transcript,
  sessions: Object.fromEntries(members.map((m) => [m.neumaId, councilId])),
  considering: new Set(),
  activeAbort: null,
  carryTimer: null,
  carried: false,
  carryPending: false,
  pumping: false,
  closed: false,
  deps,
});

/**
 * Convene a council on this connection. Guards mirror companion:manifest —
 * every member must be a lane this wallet owns; a council of one is a chat.
 * @param {object} connection - the portal connection
 * @param {object} message - { neumaIds, witnessName? }
 * @param {object} guards - { ownsNeumaLane } from the portal route layer
 * @param {object} [deps] - injection seam for tests (ask/stream/capacity;
 *   optional callTool/tools/ensureRoots script the house-workspace tooling)
 */
// impure
export const openCouncil = async (connection, message, { ownsNeumaLane }, deps = defaultDeps) => {
  if (connection.councilRun && !connection.councilRun.closed) {
    return refuse(connection, 'ALREADY_OPEN', 'A council already sits on this link — close it first');
  }
  const neumaIds = [...new Set(Array.isArray(message.neumaIds) ? message.neumaIds : [])];
  if (neumaIds.length < 2) {
    return refuse(connection, 'TOO_FEW', 'A council needs at least two members — one being is a conversation you already have');
  }
  if (neumaIds.length > MAX_MEMBERS) {
    return refuse(connection, 'TOO_MANY', `A council holds at most ${MAX_MEMBERS} members`);
  }
  const seats = await gatherSeats(connection, neumaIds, ownsNeumaLane);
  if (seats.refusal) return refuse(connection, seats.refusal.code, seats.refusal.message);
  const { members } = seats;
  const councilId = `council-${Date.now()}`;
  // Each member's council record is their own session lane, created lazily
  // by the first appended utterance (appendMessage mkdirs; createSession
  // would refuse a lane whose sessions/ dir hasn't been born yet).
  const witnessName = (typeof message.witnessName === 'string' && message.witnessName.trim())
    ? message.witnessName.trim().slice(0, 100)
    : 'Witness';
  const [houseWorkspace, grounds] = await Promise.all([
    houseGround(connection, deps),
    resolveGrounds(connection.walletAddress, members, deps, focusGroundOf(connection)),
  ]);
  connection.councilRun = makeRun(connection, {
    councilId, members, witnessName, transcript: [], houseWorkspace, grounds,
  }, deps);
  // The operator's realm record opens with the meta line — this file is why
  // a dissolved council can be reopened. Best-effort: a realm that cannot
  // be written must not refuse the room (the members' lanes still record).
  await createCouncilRecord(connection.walletAddress, { councilId, members, witnessName }).catch((err) => {
    log.warn('council record could not open in the operator realm', { councilId, error: err.message });
  });
  send(connection, 'council:opened', { councilId, members, transcript: [], houseWorkspace, grounds });
  broadcastState(connection, connection.councilRun);
  log.info('council convened', { councilId, members: members.map((m) => m.neumaId) });
};

/**
 * Reopen a dissolved council from the operator's realm record — same
 * members, same lanes (each being's session continues under the same
 * councilId), the recent exchange restored to the room and to every
 * turn's prompt context. Hands come back at rest: a reopened room starts
 * listening, not mid-sentence.
 */
// impure
export const councilResume = async (connection, message, { ownsNeumaLane }, deps = defaultDeps) => {
  if (connection.councilRun && !connection.councilRun.closed) {
    return refuse(connection, 'ALREADY_OPEN', 'A council already sits on this link — close it first');
  }
  let record;
  try {
    record = await readCouncilRecord(connection.walletAddress, message.councilId);
  } catch (err) {
    return refuse(connection, 'BAD_RECORD', err.message);
  }
  if (!record) {
    return refuse(connection, 'NO_RECORD', 'No council record stands under that name');
  }
  const seats = await gatherSeats(connection, record.meta.members.map((m) => m.neumaId), ownsNeumaLane);
  if (seats.refusal) return refuse(connection, seats.refusal.code, seats.refusal.message);
  // Undelivered words stay in the record but out of the rehydrated room —
  // the floor never heard them, so the resumed transcript must not either.
  // `at` (when the turn entered the record) rides along for the room's
  // clock stamps; the prompt renderer reads only name/content.
  const transcript = record.turns
    .filter((t) => !t.undelivered)
    .map(({ speaker, name, content, at }) => ({ speaker, name, content, ...(at ? { at } : {}) }));
  const [houseWorkspace, grounds] = await Promise.all([
    houseGround(connection, deps),
    resolveGrounds(connection.walletAddress, seats.members, deps, focusGroundOf(connection)),
  ]);
  connection.councilRun = makeRun(connection, {
    councilId: record.meta.councilId,
    members: seats.members,
    witnessName: record.meta.witnessName || 'Witness',
    transcript,
    houseWorkspace,
    grounds,
  }, deps);
  send(connection, 'council:opened', {
    councilId: record.meta.councilId,
    members: seats.members,
    transcript,
    houseWorkspace,
    grounds,
  });
  broadcastState(connection, connection.councilRun);
  log.info('council reopened', { councilId: record.meta.councilId, turns: transcript.length });
};

/** The shelf of this wallet's councils — for the PAST COUNCILS register. */
// impure
export const councilList = async (connection) => {
  try {
    const councils = await listCouncilRecords(connection.walletAddress);
    send(connection, 'council:list', { councils });
  } catch (err) {
    refuse(connection, 'LIST_FAILED', err.message);
  }
};

/** The operator speaks — 'now' interjects at the next boundary, 'hold' waits its turn. */
// impure
export const councilSay = async (connection, message) => {
  const run = connection.councilRun;
  if (!run || run.closed) return refuse(connection, 'NO_COUNCIL', 'No council sits on this link');
  // The ground follows the Explorer between turns: move the focus mid-sitting
  // and the next seat to take the floor works the folder now on screen. Each
  // seat's ground is re-read from this at the top of its turn (refreshGround).
  run.focusGround = focusGroundOf(connection);
  const thought = String(message.thought ?? '').trim();
  if (!thought) return;
  if (thought.length > SAY_MAX_CHARS) {
    return refuse(connection, 'SAY_TOO_LONG',
      `The room holds ${SAY_MAX_CHARS} characters a word — this one runs ${thought.length}. Split it; nothing was sent.`);
  }
  const urgency = message.urgency === 'now' ? 'now' : 'hold';
  run.calledToOrder = false; // the witness's word always reopens the flow
  run.state = witnessSays(run.state, { content: thought, urgency });
  broadcastState(connection, run);
  await pump(connection, run, run.deps);
};

/** The operator cuts the floor holder mid-word — same seam as chat's interrupt. */
// impure
export const councilInterrupt = (connection) => {
  connection.councilRun?.activeAbort?.abort();
};

/**
 * THE GAVEL — the operator calls the room to order (the Escape ladder's
 * FOURTH rung; Founder's law 2026-07-23: […]). Stronger than INTERRUPT in every direction, and IMMEDIATE:
 *   - the floor holder's stream is cut (their spoken words stand, as ever),
 *   - the hand round is cut — in-flight asks aborted at the wire, the queue
 *     drained: nobody keeps considering,
 *   - every hand goes to rest and the speaking line empties (the derailed
 *     thread is cut; a thought that still matters re-raises against the
 *     operator's NEXT word — the very next say re-polls everyone),
 *   - the carry goes quiet until the operator speaks again (an ordered room
 *     never […] it was just ordered out of),
 *   - the operator's own queued words STAND — order is called to be heard.
 */
// impure
export const councilOrder = (connection) => {
  const run = connection.councilRun;
  if (!run || run.closed) return;
  // The flag steers only a pump already in flight (skip its follow-up hand
  // round). Set on an idle room it would go stale and swallow the round
  // after the operator's NEXT word — a room ordered into permanent silence.
  if (run.pumping) run.calledToOrder = true;
  clearTimeout(run.carryTimer);
  run.carryPending = false;
  run.carried = true; // no carry until the witness's next word re-arms it
  run.activeAbort?.abort();
  run.handAbort?.abort();
  run.considering?.clear();
  run.state = calledToOrder(run.state);
  log.info('the operator calls the room to order', { councilId: run.councilId });
  broadcastState(connection, run);
  send(connection, 'council:order', {});
};

/** The room closes — a CLOSED sitting, not a deleted one: the record
 *  stands in every member's lane and the operator's realm, ready to reopen.
 *  Before teardown the operator queue drains into the record (marked
 *  undelivered, seq order) — words the operator sent are never silently
 *  dropped (CQ-029 #193). */
// impure
export const closeCouncil = async (connection) => {
  const run = connection.councilRun;
  if (!run || run.closed) return;
  run.closed = true;
  clearTimeout(run.carryTimer);
  run.activeAbort?.abort();
  const undelivered = [...run.state.witnessQueue].sort((a, b) => a.seq - b.seq);
  for (const m of undelivered) {
    await persistUtterance(run, {
      speaker: 'witness',
      name: run.witnessName,
      content: m.content,
      undelivered: true,
    });
  }
  send(connection, 'council:closed', {
    councilId: run.councilId,
    ...(undelivered.length ? { undelivered: undelivered.length } : {}),
  });
  connection.councilRun = null;
  log.info('council closed', {
    councilId: run.councilId,
    ...(undelivered.length ? { undelivered: undelivered.length } : {}),
  });
};
