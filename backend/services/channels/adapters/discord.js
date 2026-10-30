// THE DISCORD ADAPTER (channel connections C-06) — the house's own Discord
// bot, the one it already posts with, now also hearing what people send it:
// the Discord Gateway over a WebSocket (the `ws` dependency the backend
// already has) for messages in, one REST call per answer out. A message to
// the bot in a DM is a direct chat; a server message is handed on with
// `mentioned` true only when it names the bot or answers it.
// The test doors: NEUMA_DISCORD_GATEWAY and NEUMA_DISCORD_API_ROOT point the
// adapter at loopback servers shaped like Discord's (read per call).
// impure (network); normalize and the request builders are pure.

import WebSocket from 'ws';
import { makeMessageEvent, makeSendResult } from '../adapter-contract.js';

const TOKEN = /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}$/;
// GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
export const DISCORD_INTENTS = (1 << 9) | (1 << 12) | (1 << 15);
const gatewayUrl = () => process.env.NEUMA_DISCORD_GATEWAY || 'wss://gateway.discord.gg/?v=10&encoding=json';
const apiRoot = () => process.env.NEUMA_DISCORD_API_ROOT || 'https://discord.com/api/v10';
// Gateway close codes no reconnect mends: a bad token, bad intents, a disallowed intent.
const FATAL = new Set([4004, 4013, 4014]);

/** A MESSAGE_CREATE as the bridge's MessageEvent, with whether it named the bot — or null. pure. */
export const normalizeDiscord = (m, { connectionId, bot }) => {
  if (!m || m.author?.bot || typeof m.content !== 'string') return null;
  const dm = !m.guild_id;
  const mentioned = dm || (m.mentions ?? []).some((u) => u.id === bot.id) || m.referenced_message?.author?.id === bot.id;
  const text = m.content.replace(new RegExp(`<@!?${bot.id}>`, 'g'), '').trim();
  if (!text) return null;
  const event = makeMessageEvent({
    channelId: 'discord', connectionId,
    chat: { id: String(m.channel_id), type: dm ? 'dm' : 'group' },
    user: { id: String(m.author.id), name: m.author.global_name || m.author.username || '' },
    text, messageId: String(m.id),
    ...(m.message_reference?.message_id ? { replyToId: String(m.message_reference.message_id) } : {}),
  });
  return { event, mentioned };
};

/** The create-message body for one answer. pure. */
export const discordReply = (text, { replyTo } = {}) => ({
  content: text,
  ...(replyTo ? { message_reference: { message_id: String(replyTo), fail_if_not_exists: false } } : {}),
  allowed_mentions: { parse: [] },
});

/** A Discord adapter for one house's bot. */
export const createDiscordAdapter = ({ connectionId }) => {
  let token = null;
  let socket = null;
  return {
    id: 'discord',
    capabilities: Object.freeze({ editMessages: false, threads: false, media: false }),
    limits: Object.freeze({ maxMessageUnits: 2000, perChatPerSec: 1, globalPerSec: 40 }),
    checkRequirements: (credentials) => (TOKEN.test(String(credentials?.botToken ?? ''))
      ? { ok: true } : { ok: false, reason: 'the Discord bot token is not set, or is not a bot token' }),

    /**
     * Hold the gateway until the signal aborts (resolves) or the line drops
     * (rejects — the supervisor reconnects; a refused token is fatal). impure.
     */
    connect: ({ credentials, onEvent, signal }) => new Promise((resolve, reject) => {
      token = credentials.botToken;
      let seq = null;
      let beat = null;
      let bot = null;
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearInterval(beat);
        try { socket?.close(); } catch { /* already closed */ }
        if (err) reject(err); else resolve();
      };
      socket = new WebSocket(gatewayUrl());
      const send = (payload) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(payload));
      signal.addEventListener('abort', () => done(), { once: true });
      socket.on('message', (raw) => {
        let frame;
        try { frame = JSON.parse(String(raw)); } catch { return; }
        if (frame.s != null) seq = frame.s;
        if (frame.op === 10) {
          beat = setInterval(() => send({ op: 1, d: seq }), frame.d?.heartbeat_interval ?? 41_250);
          beat.unref?.();
          send({ op: 2, d: { token, intents: DISCORD_INTENTS, properties: { os: process.platform, browser: 'deus-neuma', device: 'deus-neuma' } } });
        } else if (frame.op === 1) send({ op: 1, d: seq });
        else if (frame.op === 7 || frame.op === 9) done(new Error(frame.op === 7 ? 'Discord asked for a reconnect' : 'Discord invalidated the session'));
        else if (frame.op === 0 && frame.t === 'READY') bot = frame.d?.user ?? null;
        else if (frame.op === 0 && frame.t === 'MESSAGE_CREATE' && bot) {
          const heard = normalizeDiscord(frame.d, { connectionId, bot });
          if (heard) Promise.resolve(onEvent(heard.event, { mentioned: heard.mentioned })).catch(() => {});
        }
      });
      socket.on('close', (code) => done(signal.aborted ? null : Object.assign(new Error(`the Discord gateway closed (${code})`), { fatal: FATAL.has(code) })));
      socket.on('error', (err) => done(err));
    }),
    disconnect: () => { try { socket?.close(); } catch { /* already closed */ } },

    /** One answer back to the channel. impure. */
    send: async (chatRef, text, opts = {}) => {
      try {
        const res = await fetch(`${apiRoot()}/channels/${encodeURIComponent(chatRef.id)}/messages`, {
          method: 'POST', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(discordReply(text, opts)), signal: AbortSignal.timeout(15_000),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) return makeSendResult({ success: true, messageId: String(json.id ?? '') });
        const retryAfter = Number(json.retry_after);
        return makeSendResult({ success: false, error: json.message || `Discord answered ${res.status}`, retryable: res.status === 429, ...(Number.isFinite(retryAfter) ? { retryAfterMs: retryAfter * 1000 } : {}) });
      } catch (err) {
        return makeSendResult({ success: false, error: err.message, retryable: true });
      }
    },
  };
};
