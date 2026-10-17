// held-thoughts.js — the operator's held words (MID-STREAM SPEECH, Founder
// 2026-07-26; THE HELD WORD STAYS THE OPERATOR'S, Design note, 2026-08-16.
//
// A word sent mid-turn HOLDS on the connection (`pendingThoughts`) until the
// drain delivers it. Until then it is still the operator's: three doors —
// rewrite it where it stands (queue_edit), promote it to NOW (queue_now), or
// pull it home to the composer (queue_pull) — none touching the flow in
// flight. Every door answers with the queue's SERVER truth; the desk
// repaints from acks, never from its own optimism.

// Bounded: a queue that grows without limit is a way to spend a being's
// context on a backlog nobody remembers writing.
export const MAX_HELD_THOUGHTS = 8;

// A client-minted handle for one held word — opaque here, bounded, echoed on
// the queue ack so the desk can address THIS word later.
export const HOLD_ID_PATTERN = /^[a-zA-Z0-9-]{1,40}$/;

export const queueThought = (connection, message) => {
  connection.pendingThoughts ||= [];
  if (connection.pendingThoughts.length >= MAX_HELD_THOUGHTS) {
    connection.pendingThoughts.shift(); // oldest falls out; the newest intent wins
  }
  connection.pendingThoughts.push(message);
};

/** Remove and return one held word — by handle, or the newest WORDED one
 *  (a queued retry take carries no words to pull). null when gone. */
export const takeHeldThought = (connection, holdId = null) => {
  const held = connection.pendingThoughts || [];
  const index = holdId == null
    ? held.findLastIndex((entry) => typeof entry.thought === 'string')
    : held.findIndex((entry) => entry.holdId === holdId);
  if (index < 0) return null;
  return held.splice(index, 1)[0];
};

/** Rewrite a held word in place — words only, attachments ride unchanged.
 *  False when the word is gone (the drain took it) or carries no words. */
export const editHeldThought = (connection, holdId, thought) => {
  const entry = (connection.pendingThoughts || []).find((held) => held.holdId === holdId);
  if (!entry || typeof entry.thought !== 'string') return false;
  entry.thought = thought;
  return true;
};

const validHoldId = (raw) => (HOLD_ID_PATTERN.test(String(raw ?? '')) ? raw : null);

/** The drain took a held word — its bubble stops offering queue controls. */
export const announceTakenThought = (connection, taken) => {
  if (!taken?.holdId) return;
  connection.ws?.send(JSON.stringify({
    type: 'consciousness:queue_taken',
    holdId: taken.holdId,
    held: connection.pendingThoughts.length,
  }));
};

/**
 * The three queue doors, dispatched by frame type. `doors` carries the
 * router's own machinery: rateLimited() (queue_now starts a turn), settle()
 * (the urgent-send settling law), run(message) (the SAME drain path a fresh
 * send walks — nothing about a promoted word is second-class). impure.
 */
export const handleHeldQueueOp = async (connection, ws, message, doors) => {
  const holdId = validHoldId(message.holdId);
  const held = () => connection.pendingThoughts?.length || 0;
  switch (message.type) {
    case 'consciousness:queue_edit': {
      const words = typeof message.thought === 'string'
        ? message.thought.trim().slice(0, 20000) : '';
      const ok = Boolean(holdId && words && editHeldThought(connection, holdId, words));
      // The ack echoes the words the queue now holds; ok:false = the drain
      // already took the word, and the bubble stands down.
      ws.send(JSON.stringify({
        type: 'consciousness:queue_edited',
        holdId,
        ok,
        ...(ok ? { thought: words } : {}),
        held: held(),
      }));
      return;
    }
    case 'consciousness:queue_now': {
      // Promote: the held word leaves the queue and INTERJECTS. Already
      // drained? The taken ack stands the bubble down; nothing runs twice.
      if (doors.rateLimited()) return;
      const taken = holdId ? takeHeldThought(connection, holdId) : null;
      ws.send(JSON.stringify({ type: 'consciousness:queue_taken', holdId, held: held() }));
      if (!taken) return;
      if (connection.turnPromise) await doors.settle();
      await doors.run(taken);
      return;
    }
    case 'consciousness:queue_pull': {
      // Escape's recall: the newest (or named) held word leaves the queue;
      // its words come home to be reworked. Attachments do not ride the
      // composer road — the in-bubble edit is the road that keeps them.
      const taken = takeHeldThought(connection, holdId);
      ws.send(JSON.stringify({
        type: 'consciousness:queue_pulled',
        holdId: taken?.holdId ?? null,
        thought: typeof taken?.thought === 'string' ? taken.thought : '',
        held: held(),
      }));
      return;
    }
    default:
      throw new Error(`held-thoughts cannot answer ${message.type}`);
  }
};
