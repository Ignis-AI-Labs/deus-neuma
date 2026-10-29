// link-codes — tracked links (campaign plan §4.1, slice 7). A staged post's
// links become https://deusneuma.ai/go/<code>; the site counter (the
// deus-neuma-site Worker, src/worker/go-code.ts) sends the visitor on to the
// destination and counts (code, day) — nothing about the person who follows.
//
// The rules here MIRROR the counter's own (go-code.ts): a code is letters and
// digits, the destination an https URL with no credentials or port on one of
// its allowlisted hosts, never a counting path. A link the counter would
// refuse is left as it is, so a posted /go/ link always resolves. Adding a
// host is a reviewed change on BOTH sides.
//
// Pure.

/** The code alphabet: Crockford base-32, lowercase (no i, l, o, u) — six of them per code. */
export const CODE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const CODE_LENGTH = 6;

/** The counter's own site — the only one handed the code itself, as `?src=`. */
export const SITE_HOSTS = Object.freeze(['deusneuma.ai', 'www.deusneuma.ai']);

/** Every host a code may lead to (go-code.ts DESTINATION_HOSTS, exact hosts). */
export const DESTINATION_HOSTS = Object.freeze([
  ...SITE_HOSTS, 'ignislabs.ai', 'www.ignislabs.ai', 'umbrae.io', 'www.umbrae.io',
  'github.com', 'x.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be', 'www.tiktok.com',
  'tiktok.com', 'www.linkedin.com', 'www.facebook.com', 'bsky.app', 't.me', 'discord.gg', 'discord.com',
  'huggingface.co',
]);

/** Platforms whose post text carries no clickable link — their links are left as written (plan §4.1). */
export const UNLINKED_CHANNELS = Object.freeze(['tiktok']);

const MAX_DESTINATION = 2048;
const URL_IN_TEXT = /https:\/\/[^\s<>"'`]+/g;
const TRAILING = /[.,;:!?)\]}»”’]+$/;

/** A code from random bytes (each byte names one character; 256 is a multiple of 32, so it is even). */
export const codeFromBytes = (bytes) => Array.from(bytes).slice(0, CODE_LENGTH).map((b) => CODE_ALPHABET[b % 32]).join('');

/** May this URL be a code's destination? The counter's own test, restated. */
export const isTrackable = (raw) => {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_DESTINATION) return false;
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (!DESTINATION_HOSTS.includes(url.hostname)) return false;
  return !(SITE_HOSTS.includes(url.hostname) && /^\/go(\/|-)/.test(url.pathname));
};

/** The counted address of a code on the counter at `base` (https://deusneuma.ai). */
export const goUrl = (base, code) => `${String(base).replace(/\/+$/, '')}/go/${code}`;

/**
 * A post's text with every trackable link replaced by its counted address.
 * The same destination twice in one post is one code. Pure — `mint` is the
 * caller's (crypto) code source.
 * @param {string} text
 * @param {{channelId: string, base: string, mint: () => string}} opts
 * @returns {{text: string, links: Array<{code: string, destination: string}>}}
 */
export const planLinks = (text, { channelId, base, mint }) => {
  if (UNLINKED_CHANNELS.includes(channelId)) return { text, links: [] };
  const links = [];
  const out = String(text || '').replace(URL_IN_TEXT, (found) => {
    const tail = TRAILING.exec(found)?.[0] || '';
    const destination = tail ? found.slice(0, -tail.length) : found;
    if (!isTrackable(destination)) return found;
    let link = links.find((l) => l.destination === destination);
    if (!link) {
      link = { code: mint(), destination };
      links.push(link);
    }
    return `${goUrl(base, link.code)}${tail}`;
  });
  return { text: out, links };
};

/**
 * The counter's code map entries for publishing (POST /go-codes): code,
 * destination, company, createdAt — and nothing else (no post, account or
 * person rides along). Pure.
 * @param {Array<{code: string, destination: string, companyId?: ?string, createdAt: string}>} records
 */
export const publishBody = (records) => ({
  codes: records.map((r) => ({
    code: r.code, destination: r.destination, company: r.companyId || null, createdAt: r.createdAt,
  })),
});
