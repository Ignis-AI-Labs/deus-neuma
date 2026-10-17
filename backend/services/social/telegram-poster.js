// telegram-poster.js — publish a message to a Telegram channel/chat through
// the official Bot API. Zero-dependency (study-don't-integrate): plain fetch,
// pure request builder proven with real inputs and outputs.

/**
 * Build the sendMessage request for one post (pure).
 * @param {{botToken: string, chatId: string}} credentials
 * @param {string} text
 * @returns {{url: string, body: {chat_id: string, text: string}}}
 */
export const telegramSendRequest = (credentials, text) => Object.freeze({
  url: `https://api.telegram.org/bot${credentials.botToken}/sendMessage`,
  body: Object.freeze({ chat_id: credentials.chatId, text }),
});

/**
 * Publish one message. Never throws: every failure returns {ok:false, detail}
 * so the consciousness reads a real outcome. The operator's barge-in signal
 * cuts an in-flight publish off.
 * @param {{botToken: string, chatId: string}|null} credentials
 * @param {string} text
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, id: string}|{ok: false, status?: number, detail: string}>}
 */
// impure — network
export const postToTelegram = async (credentials, text, { signal } = {}) => {
  if (!credentials) return { ok: false, detail: 'Telegram credentials are not configured' };
  const { url, body } = telegramSendRequest(credentials, text);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const parsed = await res.json().catch(() => ({}));
    if (res.ok && parsed?.ok === true && parsed?.result?.message_id !== undefined) {
      return { ok: true, id: String(parsed.result.message_id) };
    }
    return { ok: false, status: res.status, detail: parsed?.description || `HTTP ${res.status}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, detail: 'interrupted by your operator before publishing' };
    }
    return { ok: false, detail: err.message };
  }
};
