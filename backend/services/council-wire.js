// council-wire.js — the room's frames, one door out.
//
// Split out of council-session.js under the 500-line law (SIZE-027 #374):
// every council:* frame the room emits leaves through these three functions,
// so the engine, the guard, and the commands share one socket idiom.

import { speakingOrder } from '../../core/index.js';
import { createLogger } from './logger.js';

const log = createLogger('Council');

export const send = (connection, type, payload = {}) => {
  try {
    connection.ws.send(JSON.stringify({ type, ...payload }));
  } catch (err) {
    log.warn('council frame lost — socket refused it', { type, error: err.message });
  }
};

export const refuse = (connection, code, message) => send(connection, 'council:error', { code, message });

export const broadcastState = (connection, run) => {
  const s = run.state;
  // The speaking line, numbered from 1 = next: every raised hand carries
  // its place in the grant order (an OPEN raised late still outranks an
  // early HOLD — the number makes the jump legible instead of confusing),
  // and the operator's first queued word carries theirs.
  const line = speakingOrder(s);
  const orderOf = (neumaId) => {
    const i = line.findIndex((e) => e.kind === 'member' && e.neumaId === neumaId);
    return i === -1 ? null : i + 1;
  };
  const witnessAt = line.findIndex((e) => e.kind === 'witness');
  send(connection, 'council:state', {
    floor: s.floor ? s.floor.speaker : null,
    hands: s.members.map((m) => ({
      neumaId: m.neumaId,
      hand: s.hands[m.neumaId]?.hand ?? 'rest',
      ...(s.hands[m.neumaId]?.note ? { note: s.hands[m.neumaId].note } : {}),
      ...(orderOf(m.neumaId) ? { order: orderOf(m.neumaId) } : {}),
    })),
    witnessQueue: s.witnessQueue.length,
    ...(witnessAt === -1 ? {} : { witnessOrder: witnessAt + 1 }),
    // Who is weighing a hand right now — the room's thinking made visible,
    // so a hand round reads as consideration, never as dead air.
    considering: [...(run.considering ?? [])],
  });
};
