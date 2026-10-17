// Channel adapter contract — the shapes every transport speaks (C-01).
//
// One normalized boundary: adapters convert platform events INTO
// MessageEvent and outbound results INTO SendResult; the shared pipeline
// (bridge, segmenter, limiter) never sees platform specifics. The contract
// is deliberately four slots (config, inbound, outbound, lifecycle) plus
// capability/limit declarations — it grows only under need. Pure.

export const CHAT_TYPES = Object.freeze(['dm', 'group', 'thread']);

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/**
 * Normalized inbound message — the ONLY shape the bridge accepts.
 * `chat` doubles as the outbound chatRef: the bridge passes event.chat
 * straight back to adapter.send, one type for both halves.
 * @param {object} raw
 * @returns {Readonly<object>}
 * @throws {Error} on a malformed event — an adapter bug must fail loudly
 *   at the boundary, never propagate a half-shaped event into the pipeline.
 */
export const makeMessageEvent = (raw) => {
  const { channelId, connectionId, chat, user, text, messageId, replyToId, raw: platformRaw } = raw || {};
  if (!isNonEmptyString(channelId)) throw new Error('MessageEvent: channelId required');
  if (!isNonEmptyString(connectionId)) throw new Error('MessageEvent: connectionId required');
  if (!chat || !isNonEmptyString(String(chat.id ?? '')) || !CHAT_TYPES.includes(chat.type)) {
    throw new Error('MessageEvent: chat { id, type dm|group|thread } required');
  }
  if (!user || !isNonEmptyString(String(user.id ?? ''))) throw new Error('MessageEvent: user.id required');
  if (typeof text !== 'string') throw new Error('MessageEvent: text must be a string');
  if (!isNonEmptyString(String(messageId ?? ''))) throw new Error('MessageEvent: messageId required');
  return Object.freeze({
    channelId,
    connectionId,
    chat: Object.freeze({
      id: String(chat.id),
      type: chat.type,
      ...(chat.threadId != null ? { threadId: String(chat.threadId) } : {}),
    }),
    user: Object.freeze({ id: String(user.id), name: typeof user.name === 'string' ? user.name : '' }),
    text,
    messageId: String(messageId),
    ...(replyToId != null ? { replyToId: String(replyToId) } : {}),
    ...(platformRaw !== undefined ? { raw: platformRaw } : {}),
  });
};

/**
 * Normalized outbound result. `retryable` marks transport-level failures a
 * caller MAY retry; sends are never auto-retried (duplicate delivery is
 * worse than a dropped reply — Hermes pitfall).
 * @param {{ success: boolean, messageId?: string, error?: string, retryable?: boolean, retryAfterMs?: number }} r
 */
export const makeSendResult = ({ success, messageId, error, retryable = false, retryAfterMs } = {}) =>
  Object.freeze({
    success: !!success,
    ...(messageId != null ? { messageId: String(messageId) } : {}),
    ...(error ? { error: String(error) } : {}),
    retryable: !!retryable,
    ...(Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}),
  });

// The slots every adapter must implement; editMessage stays optional
// (enables progressive-edit streaming where the platform supports it).
const REQUIRED_SLOTS = Object.freeze([
  ['id', (v) => isNonEmptyString(v)],
  ['capabilities', (v) => v && typeof v === 'object'],
  ['limits', (v) => v && typeof v === 'object'],
  ['checkRequirements', (v) => typeof v === 'function'],
  ['connect', (v) => typeof v === 'function'],
  ['disconnect', (v) => typeof v === 'function'],
  ['send', (v) => typeof v === 'function'],
]);

/**
 * Validate an adapter against the contract. Pure.
 * @param {object} adapter
 * @returns {{ ok: true } | { ok: false, missing: string[] }}
 */
export const validateAdapter = (adapter) => {
  const missing = REQUIRED_SLOTS
    .filter(([slot, check]) => !check(adapter?.[slot]))
    .map(([slot]) => slot);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
};
