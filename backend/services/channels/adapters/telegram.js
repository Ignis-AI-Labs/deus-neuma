// THE TELEGRAM ADAPTER (channel connections C-03) — the house's own bot,
// the one it already posts with (social channel credentials), now also
// hearing what people send it: Telegram's Bot API, long-polled with plain
// fetch (no SDK). One adapter per house; the bridge turns each message into
// a real turn for the bot's holder, and its answer goes back here.
// A message from a person to the bot is a direct chat; a group message is
// handed on only with `mentioned` true when it names the bot or answers it.
// The test door: NEUMA_TELEGRAM_API_ROOT points the adapter at a loopback
// server shaped like Telegram's (read per call).
// impure (network); normalize and the request builders are pure.

import { makeMessageEvent, makeSendResult } from '../adapter-contract.js';

const TOKEN = /^\d{8,10}:[A-Za-z0-9_-]{35}$/;
const POLL_SECONDS = 25;
const apiRoot = () => process.env.NEUMA_TELEGRAM_API_ROOT || 'https://api.telegram.org';
const url = (token, method) => `${apiRoot()}/bot${token}/${method}`;

/** A Telegram update as the bridge's MessageEvent, with whether it named the bot — or null. pure. */
export const normalizeTelegram = (update, { connectionId, bot }) => {
  const m = update?.message;
  if (!m || typeof m.text !== 'string' || !m.text.trim() || m.from?.is_bot) return null;
  const dm = m.chat?.type === 'private';
  const names = (m.entities ?? []).filter((e) => e.type === 'mention').map((e) => m.text.slice(e.offset, e.offset + e.length).toLowerCase());
  const mentioned = dm || names.includes(`@${String(bot.username ?? '').toLowerCase()}`) || m.reply_to_message?.from?.id === bot.id;
  const event = makeMessageEvent({
    channelId: 'telegram', connectionId,
    chat: { id: String(m.chat.id), type: dm ? 'dm' : 'group', ...(m.message_thread_id ? { threadId: String(m.message_thread_id) } : {}) },
    user: { id: String(m.from?.id ?? m.chat.id), name: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || '' },
    text: m.text, messageId: String(m.message_id),
    ...(m.reply_to_message ? { replyToId: String(m.reply_to_message.message_id) } : {}),
  });
  return { event, mentioned };
};

/** The sendMessage body for one answer. pure. */
export const telegramReply = (chatRef, text, { replyTo } = {}) => ({
  chat_id: chatRef.id, text,
  ...(chatRef.threadId ? { message_thread_id: Number(chatRef.threadId) } : {}),
  ...(replyTo ? { reply_parameters: { message_id: Number(replyTo), allow_sending_without_reply: true } } : {}),
});

// impure — one Bot API call, its JSON answer.
const call = async (token, method, { body, signal, timeoutMs = 15_000 } = {}) => {
  const res = await fetch(url(token, method), {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({ ok: false, description: `Telegram answered ${res.status}` }));
  return { status: res.status, json };
};

/** A Telegram adapter for one house's bot. */
export const createTelegramAdapter = ({ connectionId }) => {
  let token = null;
  let stop = null;
  return {
    id: 'telegram',
    capabilities: Object.freeze({ editMessages: false, threads: true, media: false }),
    limits: Object.freeze({ maxMessageUnits: 4096, perChatPerSec: 1, globalPerSec: 25 }),
    checkRequirements: (credentials) => (TOKEN.test(String(credentials?.botToken ?? ''))
      ? { ok: true } : { ok: false, reason: 'the Telegram bot token is not set, or is not a bot token (digits, a colon, 35 characters)' }),

    /**
     * Hear the bot until the signal aborts. Resolves on abort; rejects on a
     * refusal no retry mends (a revoked token). impure.
     */
    connect: async ({ credentials, onEvent, signal }) => {
      token = credentials.botToken;
      const local = new AbortController();
      stop = () => local.abort();
      const both = AbortSignal.any([signal, local.signal]);
      const me = await call(token, 'getMe', { signal: both });
      if (!me.json.ok) throw new Error(`Telegram refused the bot token: ${me.json.description ?? me.status}`);
      const bot = me.json.result;
      let offset = 0;
      while (!both.aborted) {
        let got;
        try {
          got = await call(token, `getUpdates?offset=${offset}&timeout=${POLL_SECONDS}&allowed_updates=${encodeURIComponent('["message"]')}`, { signal: both, timeoutMs: (POLL_SECONDS + 10) * 1000 });
        } catch (err) {
          if (both.aborted) return;
          throw err;
        }
        if (got.status === 401 || got.status === 404) throw new Error(`Telegram refused the bot: ${got.json.description ?? got.status}`);
        if (!got.json.ok) throw new Error(`Telegram getUpdates failed: ${got.json.description ?? got.status}`);
        for (const update of got.json.result ?? []) {
          offset = Math.max(offset, update.update_id + 1);
          const heard = normalizeTelegram(update, { connectionId, bot });
          if (heard) await onEvent(heard.event, { mentioned: heard.mentioned });
        }
      }
    },
    disconnect: () => { stop?.(); },

    /** One answer back to the chat. impure. */
    send: async (chatRef, text, opts = {}) => {
      try {
        const { json } = await call(token, 'sendMessage', { body: telegramReply(chatRef, text, opts) });
        if (json.ok) return makeSendResult({ success: true, messageId: String(json.result?.message_id ?? '') });
        const retryAfter = Number(json.parameters?.retry_after);
        return makeSendResult({ success: false, error: json.description || 'Telegram refused the message', retryable: Number.isFinite(retryAfter), ...(Number.isFinite(retryAfter) ? { retryAfterMs: retryAfter * 1000 } : {}) });
      } catch (err) {
        return makeSendResult({ success: false, error: err.message, retryable: true });
      }
    },
  };
};
