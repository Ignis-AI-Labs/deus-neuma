// substrate-line — the one line in front of the local model server.
//
// Design note, 2026-10-12: […]
//
// The server has a fixed number of slots. Without a line, every chat turn, team member and
// background job sent its requests straight at it: whoever asked between another turn's rounds
// took that turn's slot, so the turn re-read its whole history on its next round (measured: three
// of four slots reading from zero at once), and a request that waited was shown as an overload.
//
// The law here:
//   - A LEASE is held for a whole route — a chat turn's every round, tool and approval wait
//     (Founder's ruling: an approval wait keeps its place; a PARKED one, its portal closed, steps
//     out until answered — substrate-lease.js linePlace) — and released once, when it is done.
//   - At most `capacity` leases run at once: the server's slot count, so a running route always
//     keeps a slot of its own and its cached context stays warm.
//   - People before background: chat turns, team members and house wakes are served first-come,
//     first-served; background jobs (titles, summaries, meditation) run only when no person is waiting.
//   - The house's own work never takes the last slot: team members and house wakes (house-clock/)
//     run at most capacity - 1 at once between them (the operator's slot, f0df1dd39), unless the
//     server has a single slot.
//   - Waiting is honest: a waiter is told its place and who is ahead, every time the line moves.
//   - A heavy job takes the MACHINE (machine-lease.js — while a clip renders, everything else
//     waits): while a 'machine' lease waits nothing new is admitted, so the line drains; it is admitted when nothing runs; while it runs nothing
//     else is. No machine lease in line = the law above, unchanged.
//
// impure (module state is the line's own — one per process, like the server it fronts).

/** @typedef {'turn'|'member'|'wake'|'background'|'machine'} LineKind */

const PEOPLE = new Set(['turn', 'member', 'wake']);
// The house working on its own — a team's members, a seat's wake — beside the operator's chat.
const HOUSE_WORK = new Set(['member', 'wake']);

/**
 * Who goes next, given who runs and who waits. Pure — the whole admission law in one place.
 * @param {{ capacity: number, running: Array<{kind: LineKind}>, waiting: Array<{kind: LineKind}> }} state
 * @returns {number} the index in `waiting` to admit now, or -1
 */
export const nextAdmission = ({ capacity, running, waiting }) => {
  if (waiting.length === 0 || running.some((r) => r.kind === 'machine')) return -1;
  const machine = waiting.findIndex((w) => w.kind === 'machine');
  if (machine >= 0) return running.length === 0 ? machine : -1;
  if (running.length >= capacity) return -1;
  const houseRunning = running.filter((r) => HOUSE_WORK.has(r.kind)).length;
  const houseRoom = capacity <= 1 ? capacity : capacity - 1;
  const peopleWaiting = waiting.some((w) => PEOPLE.has(w.kind));
  for (let i = 0; i < waiting.length; i += 1) {
    const w = waiting[i];
    if (w.kind === 'background' && peopleWaiting) continue;
    if (HOUSE_WORK.has(w.kind) && houseRunning >= houseRoom) continue;
    return i;
  }
  return -1;
};

/**
 * @param {{ capacity: () => number }} opts - the server's slot count, read when the line moves
 */
export const createSubstrateLine = ({ capacity }) => {
  let seq = 0;
  const running = []; // { id, kind, label, neumaId, since }
  const waiting = []; // { id, kind, label, neumaId, since, admit, reject, onWait, signal, onAbort }
  const listeners = new Set();

  const view = (e) => ({ id: e.id, kind: e.kind, label: e.label, neumaId: e.neumaId, since: e.since });
  const snapshot = () => ({ capacity: capacity(), running: running.map(view), waiting: waiting.map(view) });

  // Tell every waiter where it stands — its place, and who is ahead of it (running first).
  const tellWaiters = () => {
    waiting.forEach((w, i) => {
      try {
        w.onWait?.({ position: i + 1, ahead: [...running.map(view), ...waiting.slice(0, i).map(view)] });
      } catch { /* a waiter's own report never stops the line */ }
    });
    const snap = snapshot();
    for (const fn of listeners) { try { fn(snap); } catch { /* a listener never stops the line */ } }
  };

  const pump = () => {
    for (;;) {
      const i = nextAdmission({ capacity: capacity(), running, waiting });
      if (i < 0) break;
      const [w] = waiting.splice(i, 1);
      w.signal?.removeEventListener?.('abort', w.onAbort);
      running.push({ id: w.id, kind: w.kind, label: w.label, neumaId: w.neumaId, since: Date.now() });
      w.admit();
    }
    tellWaiters();
  };

  /**
   * Take a place in line; resolves with a lease once it is this route's turn.
   * @param {{ kind: LineKind, label?: string, neumaId?: string|null, signal?: AbortSignal,
   *   onWait?: (place: {position: number, ahead: Array<object>}) => void }} who
   * @returns {Promise<{ id: number, release: () => void }>}
   */
  const acquire = ({ kind = 'turn', label = '', neumaId = null, signal = null, onWait = null } = {}) => {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
    seq += 1;
    const id = seq;
    let released = false;
    const lease = {
      id,
      release: () => {
        if (released) return;
        released = true;
        const at = running.findIndex((r) => r.id === id);
        if (at >= 0) running.splice(at, 1);
        pump();
      },
    };
    return new Promise((resolve, reject) => {
      const entry = {
        id, kind, label, neumaId, since: Date.now(), onWait, signal,
        admit: () => resolve(lease),
        reject,
        onAbort: () => {
          const at = waiting.findIndex((w) => w.id === id);
          if (at < 0) return;
          waiting.splice(at, 1);
          reject(signal.reason ?? new Error('aborted'));
          pump();
        },
      };
      signal?.addEventListener?.('abort', entry.onAbort, { once: true });
      waiting.push(entry);
      pump();
    });
  };

  /** Watch the line move (the desk's view of who runs and who waits). Returns the unsubscribe. */
  const watch = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  return { acquire, snapshot, watch };
};
