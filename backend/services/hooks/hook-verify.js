/**
 * WEBHOOK SIGNATURES — is this delivery really from the service it claims,
 * signed with the secret this house gave it? Every source signs differently;
 * each is checked the way that service documents it, over the RAW body bytes
 * (a re-serialized body would not match the signature).
 *
 *   github   X-Hub-Signature-256: sha256=<hex HMAC-SHA256(secret, body)>
 *            X-GitHub-Delivery names the delivery, X-GitHub-Event its kind.
 *   slack    X-Slack-Signature: v0=<hex HMAC-SHA256(secret, "v0:" + ts + ":" + body)>
 *            X-Slack-Request-Timestamp must be within five minutes.
 *   linear   Linear-Signature: <hex HMAC-SHA256(secret, body)>
 *            body.webhookTimestamp (ms) within five minutes; Linear-Delivery names it.
 *   generic  X-Neuma-Signature: sha256=<hex HMAC-SHA256(secret, ts + "." + body)>
 *            X-Neuma-Timestamp (seconds) within five minutes — for anything else
 *            (a CI job, a script, Zapier): sign it yourself, the recipe is in the docs.
 *
 * GitHub signs no timestamp, so a captured GitHub delivery could be replayed;
 * its delivery id is remembered (hook-store.js) and a repeat is refused.
 *
 * Pure: headers, bytes, secret and the clock in; a verdict out.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const HOOK_SOURCES = Object.freeze(['github', 'slack', 'linear', 'generic']);
/** How far a signed timestamp may be from now. */
export const HOOK_SKEW_MS = 5 * 60_000;

const hmacHex = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');

// Constant-time equality of two strings; unequal lengths are simply unequal.
const sameText = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

const header = (headers, name) => {
  const v = headers?.[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : (v ?? '');
};

const parseJson = (raw) => {
  try { return JSON.parse(raw.toString('utf8')); } catch { return null; }
};

const fresh = (stampMs, now) => Number.isFinite(stampMs) && Math.abs(now - stampMs) <= HOOK_SKEW_MS;

const refuse = (why) => ({ ok: false, why });

// One reader per source: is it signed, is it fresh, what is its id and kind.
const READERS = Object.freeze({
  github: ({ secret, headers, raw }) => {
    const sig = header(headers, 'x-hub-signature-256');
    if (!sig) return refuse('no X-Hub-Signature-256 header');
    if (!sameText(sig, `sha256=${hmacHex(secret, raw)}`)) return refuse('the signature does not match this hook\'s secret');
    const body = parseJson(raw);
    if (!body) return refuse('the body is not JSON');
    return { ok: true, deliveryId: header(headers, 'x-github-delivery') || null, event: header(headers, 'x-github-event') || 'unknown', body };
  },
  slack: ({ secret, headers, raw, now }) => {
    const sig = header(headers, 'x-slack-signature');
    const ts = header(headers, 'x-slack-request-timestamp');
    if (!sig || !ts) return refuse('no X-Slack-Signature / X-Slack-Request-Timestamp header');
    if (!fresh(Number(ts) * 1000, now)) return refuse('the timestamp is more than five minutes from now');
    if (!sameText(sig, `v0=${hmacHex(secret, Buffer.concat([Buffer.from(`v0:${ts}:`), raw]))}`)) return refuse('the signature does not match this hook\'s secret');
    const body = parseJson(raw);
    if (!body) return refuse('the body is not JSON');
    return { ok: true, deliveryId: body.event_id || `${ts}:${sig.slice(3, 19)}`, event: body.event?.type || body.type || 'unknown', body };
  },
  linear: ({ secret, headers, raw, now }) => {
    const sig = header(headers, 'linear-signature');
    if (!sig) return refuse('no Linear-Signature header');
    if (!sameText(sig, hmacHex(secret, raw))) return refuse('the signature does not match this hook\'s secret');
    const body = parseJson(raw);
    if (!body) return refuse('the body is not JSON');
    if (!fresh(Number(body.webhookTimestamp), now)) return refuse('the webhookTimestamp is more than five minutes from now');
    return { ok: true, deliveryId: header(headers, 'linear-delivery') || null, event: header(headers, 'linear-event') || body.type || 'unknown', body };
  },
  generic: ({ secret, headers, raw, now }) => {
    const sig = header(headers, 'x-neuma-signature');
    const ts = header(headers, 'x-neuma-timestamp');
    if (!sig || !ts) return refuse('no X-Neuma-Signature / X-Neuma-Timestamp header');
    if (!fresh(Number(ts) * 1000, now)) return refuse('the timestamp is more than five minutes from now');
    if (!sameText(sig, `sha256=${hmacHex(secret, Buffer.concat([Buffer.from(`${ts}.`), raw]))}`)) return refuse('the signature does not match this hook\'s secret');
    const body = parseJson(raw) ?? { text: raw.toString('utf8') };
    return { ok: true, deliveryId: header(headers, 'x-neuma-delivery') || null, event: header(headers, 'x-neuma-event') || 'event', body };
  },
});

/**
 * Check one delivery. Pure.
 * @param {{ source: string, secret: string, headers: Record<string, string|string[]>, raw: Buffer, now: number }} input
 * @returns {{ ok: true, deliveryId: string, event: string, body: object } | { ok: false, why: string }}
 */
export const verifyDelivery = ({ source, secret, headers, raw, now }) => {
  const read = READERS[source];
  if (!read) return refuse(`unknown source ${source}`);
  if (!secret) return refuse('this hook has no secret');
  if (!Buffer.isBuffer(raw)) return refuse('no body');
  const verdict = read({ secret, headers: headers ?? {}, raw, now });
  if (!verdict.ok) return verdict;
  // A delivery with no id of its own is named by its bytes: the same bytes twice are the same delivery.
  return { ...verdict, deliveryId: String(verdict.deliveryId || createHash('sha256').update(raw).digest('hex').slice(0, 32)) };
};

/**
 * Sign a body the generic way — for the docs' recipe, a test, or a script. Pure.
 * @returns {{ 'x-neuma-timestamp': string, 'x-neuma-signature': string }}
 */
export const signGeneric = (secret, raw, nowMs) => {
  const ts = String(Math.floor(nowMs / 1000));
  return { 'x-neuma-timestamp': ts, 'x-neuma-signature': `sha256=${hmacHex(secret, Buffer.concat([Buffer.from(`${ts}.`), Buffer.from(raw)]))}` };
};
