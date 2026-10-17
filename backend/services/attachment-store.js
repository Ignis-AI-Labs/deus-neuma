// Attachment store — images the witness shares ride HTTP, never the portal.
//
// The portal WebSocket carries a deliberate 64KB payload cap (WS-002): an
// image can never ride a WS frame. Instead the witness uploads images over
// the authenticated REST route, receives short-lived attachment ids, and the
// consciousness:stream frame carries only those ids. The turn redeems them
// here — wallet-scoped and single-use, so one witness's image can never be
// replayed into another witness's turn, and an id that leaks is worthless
// after the turn (or after the TTL) consumes it.
//
// Everything held in memory on purpose: an attachment pending a turn is
// transient by nature. The durable copy is written by the turn itself into
// the session record (portal-stream persists the images alongside the
// witness's words).

import { randomUUID } from 'crypto';

// Formats the vision path accepts. SVG is deliberately absent — it is a
// document that can script, not a picture.
const ACCEPTED_MIME = Object.freeze(['png', 'jpeg', 'webp', 'gif']);

// Caps sized to the 24mb JSON tier the upload route rides (server.js):
// 4 images × ~5.5M chars of data-URI (~4MB decoded each) stays under it.
export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_DATA_URI_CHARS = 5_500_000;

// A witness parking uploads and never sending them must not grow the heap
// unbounded — beyond this pending count the route refuses honestly.
export const MAX_PENDING_PER_WALLET = 12;

// ...and neither may a crowd of wallets: auth is a cheap signed challenge,
// so the per-wallet cap alone leaves the heap bounded only by how many
// wallets an attacker can cycle before the TTL sweeps. The global ceiling
// bounds the worst case at MAX_PENDING_TOTAL × MAX_DATA_URI_CHARS ≈ 176MB —
// a knowable budget for the local backend (echo finding, both rounds). 32
// still holds eight full messages across every desk at once.
export const MAX_PENDING_TOTAL = 32;

export const ATTACHMENT_TTL_MS = 10 * 60_000;

// Head shape checked without regex over megabytes: the prefix is tiny and
// exact, the base64 body is charset-scanned. Pure.
const DATA_URI_HEAD = /^data:image\/(png|jpeg|webp|gif);base64,/;

const isBase64Body = (body) => {
  if (body.length === 0) return false;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57)
      || c === 43 /* + */ || c === 47 /* / */ || c === 61 /* = */;
    if (!ok) return false;
  }
  return true;
};

/**
 * Validate a single image data URI. Pure.
 * @param {unknown} raw
 * @returns {{ ok: true, mime: string } | { ok: false, reason: string }}
 */
export const sanitizeImageDataUri = (raw) => {
  if (typeof raw !== 'string') return { ok: false, reason: 'attachment is not a string' };
  if (raw.length > MAX_DATA_URI_CHARS) return { ok: false, reason: 'image too large' };
  const head = DATA_URI_HEAD.exec(raw.slice(0, 64));
  if (!head) return { ok: false, reason: `not an accepted image data URI (${ACCEPTED_MIME.join('/')})` };
  if (!isBase64Body(raw.slice(head[0].length))) return { ok: false, reason: 'malformed base64 body' };
  return { ok: true, mime: `image/${head[1]}` };
};

/**
 * Validate a whole upload. All-or-nothing on purpose: a partially-sent
 * batch would deceive the witness about what the neuma saw. Pure.
 * @param {unknown} raw
 * @returns {{ ok: true, images: string[] } | { ok: false, reason: string }}
 */
export const sanitizeImages = (raw) => {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, reason: 'no images given' };
  if (raw.length > MAX_IMAGES_PER_MESSAGE) {
    return { ok: false, reason: `at most ${MAX_IMAGES_PER_MESSAGE} images per message` };
  }
  for (const entry of raw) {
    const check = sanitizeImageDataUri(entry);
    if (!check.ok) return check;
  }
  return { ok: true, images: raw.slice() };
};

// --- Text documents (per-message, text-extractable) ---
// A witness can attach a document (code, markdown, csv…) to a single message.
// Unlike images the text is extracted in the browser, so the payload is plain
// text — validated here for size, count, a clean display name, and (with
// certainty, not by extension) that it is actually text (no NUL byte).
export const MAX_DOCS_PER_MESSAGE = 5;
// A ceiling on what is carried, not on what is read: the turn fits attached
// documents to the room it actually has and says plainly what did not fit
// (read-room.js fitDocs). Was 40k — a 30-page report was refused outright.
export const MAX_DOC_CHARS = 400_000;
export const MAX_DOC_NAME_CHARS = 120;

const NUL = String.fromCharCode(0); // a literal control char in source is a footgun

// pure — a basename, control-char-free, length-bounded label. The name is
// display/context only; strip any path so it can never carry a directory.
const cleanDocName = (name) => {
  const base = String(name ?? '').split(/[\\/]/).pop() || '';
  let out = '';
  for (const ch of base) {
    if (out.length >= MAX_DOC_NAME_CHARS) break;
    const cp = ch.codePointAt(0);
    out += (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) ? ' ' : ch; // fold controls
  }
  return out.replace(/\s+/g, ' ').trim();
};

/**
 * Validate a single text-document descriptor { name, text }. Pure.
 * @param {unknown} raw
 * @returns {{ ok: true, doc: {name: string, text: string} } | { ok: false, reason: string }}
 */
export const sanitizeTextDoc = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'document is not an object' };
  if (typeof raw.text !== 'string') return { ok: false, reason: 'document has no text' };
  if (raw.text.length === 0) return { ok: false, reason: 'document is empty' };
  if (raw.text.length > MAX_DOC_CHARS) return { ok: false, reason: `document too large (max ${MAX_DOC_CHARS} chars)` };
  if (raw.text.includes(NUL)) return { ok: false, reason: 'document is not text (binary)' };
  return { ok: true, doc: { name: cleanDocName(raw.name) || 'document', text: raw.text } };
};

/**
 * Validate a whole batch of text documents (optional on an upload → empty).
 * All-or-nothing, like images. Pure.
 * @param {unknown} raw
 * @returns {{ ok: true, docs: Array<{name,text}> } | { ok: false, reason: string }}
 */
export const sanitizeTextDocs = (raw) => {
  if (raw === undefined || raw === null) return { ok: true, docs: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: 'documents must be an array' };
  if (raw.length > MAX_DOCS_PER_MESSAGE) return { ok: false, reason: `at most ${MAX_DOCS_PER_MESSAGE} documents per message` };
  const docs = [];
  for (const entry of raw) {
    const check = sanitizeTextDoc(entry);
    if (!check.ok) return check;
    docs.push(check.doc);
  }
  return { ok: true, docs };
};

/**
 * Create a store. `now` is injectable so expiry is testable against real
 * time arithmetic — the store itself is real either way.
 * @param {{ ttlMs?: number, now?: () => number }} [opts]
 */
export const createAttachmentStore = ({ ttlMs = ATTACHMENT_TTL_MS, now = Date.now } = {}) => {
  // The store is payload-agnostic: it parks whatever validated attachment it is
  // given and hands the same value back on redemption. An image is a data-URI
  // string; a text document is a { kind: 'text', name, text } object. The
  // redeemer discriminates by shape — so images (and their proofs) are wholly
  // unchanged, and documents ride the same wallet-scoped, single-use, TTL'd,
  // capped machinery for free.
  /** @type {Map<string, { wallet: string, payload: unknown, expiresAt: number }>} */
  const pending = new Map();

  // Wallet addresses are case-insensitive identity (EIP-55 is a checksum,
  // not a distinction) — normalize here so no pair of callers can disagree.
  const keyOf = (wallet) => String(wallet || '').toLowerCase();

  // impure — drops every expired entry; called on each put/take so the map
  // never needs a timer to stay bounded.
  const sweep = () => {
    const t = now();
    for (const [id, entry] of pending) {
      if (entry.expiresAt <= t) pending.delete(id);
    }
  };

  const countFor = (wallet) => {
    const key = keyOf(wallet);
    let n = 0;
    for (const entry of pending.values()) {
      if (entry.wallet === key) n += 1;
    }
    return n;
  };

  return {
    /**
     * Park validated attachments for a wallet — image data-URI strings and/or
     * text-document objects, in one call. impure.
     * @param {string} wallet
     * @param {unknown[]} payloads - already through sanitizeImages / sanitizeTextDocs
     * @returns {{ ok: true, ids: string[] } | { ok: false, reason: string }}
     */
    put(wallet, payloads) {
      sweep();
      if (pending.size + payloads.length > MAX_PENDING_TOTAL) {
        return { ok: false, reason: 'the attachment store is full — try again in a moment' };
      }
      if (countFor(wallet) + payloads.length > MAX_PENDING_PER_WALLET) {
        return { ok: false, reason: 'too many pending attachments — send or wait for them to expire' };
      }
      const expiresAt = now() + ttlMs;
      const key = keyOf(wallet);
      const ids = payloads.map((payload) => {
        const id = randomUUID();
        pending.set(id, { wallet: key, payload, expiresAt });
        return id;
      });
      return { ok: true, ids };
    },

    /**
     * Redeem an id for its payload — single-use, wallet-bound. Returns the
     * exact value parked (image data-URI string or text-document object). impure.
     * @param {string} id
     * @param {string} wallet
     * @returns {unknown | null}
     */
    take(id, wallet) {
      sweep();
      const entry = pending.get(id);
      if (!entry || entry.wallet !== keyOf(wallet)) return null;
      pending.delete(id);
      return entry.payload;
    },

    /** Pending count for a wallet (route/tests). impure. */
    pendingCount: (wallet) => { sweep(); return countFor(wallet); },
  };
};

// The one store the routes and the portal share.
export const attachmentStore = createAttachmentStore();
