// turn-keep.js — THE TURN KEPT AS IT GOES: nothing a being says or does in a turn is lost to a
// desk that closes, a crash, or a quit, and a desk that comes back sees the turn where it stands.
//
// Design note, 2026-11-16: […]
//
// Three doors, one record:
//   - AS IT GOES: every turn's frames are watched at its socket (the portal and the witness seat
//     both send through it); its words, acts, thought stretches, running acts and shadow clone
//     split are written to <lane>/turn-keep/<session>.json, encrypted under the lane's key, at
//     most a second behind. A settled turn's exchange is on the record, and the file goes.
//   - A DESK THAT CAME BACK while the backend lived (a window closed to the tray, a reload): the
//     turn ran on; the desk that opens the chat is sent the turn so far, then every live frame
//     (takeOverTurn — the portal's half is routes/portal-turn-adopt.js).
//   - A BACKEND THAT DIED (a quit, Ctrl+C, a crash, the power): the file outlived it. At the next
//     start (settleCutTurns), at the chat's next read and before its next turn (settleCutTurn), it
//     lands on the record as the take it was — words exactly as far as they got, acts that
//     finished, acts that were running marked cut — and the desk offers CONTINUE.
//
// impure — socket send wrapping, timers, encrypted disk.

import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace, { getWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { getHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { createLogger } from './logger.js';
import { SENDS_WHILE_CLOSED } from './ws-send.js';
import { turnRecordFor, thoughtRecordFor } from './tool-action-record.js';
import { isEphemeralSitting } from './portal-turn-persist.js';
import { worthKeeping, freshKept, foldFrame, hasWork, keptSnapshot, catchUpFrames, cutRecord } from './turn-keep-record.js';

const log = createLogger('TurnKeep');
const OPEN = 1; // WebSocket.OPEN
/** How far behind the turn the file on disk may fall. */
export const KEEP_EVERY_MS = 1000;
const KEEP_DIR = 'turn-keep';

const sockets = new WeakMap(); // ws → { connection, kept, heirs, timer, writing }
const sittings = new Map(); // lane + session → the socket state whose turn runs there
const landing = new Map(); // lane + session → a cut turn being written to the record (one writer)

const sittingKey = (neumaId, sessionId) => `${neumaId}\u0000${sessionId}`;

// impure (resolves the lane) — the kept turn's file; a session id is guarded like the session file's.
const keepFile = (neumaId, sessionId) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(sessionId))) throw new Error(`Invalid sessionId: ${String(sessionId).slice(0, 40)}`);
  return path.join(neumaWorkspace._path(neumaId), KEEP_DIR, `${sessionId}.json`);
};

// impure — the turn as it stands, written over the last (serialized: one write at a time, in order).
const write = (state) => {
  const kept = state.kept;
  if (!kept || !state.connection?.ws) return state.writing;
  const { ws } = state.connection;
  const snap = keptSnapshot(kept, { tools: turnRecordFor(ws), thoughts: thoughtRecordFor(ws), savedAt: new Date().toISOString() });
  if (!hasWork(snap)) return state.writing;
  const still = () => state.kept?.turnId === kept.turnId && state.kept?.takeIndex === kept.takeIndex;
  state.writing = state.writing
    .then(() => (still() ? neumaWorkspace._writeJSON(keepFile(kept.neumaId, kept.sessionId), snap) : null))
    .catch((err) => log.warn('the turn could not be kept on disk', { neumaId: kept.neumaId, err: err.message }));
  return state.writing;
};

const soon = (state) => {
  if (state.timer) return;
  state.timer = setTimeout(() => { state.timer = null; write(state); }, KEEP_EVERY_MS);
  state.timer.unref?.();
};

// impure — the turn settled (its exchange is on the record): stop keeping it, and remove its file
// once any write in flight has landed.
const release = (state) => {
  const kept = state.kept;
  if (!kept) return;
  state.kept = null;
  clearTimeout(state.timer);
  state.timer = null;
  const key = sittingKey(kept.neumaId, kept.sessionId);
  if (sittings.get(key) === state) sittings.delete(key);
  if (state.connection?.ws) state.connection.ws[SENDS_WHILE_CLOSED] = false;
  state.writing = state.writing
    .then(() => fs.rm(keepFile(kept.neumaId, kept.sessionId), { force: true }))
    .catch((err) => log.warn('a settled turn\'s kept file was not removed', { neumaId: kept.neumaId, err: err.message }));
};

// impure — a closed desk's frames reach the desks that took its chat over.
const relay = (state, data) => {
  for (const heir of state.heirs) {
    if (heir.ws?.readyState === OPEN) heir.ws.send(data);
    else state.heirs.delete(heir);
  }
};

// impure — the socket's send, watched once for the life of the socket.
const tap = (connection) => {
  const { ws } = connection;
  const known = sockets.get(ws);
  if (known) return known;
  const state = { connection, kept: null, heirs: new Set(), timer: null, writing: Promise.resolve() };
  sockets.set(ws, state);
  const inner = ws.send;
  ws.send = (data, ...rest) => {
    if (state.kept && worthKeeping(data)) {
      let frame = null;
      try { frame = JSON.parse(data); } catch { /* not a frame of ours */ }
      if (frame) {
        state.kept = foldFrame(state.kept, frame);
        if (state.kept.settled) release(state);
        else soon(state);
      }
    }
    if (state.heirs.size && ws.readyState !== OPEN) relay(state, data);
    return inner.call(ws, data, ...rest);
  };
  return state;
};

/**
 * impure — keep this turn as it goes. Called once a turn knows its lane, session and take, BEFORE
 * its point lands: a turn a crash cut in this chat goes on the record first, in its place.
 * @param {Object} connection - the portal connection the turn runs on
 * @param {{ neumaId: string, sessionId: string, take: { turnId: string, takeIndex: number } }} turn
 */
export const keepTurn = async (connection, { neumaId, sessionId, take }) => {
  if (!connection?.ws || !neumaId || !sessionId || !take?.turnId || isEphemeralSitting(connection)) return;
  try {
    await settleCutTurn(neumaId, sessionId);
    const state = tap(connection);
    state.connection = connection;
    release(state); // a turn of this socket that never said it settled
    state.kept = freshKept({ neumaId, sessionId, take, startedAt: new Date().toISOString() });
    sittings.set(sittingKey(neumaId, sessionId), state);
    connection.ws[SENDS_WHILE_CLOSED] = true;
  } catch (err) {
    // Never the turn's failure: it runs unkept, and says so.
    log.warn('the turn runs unkept', { neumaId, err: err.message });
  }
};

/**
 * impure — a desk opening a chat whose turn is still running on a desk that closed takes it over:
 * the frames that draw the turn so far (send them at once, before anything else can arrive), and
 * from now on every frame the turn sends. null when no closed desk's turn runs in that chat.
 * @returns {{ from: Object, frames: Array<Object> }|null}
 */
export const takeOverTurn = (heir, neumaId, sessionId) => {
  const state = sittings.get(sittingKey(neumaId, sessionId));
  if (!state || !state.kept || state.connection === heir) return null;
  if (state.connection.ws?.readyState === OPEN) return null; // its own desk still watches it
  state.heirs.add(heir);
  return { from: state.connection, frames: catchUpFrames(state.kept) };
};

/** impure — STOP on a desk that took a turn over cuts that turn, running or waiting its place in line. */
export const stopTakenTurn = (connection) => {
  const from = connection.adoptedFrom;
  if (!from) return false;
  if (from.activeTurn) from.activeTurn.abort();
  else if (from.turnPromise) { from.interruptRequested = true; from.lineWait?.abort(); }
  return true;
};

/**
 * impure — an interjection ("now", SEND NOW) on a desk that took a turn over: the turn is cut, the
 * closed desk's drain ends with it, and the words it still held go on from here, ahead of this
 * desk's own — never two turns in one chat at once.
 */
export const cutTakenTurn = (connection) => {
  const from = connection.adoptedFrom;
  if (!from) return false;
  from.drainEpoch = (from.drainEpoch || 0) + 1;
  connection.pendingThoughts = [...(from.pendingThoughts ?? []), ...(connection.pendingThoughts ?? [])];
  from.pendingThoughts = [];
  return stopTakenTurn(connection);
};

/** impure — the desk stops watching the turn it took over (it opened another chat); the turn runs on. */
export const releaseTakenTurn = (connection) => {
  const from = connection.adoptedFrom;
  if (!from) return;
  if (from.ws) sockets.get(from.ws)?.heirs.delete(connection);
  connection.adoptedFrom = null;
  if (connection.turnPromise && connection.turnPromise === connection.adoptedPromise) connection.turnPromise = null;
  connection.adoptedPromise = null;
};

/** impure — every running turn written down now (the backend is going down). */
export const keepTurnsNow = () => Promise.all([...sittings.values()].map((state) => {
  clearTimeout(state.timer);
  state.timer = null;
  return write(state);
}));

// impure — a cut turn's file onto the record as the take it was; the file goes either way.
const landCut = async (neumaId, sessionId) => {
  const file = keepFile(neumaId, sessionId);
  let snap;
  try {
    snap = await neumaWorkspace._readJSON(file);
  } catch (err) {
    if (err?.code !== 'ENOENT') log.warn('a kept turn could not be read — left on disk', { neumaId, sessionId, err: err.message });
    return null;
  }
  const rows = await neumaWorkspace.readSession(neumaId, sessionId);
  // Settled after all (the file outlived its exchange by a moment): the record already has it.
  const answered = rows.some((r) => r?.role === 'assistant' && r.turnId === snap.turnId && Number(r.takeIndex) >= snap.takeIndex);
  const landed = !answered && hasWork(snap)
    ? await neumaWorkspace.appendTake(neumaId, sessionId, snap.turnId, snap.takeIndex, cutRecord(snap))
    : null;
  await fs.rm(file, { force: true });
  if (landed) {
    log.info('a turn the app cut short is back on the record', {
      neumaId, sessionId, chars: snap.words?.length ?? 0, acts: snap.tools?.length ?? 0, running: snap.acting?.length ?? 0,
    });
  }
  return landed;
};

/**
 * impure — a turn the app's close cut in this chat, onto the record (null when there is none, or
 * when its turn is still running here). Safe from any door at once: one writer per chat.
 */
export const settleCutTurn = (neumaId, sessionId) => {
  const key = sittingKey(neumaId, sessionId);
  if (sittings.has(key)) return Promise.resolve(null);
  if (landing.has(key)) return landing.get(key);
  const run = landCut(neumaId, sessionId).finally(() => landing.delete(key));
  landing.set(key, run);
  return run;
};

// impure — the lanes on a ground, by the one resolver every lane path goes through.
const lanesOn = async (ground) => {
  const entries = await fs.readdir(ground, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).filter((name) => {
    try { return neumaWorkspace._path(name) === path.resolve(ground, name); } catch { return false; }
  });
};

/** impure — every chat's cut turn, onto the record (the backend's start). Returns how many landed. */
export const settleCutTurns = async () => {
  const root = neumaWorkspace.root;
  const grounds = [...new Set([root, getWitnessesRoot(), getHarnessRoot(root)].filter(Boolean))];
  let landed = 0;
  for (const ground of grounds) {
    for (const lane of await lanesOn(ground)) {
      const names = await fs.readdir(path.join(ground, lane, KEEP_DIR)).catch(() => []);
      for (const name of names.filter((n) => n.endsWith('.json'))) {
        const take = await settleCutTurn(lane, name.slice(0, -'.json'.length))
          .catch((err) => { log.warn('a cut turn could not be landed', { lane, err: err.message }); return null; });
        if (take) landed += 1;
      }
    }
  }
  return landed;
};
