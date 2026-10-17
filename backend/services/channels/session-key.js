// Session keys — the single source of truth mapping a platform conversation
// to a neuma session (C-01). Deterministic and TYPED: the string form is
// derived, never hand-assembled (OpenClaw's load-bearing-string warning).
// Shape: platform:chatType:chatId[:t~threadId][:u~userId] — the optional
// parts are TAGGED because they are independently optional: an untagged
// 4-part key could not say whether its tail was a thread or a user. Pure.

// A component may contain ':' or '~' on some future platform — escape so
// the string form stays unambiguous and parseable.
const enc = (s) => String(s).replace(/%/g, '%25').replace(/:/g, '%3A').replace(/~/g, '%7E');
const dec = (s) => s.replace(/%7E/g, '~').replace(/%3A/g, ':').replace(/%25/g, '%');

/**
 * Build the session key for a normalized event.
 * Toggles (per-connection config):
 *  - groupSessionsPerUser: each user in a group gets their own session
 *  - threadSessions: a thread is its own session (else it joins the chat's)
 * @param {{ channelId: string, chat: { id: string, type: string, threadId?: string }, user: { id: string } }} event
 * @param {{ groupSessionsPerUser?: boolean, threadSessions?: boolean }} [opts]
 * @returns {Readonly<{ platform: string, chatType: string, chatId: string, threadId: string|null, userId: string|null, key: string }>}
 */
export const buildSessionKey = (event, { groupSessionsPerUser = false, threadSessions = true } = {}) => {
  const { channelId, chat, user } = event;
  const threadId = threadSessions && chat.threadId != null ? String(chat.threadId) : null;
  const userId = chat.type !== 'dm' && groupSessionsPerUser ? String(user.id) : null;
  const parts = [enc(channelId), enc(chat.type), enc(chat.id)];
  if (threadId !== null) parts.push(`t~${enc(threadId)}`);
  if (userId !== null) parts.push(`u~${enc(userId)}`);
  return Object.freeze({
    platform: channelId,
    chatType: chat.type,
    chatId: String(chat.id),
    threadId,
    userId,
    key: parts.join(':'),
  });
};

/**
 * Parse a key string back to its typed form.
 * @param {string} key
 * @returns {Readonly<object>|null} null on malformed input
 */
export const parseSessionKey = (key) => {
  if (typeof key !== 'string') return null;
  const parts = key.split(':');
  if (parts.length < 3 || parts.length > 5 || parts.some((p) => p.length === 0)) return null;
  const [platform, chatType, chatId] = parts.slice(0, 3).map(dec);
  let threadId = null;
  let userId = null;
  for (const tail of parts.slice(3)) {
    if (tail.startsWith('t~') && threadId === null) threadId = dec(tail.slice(2));
    else if (tail.startsWith('u~') && userId === null) userId = dec(tail.slice(2));
    else return null; // untagged or duplicated tail — not a key we minted
  }
  return Object.freeze({ platform, chatType, chatId, threadId, userId, key });
};
