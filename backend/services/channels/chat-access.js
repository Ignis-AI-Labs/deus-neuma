// WHO MAY TALK WITH THE HOUSE — the chat bridge's door (channel connections
// §3.5, default-deny, non-negotiable). Per house, per channel:
//   - a person in a direct chat is heard only once the operator approved
//     them; a stranger gets ONE pairing code back (no turn, no words from a
//     being) and the operator approves or denies that code;
//   - a group is heard only once the operator approved it, and then only a
//     message that names the bot;
//   - an unapproved sender's further messages get nothing back while their
//     code stands, and a sender past PAIR_ATTEMPTS_MAX in a code's hour is
//     dropped silently (logged by the caller) — nothing to brute-force.
// The record: { allowed: [{kind: 'user'|'group', id, name, by, at}],
//               pending: [{code, kind, id, name, chat, at, attempts}] }
// PURE, but for the pairing code's randomness.

import crypto from 'crypto';

export const PAIR_TTL_MS = 60 * 60 * 1000;
export const PAIR_ATTEMPTS_MAX = 5;
export const PENDING_MAX = 20;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

/** An eight-character code, about 40 bits. Pure but for its randomness. */
export const pairingCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');

/** The empty record. pure. */
export const emptyAccess = () => ({ allowed: [], pending: [] });

// pure — who an event is, for the door: the person in a direct chat, the group otherwise.
const subjectOf = (event) => (event.chat.type === 'dm'
  ? { kind: 'user', id: event.user.id, name: event.user.name || `user ${event.user.id}` }
  : { kind: 'group', id: event.chat.id, name: event.chat.title || `group ${event.chat.id}` });

// pure — the record without codes past their hour.
const live = (access, nowMs) => ({ ...access, pending: access.pending.filter((p) => nowMs - Date.parse(p.at) < PAIR_TTL_MS) });

/**
 * What the door does with one inbound event. pure.
 * @param {object} access - the channel's record
 * @param {object} event - a MessageEvent; `mentioned` says a group message named the bot
 * @param {{nowMs: number, mentioned?: boolean, code?: string}} at - code: the fresh code, should one be needed
 * @returns {{door: 'hear'} | {door: 'pair', code: string, access: object} | {door: 'quiet', access: object, why: string}}
 */
export const atTheDoor = (access, event, { nowMs, mentioned = false, code = pairingCode() }) => {
  const subject = subjectOf(event);
  const fresh = live(access, nowMs);
  if (subject.kind === 'group' && !mentioned) return { door: 'quiet', access: fresh, why: 'a group message that does not name the bot' };
  if (fresh.allowed.some((a) => a.kind === subject.kind && a.id === subject.id)) return { door: 'hear' };
  const standing = fresh.pending.find((p) => p.kind === subject.kind && p.id === subject.id);
  if (standing) {
    const pending = fresh.pending.map((p) => (p === standing ? { ...p, attempts: p.attempts + 1 } : p));
    return { door: 'quiet', access: { ...fresh, pending }, why: standing.attempts + 1 > PAIR_ATTEMPTS_MAX ? 'past its attempts — dropped' : 'its code waits on the operator' };
  }
  if (fresh.pending.length >= PENDING_MAX) return { door: 'quiet', access: fresh, why: 'too many codes wait on the operator' };
  const entry = { code, kind: subject.kind, id: subject.id, name: String(subject.name).slice(0, 80), chat: { id: event.chat.id, type: event.chat.type }, at: new Date(nowMs).toISOString(), attempts: 1 };
  return { door: 'pair', code, access: { ...fresh, pending: [...fresh.pending, entry] } };
};

/** The words the bot sends a stranger with their code — the platform's, never a being's. pure. */
export const pairingWords = (houseName, code) => `Hello. To talk with ${houseName} here, ask its operator to approve this code: ${code}. Until then nothing you send is read.`;

/**
 * The operator's answer to a code. pure.
 * @returns {{ok: true, access: object, entry: object} | {ok: false, reason: string}}
 */
export const answerCode = (access, { code, approve, by, nowMs }) => {
  const fresh = live(access, nowMs);
  const entry = fresh.pending.find((p) => p.code === String(code ?? '').trim().toUpperCase());
  if (!entry) return { ok: false, reason: 'no such code waits — it may have passed its hour' };
  const pending = fresh.pending.filter((p) => p !== entry);
  if (!approve) return { ok: true, entry, access: { ...fresh, pending } };
  const allowed = [...fresh.allowed.filter((a) => !(a.kind === entry.kind && a.id === entry.id)), { kind: entry.kind, id: entry.id, name: entry.name, by, at: new Date(nowMs).toISOString() }];
  return { ok: true, entry, access: { allowed, pending } };
};

/** The operator takes someone off the list. pure. */
export const revoke = (access, { kind, id }) => ({ ...access, allowed: access.allowed.filter((a) => !(a.kind === kind && a.id === String(id))) });
