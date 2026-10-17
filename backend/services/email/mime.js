// mime.js — pure MIME text codecs shared by the email protocol clients.
//
// Own-stack (study-don't-integrate): no mail deps anywhere in this layer.
// Everything here is a pure transform — bytes/strings in, strings out — so the
// whole module is provable with real inputs and no network.

/**
 * Decode a buffer under a MIME charset label. UTF-8 is the default; the
 * latin1 family covers the common legacy senders. Unknown charsets fall back
 * to UTF-8 — a garbled glyph beats a dropped message.
 * @param {Buffer} buf
 * @param {string} [charset]
 * @returns {string}
 */
export const charsetToString = (buf, charset) => {
  const c = String(charset || 'utf-8').toLowerCase();
  if (c === 'iso-8859-1' || c === 'latin1' || c === 'windows-1252' || c === 'us-ascii') {
    return buf.toString('latin1');
  }
  return buf.toString('utf8');
};

/**
 * Decode a quoted-printable body to bytes (soft line breaks removed,
 * =XX sequences restored). Charset is applied by the caller.
 * @param {string} text
 * @returns {Buffer}
 */
export const decodeQuotedPrintable = (text) => {
  const unfolded = text.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < unfolded.length; i += 1) {
    const ch = unfolded[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return Buffer.from(bytes);
};

/**
 * Decode RFC 2047 encoded-words (=?charset?B|Q?data?=) inside a header value.
 * Whitespace between adjacent encoded words is transparent per the RFC.
 * @param {string} value
 * @returns {string}
 */
export const decodeEncodedWords = (value) =>
  String(value)
    .replace(/(\?=)[ \t]+(=\?)/g, '$1$2')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset, enc, data) => {
      if (enc.toUpperCase() === 'B') {
        return charsetToString(Buffer.from(data, 'base64'), charset);
      }
      return charsetToString(decodeQuotedPrintable(data.replace(/_/g, ' ')), charset);
    });

/**
 * Encode a header value as RFC 2047 UTF-8 encoded-words when it carries
 * anything outside printable ASCII; plain values pass through untouched.
 * Long values split into ≤45-byte chunks so no encoded word exceeds the
 * 75-char limit, folded with a continuation space.
 * @param {string} value
 * @returns {string}
 */
export const encodeHeaderWord = (value) => {
  const v = String(value);
  if (/^[\x20-\x7E]*$/.test(v)) return v;
  const chunks = [];
  let current = '';
  for (const ch of v) {
    if (Buffer.byteLength(current + ch, 'utf8') > 45) {
      chunks.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return chunks
    .map((c) => `=?UTF-8?B?${Buffer.from(c, 'utf8').toString('base64')}?=`)
    .join('\r\n ');
};

/**
 * Base64-encode a UTF-8 body wrapped at 76 columns with CRLF line ends —
 * the transfer encoding the sender uses (no dot-stuffing hazards, no
 * charset ambiguity).
 * @param {string} text
 * @returns {string}
 */
export const encodeBase64Body = (text) => {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
};

/**
 * Parse a raw RFC 5322 header block into a lowercase-name map (first value
 * wins). Folded continuation lines are unfolded first.
 * @param {string} headerBlock
 * @returns {Record<string, string>}
 */
export const parseMimeHeaders = (headerBlock) => {
  const headers = {};
  const unfolded = String(headerBlock).replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    if (headers[name] === undefined) headers[name] = line.slice(idx + 1).trim();
  }
  return headers;
};

/**
 * Parse a Content-Type value into its media type and parameters
 * (boundary, charset), honoring quoted parameter values.
 * @param {string} value
 * @returns {{type: string, params: Record<string, string>}}
 */
export const parseContentType = (value) => {
  const [type, ...rest] = String(value || '').split(';');
  const params = {};
  for (const part of rest) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    let val = part.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    params[key] = val;
  }
  return { type: type.trim().toLowerCase(), params };
};

const _decodeBody = (body, encoding, charset) => {
  const enc = String(encoding || '').toLowerCase();
  if (enc === 'base64') return charsetToString(Buffer.from(body.replace(/\s+/g, ''), 'base64'), charset);
  if (enc === 'quoted-printable') return charsetToString(decodeQuotedPrintable(body), charset);
  return charsetToString(Buffer.from(body, 'latin1'), charset);
};

const _splitMessage = (raw) => {
  const idx = raw.indexOf('\r\n\r\n');
  if (idx === -1) {
    const lf = raw.indexOf('\n\n');
    if (lf === -1) return { headers: raw, body: '' };
    return { headers: raw.slice(0, lf), body: raw.slice(lf + 2) };
  }
  return { headers: raw.slice(0, idx), body: raw.slice(idx + 4) };
};

const _multipartParts = (body, boundary) => body
  .split(new RegExp(`(?:\\r?\\n|^)--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \t]*(?:\\r?\\n|$)`))
  .filter((p) => p.trim().length > 0);

/**
 * Pull the first text/plain part (falling back to any text/*) out of a raw
 * message, decoding transfer encoding + charset. Depth-capped multipart walk.
 * Null when no textual part exists — the caller states that plainly.
 * @param {string} raw the raw message (headers + body)
 * @param {number} [depth]
 * @returns {{text: string, contentType: string}|null}
 */
export const extractTextPart = (raw, depth = 0) => {
  if (depth > 5) return null;
  const { headers: headerBlock, body } = _splitMessage(String(raw));
  const headers = parseMimeHeaders(headerBlock);
  const ct = parseContentType(headers['content-type'] || 'text/plain; charset=utf-8');

  if (ct.type.startsWith('multipart/') && ct.params.boundary) {
    const parts = _multipartParts(body, ct.params.boundary);
    const decoded = parts.map((p) => extractTextPart(p, depth + 1)).filter(Boolean);
    return decoded.find((d) => d.contentType === 'text/plain') || decoded[0] || null;
  }
  if (ct.type === 'text/plain' || ct.type.startsWith('text/')) {
    return {
      text: _decodeBody(body, headers['content-transfer-encoding'], ct.params.charset),
      contentType: ct.type,
    };
  }
  return null;
};
