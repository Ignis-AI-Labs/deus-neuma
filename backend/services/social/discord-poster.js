// discord-poster.js — publish a message to a Discord channel as a BOT through
// the official REST API. A bot (not a webhook) because a channel is a house
// position with room to grow: one token can speak in any channel the bot is
// invited to, and later reply and react as a visible member. Posting itself
// needs no gateway connection — one REST call. Zero-dependency: plain fetch,
// pure request builder proven with real inputs and outputs.

/**
 * Build the create-message request for one post (pure). The bot token rides
 * the Authorization header, never the URL.
 * @param {{botToken: string, channelId: string}} credentials
 * @param {string} text
 * @returns {{url: string, headers: Record<string, string>, body: {content: string}}}
 */
export const discordMessageRequest = (credentials, text) => Object.freeze({
  url: `https://discord.com/api/v10/channels/${credentials.channelId}/messages`,
  headers: Object.freeze({ Authorization: `Bot ${credentials.botToken}` }),
  body: Object.freeze({ content: text }),
});

/**
 * Publish one message. Never throws: every failure returns {ok:false, detail}
 * so the consciousness reads a real outcome. The operator's barge-in signal
 * cuts an in-flight publish off.
 * @param {{botToken: string, channelId: string}|null} credentials
 * @param {string} text
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, id: string}|{ok: false, status?: number, detail: string}>}
 */
// impure — network
export const postToDiscord = async (credentials, text, { signal } = {}) => {
  if (!credentials) return { ok: false, detail: 'Discord credentials are not configured' };
  const { url, headers, body } = discordMessageRequest(credentials, text);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const parsed = await res.json().catch(() => ({}));
    if (res.ok && parsed?.id) {
      return { ok: true, id: String(parsed.id) };
    }
    return { ok: false, status: res.status, detail: parsed?.message || `HTTP ${res.status}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, detail: 'interrupted by your operator before publishing' };
    }
    return { ok: false, detail: err.message };
  }
};
