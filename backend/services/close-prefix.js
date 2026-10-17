// close-prefix.js — a turn's CLOSE keeps the prompt its chat is cached under.
//
// The no-progress close and the speechless close ask for one final answer
// with NO tools offered. On llama.cpp the tool list renders FIRST — before the
// system prompt and the whole conversation — and the served model reuses a
// slot's cache only for a byte-identical prefix, so every close re-read the
// entire chat for one answer (2026-10-12: 128k tokens, 89 s, in Founder's chat).
// On that wire the close now carries the round's OWN tools — the same prompt,
// cached — with tool_choice […], and the tool-call opener banned: measured
// live, […] alone renders the identical prompt but the model still wrote
// its call out as text; with the opener banned no call can come back.
// Every other wire keeps the tool-less close it always had.
//
// impure — the opener's id is read once per server from its own tokenizer.

import { createLogger } from './logger.js';

const log = createLogger('ClosePrefix');

const LOOPBACK = /^https?:\/\/(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\])(:|\/|$)/i;

/**
 * The wire this rule is for: a llama.cpp server on this machine. Pure.
 * @param {{provider?: string, endpoint?: string}} config
 * @returns {boolean}
 */
export const isLocalLlamaWire = (config) => config?.provider === 'llama-server'
  || (config?.provider === 'custom' && LOOPBACK.test(config?.endpoint ?? ''));

/**
 * The tools one request carries. A round's own tools always ride; a close
 * (no tools of its own) carries the round's tools on a local llama.cpp wire,
 * held from being called. Pure.
 * @param {Array<Object>} nativeTools - what the caller passed for this request
 * @param {?Array<Object>} closeTools - the round's tools, when this request is a close
 * @param {Object} config - the provider config the request rides
 * @returns {{tools?: Array<Object>, toolChoice?: string, banToolCalls?: boolean}}
 */
export const roundToolsFor = (nativeTools, closeTools, config) => {
  if (nativeTools.length > 0) return { tools: nativeTools };
  if (closeTools?.length && isLocalLlamaWire(config)) return { tools: closeTools, toolChoice: 'none', banToolCalls: true };
  return {};
};

/** The template's tool-call opener — the first token of every native call on this family. */
export const TOOL_CALL_OPENER = '<tool_call>';

const bans = new Map(); // endpoint|model -> Promise<?Array>

/**
 * The logit bias that makes a native tool call impossible: the opener's one
 * token, banned. Null when the server's tokenizer does not hold the opener as
 * a single special token (another family) or cannot be asked — the close then
 * rides tool_choice "none" alone. Cached per server and model.
 * @param {{endpoint?: string, model?: string}} config
 * @returns {Promise<?Array<[number, false]>>}
 */
export const toolCallBan = (config) => {
  const base = String(config?.endpoint ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
  if (!base) return Promise.resolve(null);
  const key = `${base}|${config?.model ?? ''}`;
  if (!bans.has(key)) {
    bans.set(key, fetch(`${base}/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: TOOL_CALL_OPENER, parse_special: true, with_pieces: true }),
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const tokens = Array.isArray(body?.tokens) ? body.tokens : [];
        const [only] = tokens;
        return tokens.length === 1 && only?.piece === TOOL_CALL_OPENER && Number.isInteger(only.id) ? [[only.id, false]] : null;
      })
      .catch((err) => {
        log.debug('tool-call opener unread — the close rides tool_choice none alone', { error: err.message });
        bans.delete(key); // a server mid-boot is asked again next time
        return null;
      }));
  }
  return bans.get(key);
};
