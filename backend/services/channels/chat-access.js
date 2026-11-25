// WHO MAY TALK WITH THE HOUSE — the chat bridge's door (channel connections
// §3.5, default-deny, non-negotiable). Per house, per channel:
//   - a person in a direct chat is heard only once the operator approved
//     them; a stranger gets ONE pairing code back (no turn, no words from a
//     being) and the operator approves or denies that code;
//   - in a group, a person is heard only once the operator approved THAT
//     person in THAT group (audit P6-42: one yes for a group used to admit
//     every member, present and future), and then only a message that names
//     the bot; a group approved before members were recorded admits no one
//     until each asks again;
//   - an unapproved sender's further messages get nothing back while their
//     code stands, and a sender past PAIR_ATTEMPTS_MAX in a code's hour is
//     dropped silently (logged by the caller) — nothing to brute-force.
//   - the operator's OWN one-to-one chat may be marked […] when its
//     code is approved (default off, never a group): that chat alone is not a
//     visitor's (channel-bridge.js); everyone else stays a visitor;
// The record: { allowed: [{kind: 'user'|'group', id, name, members?: [{id, name}], mine?: true, by, at}],
//               pending: [{code, kind, id, senderId, senderName, name, chat, at, attempts}] }
// PURE, but for the pairing code's randomness.

import crypto from 'crypto';

export const PAIR_TTL_MS = 60 * 60 * 1000;
export const PAIR_ATTEMPTS_MAX = 5;
export const PENDING_MAX = 20;
export const PAIR_SENDER_PENDING_MAX = 3;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

/** An eight-character code, about 40 bits. Pure but for its randomness. */
export const pairingCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');

/** The empty record. pure. */
export const emptyAccess = () => ({ allowed: [], pending: [] });

// pure — who an event is, for the door: the person in a direct chat, the group otherwise.
const subjectOf = (event) => (event.chat.type === 'dm'
  ? { kind: 'user', id: event.user.id, name: event.user.name || `user ${event.user.id}` }
  : { kind: 'group', id: event.chat.id, name: event.chat.title || `group ${event.chat.id}` });

// pure — is this the same asker: the person, or this person in this group.
const sameAsker = (subject, userId) => (p) => p.kind === subject.kind && p.id === subject.id
  && (p.kind !== 'group' || String(p.senderId) === String(userId));

// pure — may this person speak under this approval: a person's own, or a group's that names them.
const admits = (a, userId) => a.kind !== 'group' || (a.members ?? []).some((m) => String(m.id) === String(userId));

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
  if (fresh.allowed.some((a) => a.kind === subject.kind && a.id === subject.id && admits(a, event.user.id))) return { door: 'hear' };
  const standing = fresh.pending.find(sameAsker(subject, event.user.id));
  if (standing) {
    const pending = fresh.pending.map((p) => (p === standing ? { ...p, attempts: p.attempts + 1 } : p));
    return { door: 'quiet', access: { ...fresh, pending }, why: standing.attempts + 1 > PAIR_ATTEMPTS_MAX ? 'past its attempts — dropped' : 'its code waits on the operator' };
  }
  const senderPending = fresh.pending.filter((p) => String(p.senderId ?? (p.kind === 'user' ? p.id : '')) === String(event.user.id)).length;
  if (senderPending >= PAIR_SENDER_PENDING_MAX) return { door: 'quiet', access: fresh, why: 'too many codes from this sender wait on the operator' };
  if (fresh.pending.length >= PENDING_MAX) return { door: 'quiet', access: fresh, why: 'too many codes wait on the operator' };
  const entry = { code, kind: subject.kind, id: subject.id, senderId: event.user.id, senderName: String(event.user.name || `user ${event.user.id}`).slice(0, 80), name: String(subject.name).slice(0, 80), chat: { id: event.chat.id, type: event.chat.type }, at: new Date(nowMs).toISOString(), attempts: 1 };
  return { door: 'pair', code, access: { ...fresh, pending: [...fresh.pending, entry] } };
};

/** The words the bot sends a stranger with their code — the platform's, never a being's. pure. */
export const pairingWords = (houseName, code) => `Hello. To talk with ${houseName} here, ask its operator to approve this code: ${code}. Until then nothing you send is read.`;

/**
 * The operator's answer to a code. pure.
 * `mine` marks the approved person as the operator's own account (a one-to-one chat only).
 * @returns {{ok: true, access: object, entry: object} | {ok: false, reason: string, refused?: true}}
 */
export const answerCode = (access, { code, approve, by, nowMs, mine = false }) => {
  const fresh = live(access, nowMs);
  const entry = fresh.pending.find((p) => p.code === String(code ?? '').trim().toUpperCase());
  if (!entry) return { ok: false, reason: 'no such code waits — it may have passed its hour' };
  // […] is one person in a one-to-one chat: a group holds other people, whoever asked.
  if (approve && mine && entry.kind !== 'user') return { ok: false, refused: true, reason: '"this is me" marks a one-to-one chat only, never a group' };
  const pending = fresh.pending.filter((p) => p !== entry);
  if (!approve) return { ok: true, entry, access: { ...fresh, pending } };
  // A group's yes names the one person who asked; the members approved before stay.
  const prior = fresh.allowed.find((a) => a.kind === entry.kind && a.id === entry.id);
  const members = entry.kind === 'group'
    ? [...(prior?.members ?? []).filter((m) => String(m.id) !== String(entry.senderId)), { id: String(entry.senderId), name: entry.senderName || `user ${entry.senderId}` }]
    : null;
  const allowed = [...fresh.allowed.filter((a) => a !== prior), { kind: entry.kind, id: entry.id, name: entry.name, ...(members ? { members } : {}), ...(mine ? { mine: true } : {}), by, at: new Date(nowMs).toISOString() }];
  return { ok: true, entry, access: { allowed, pending } };
};

/**
 * Is this event the operator's own chat: a one-to-one chat with the person the
 * operator marked […] when approving them? pure.
 * @param {object} access - the channel's record
 * @param {object} event - a MessageEvent
 */
export const isOperatorsOwn = (access, event) => event?.chat?.type === 'dm'
  && (access?.allowed ?? []).some((a) => a.kind === 'user' && a.mine === true && String(a.id) === String(event.user?.id));

/** The operator takes someone off the list. pure. */
export const revoke = (access, { kind, id }) => ({ ...access, allowed: access.allowed.filter((a) => !(a.kind === kind && a.id === String(id))) });
