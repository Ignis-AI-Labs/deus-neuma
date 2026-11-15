// imap-reader.js — read the operator's mailbox over implicit TLS (Gmail :993
// and any IMAP4rev1 server), own stack: no mail deps, Node tls only. The
// response tokenizer and parsers are pure (proven against real server
// response bytes without a socket); only the session runner touches the
// network.
//
// The mailbox is opened with EXAMINE — strictly read-only — so a neuma
// reading its mail never flips seen-flags or otherwise alters the operator's
// own view of the account. Every runner returns a real outcome and never
// throws.

import tls from 'tls';
import { parseMimeHeaders, decodeEncodedWords, extractTextPart } from './mime.js';

export const INBOX_MAX_MESSAGES = 20;
export const READ_BODY_CAP_BYTES = 262144;
const SESSION_TIMEOUT_MS = 30000;

/**
 * Quote a string for an IMAP command argument (pure). Control characters are
 * refused — a credential must never be able to smuggle a second command.
 * @param {string} value
 * @returns {string|null} null when the value cannot be safely quoted
 */
export const imapQuote = (value) => {
  const v = String(value);
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(v)) return null;
  return `"${v.replace(/([\\"])/g, '\\$1')}"`;
};

/**
 * Split buffered server output into complete logical responses (pure).
 * A response is one CRLF-terminated line plus any {N} literals it announces
 * (each literal's bytes are captured raw and elided from the text). Anything
 * incomplete stays in `rest` for the next read.
 * @param {Buffer} buffer
 * @returns {{responses: Array<{text: string, literals: Buffer[]}>, rest: Buffer}}
 */
export const parseImapResponses = (buffer) => {
  const responses = [];
  let pos = 0;
  while (pos < buffer.length) {
    const parts = [];
    const literals = [];
    let scan = pos;
    let complete = false;
    for (;;) {
      const idx = buffer.indexOf('\r\n', scan);
      if (idx === -1) break;
      const text = buffer.slice(scan, idx).toString('utf8');
      const literal = text.match(/\{(\d+)\}$/);
      if (literal) {
        const n = parseInt(literal[1], 10);
        if (idx + 2 + n > buffer.length) break;
        parts.push(text.slice(0, -literal[0].length));
        literals.push(buffer.slice(idx + 2, idx + 2 + n));
        scan = idx + 2 + n;
      } else {
        parts.push(text);
        scan = idx + 2;
        complete = true;
        break;
      }
    }
    if (!complete) return { responses, rest: buffer.slice(pos) };
    responses.push(Object.freeze({ text: parts.join(''), literals }));
    pos = scan;
  }
  return { responses, rest: Buffer.alloc(0) };
};

/**
 * UIDs out of a `* SEARCH ...` response, ascending (pure).
 * @param {Array<{text: string}>} responses
 * @returns {number[]}
 */
export const parseSearchUids = (responses) => {
  const line = responses.find((r) => /^\* SEARCH/i.test(r.text));
  if (!line) return [];
  return line.text.slice('* SEARCH'.length).trim().split(/\s+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
};

/**
 * FETCH items out of a response set (pure): uid, seen flag, and the first
 * literal payload (header block or body) each message carried.
 * @param {Array<{text: string, literals: Buffer[]}>} responses
 * @returns {Array<{uid: number, seen: boolean, payload: Buffer|null}>}
 */
export const parseFetchItems = (responses) => responses
  .filter((r) => /^\* \d+ FETCH /i.test(r.text))
  .map((r) => ({
    uid: parseInt((r.text.match(/UID (\d+)/i) || [])[1], 10) || 0,
    seen: /FLAGS \([^)]*\\Seen[^)]*\)/i.test(r.text),
    payload: r.literals[0] || null,
  }))
  .filter((item) => item.uid > 0);

/**
 * Envelope fields out of a fetched header block (pure) — encoded-words
 * decoded so names and subjects read as the sender wrote them.
 * @param {Buffer|null} headerBlock
 * @returns {{from: string, to: string, subject: string, date: string, messageId: string}}
 */
export const parseEnvelope = (headerBlock) => {
  // Cut at the first blank line so a full-message payload can't leak body
  // lines into header parsing.
  const block = (headerBlock ? headerBlock.toString('utf8') : '').split(/\r?\n\r?\n/)[0];
  const headers = parseMimeHeaders(block);
  return Object.freeze({
    from: decodeEncodedWords(headers.from || ''),
    to: decodeEncodedWords(headers.to || ''),
    subject: decodeEncodedWords(headers.subject || ''),
    date: headers.date || '',
    messageId: headers['message-id'] || '',
  });
};

const _validCredentials = (credentials) => {
  if (!credentials) return null;
  const port = parseInt(credentials.imapPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const username = imapQuote(credentials.username);
  const password = imapQuote(credentials.password);
  if (username === null || password === null) return null;
  return { host: credentials.imapHost, port, username, password };
};

// impure — run one authenticated read-only session: connect, greet, LOGIN,
// EXAMINE INBOX, hand `exec` to the work function, LOGOUT. Resolves whatever
// the work returns; every failure resolves {ok:false, detail}. Never throws.
const _withSession = (credentials, { signal, write = false } = {}, work) => new Promise((resolve) => {
  const conn = _validCredentials(credentials);
  if (!conn) return resolve({ ok: false, detail: 'email credentials are not configured' });
  if (signal?.aborted) return resolve({ ok: false, detail: 'interrupted by your operator' });

  let settled = false;
  let pending = Buffer.alloc(0);
  let tagCount = 0;
  let waiter = null; // {tag, collected, resolve}
  const socket = tls.connect({ host: conn.host, port: conn.port, servername: conn.host });

  const finish = (result) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    resolve(result);
  };
  const onAbort = () => finish({ ok: false, detail: 'interrupted by your operator' });
  const timer = setTimeout(() => finish({ ok: false, detail: 'IMAP conversation timed out' }), SESSION_TIMEOUT_MS);
  signal?.addEventListener('abort', onAbort);
  socket.on('error', (err) => finish({ ok: false, detail: err.message }));

  const exec = (command) => new Promise((done) => {
    tagCount += 1;
    const tag = `A${tagCount}`;
    waiter = { tag, collected: [], resolve: done };
    socket.write(`${tag} ${command}\r\n`);
  });

  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    const { responses, rest } = parseImapResponses(pending);
    pending = rest;
    for (const response of responses) {
      if (!waiter) continue; // greeting and unsolicited chatter
      if (response.text.startsWith(`${waiter.tag} `)) {
        const status = response.text.slice(waiter.tag.length + 1);
        const { collected, resolve: done } = waiter;
        waiter = null;
        done({ ok: /^OK/i.test(status), status, responses: collected });
      } else {
        waiter.collected.push(response);
      }
    }
  });

  socket.on('secureConnect', async () => {
    // Greeting is unsolicited — the first exec's parser simply skips it.
    const login = await exec(`LOGIN ${conn.username} ${conn.password}`);
    if (!login.ok) return finish({ ok: false, detail: `IMAP login refused: ${login.status.slice(0, 120)}` });
    // A read opens the inbox read-only; only the label work (write) opens it to change.
    const examine = await exec(write ? 'SELECT INBOX' : 'EXAMINE INBOX');
    if (!examine.ok) return finish({ ok: false, detail: `could not open INBOX: ${examine.status.slice(0, 120)}` });
    const result = await work(exec);
    await exec('LOGOUT').catch(() => {});
    return finish(result);
  });
});

/**
 * List the newest messages in the inbox — envelopes only, read-only.
 * @param {Record<string, string>|null} credentials resolved email credentials
 * @param {{limit?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, total: number,
 *   messages: Array<{uid: number, seen: boolean, from: string, subject: string, date: string}>}
 *   |{ok: false, detail: string}>}
 */
// impure — network
export const listInbox = (credentials, { limit, signal } = {}) => {
  const take = Math.min(Math.max(parseInt(limit, 10) || 10, 1), INBOX_MAX_MESSAGES);
  return _withSession(credentials, { signal }, async (exec) => {
    const search = await exec('UID SEARCH ALL');
    if (!search.ok) return { ok: false, detail: `inbox search failed: ${search.status.slice(0, 120)}` };
    const uids = parseSearchUids(search.responses);
    if (uids.length === 0) return { ok: true, total: 0, messages: [] };
    const wanted = uids.slice(-take);
    const fetch = await exec(
      `UID FETCH ${wanted.join(',')} (FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])`,
    );
    if (!fetch.ok) return { ok: false, detail: `envelope fetch failed: ${fetch.status.slice(0, 120)}` };
    const messages = parseFetchItems(fetch.responses)
      .map(({ uid, seen, payload }) => ({ uid, seen, ...parseEnvelope(payload) }))
      .sort((a, b) => b.uid - a.uid);
    return { ok: true, total: uids.length, messages };
  });
};

/**
 * Read one message's text body by UID — read-only, capped at
 * READ_BODY_CAP_BYTES so a huge message cannot flood the portal.
 * @param {Record<string, string>|null} credentials resolved email credentials
 * @param {number} uid
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, message: {uid: number, seen: boolean, from: string,
 *   to: string, subject: string, date: string, text: string, truncated: boolean}}
 *   |{ok: false, detail: string}>}
 */
// impure — network
export const readMessage = (credentials, uid, { signal } = {}) => {
  const id = parseInt(uid, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return Promise.resolve({ ok: false, detail: 'a positive message uid is required' });
  }
  return _withSession(credentials, { signal }, async (exec) => {
    const fetch = await exec(`UID FETCH ${id} (FLAGS BODY.PEEK[]<0.${READ_BODY_CAP_BYTES}>)`);
    if (!fetch.ok) return { ok: false, detail: `message fetch failed: ${fetch.status.slice(0, 120)}` };
    const item = parseFetchItems(fetch.responses).find((i) => i.uid === id);
    if (!item || !item.payload) return { ok: false, detail: `no message with uid ${id}` };
    const raw = item.payload.toString('latin1');
    const envelope = parseEnvelope(item.payload);
    const part = extractTextPart(raw);
    return {
      ok: true,
      message: {
        uid: id,
        seen: item.seen,
        ...envelope,
        text: part ? part.text : '(this message has no readable text part)',
        truncated: item.payload.length >= READ_BODY_CAP_BYTES,
      },
    };
  });
};

// ── LABELS — the holder keeps the mailbox in order (Design note, 2026-11-15: […]). On Gmail a label is the
// X-GM-LABELS item of a message; on any other server it is a folder the
// message is copied into. Nothing here deletes a message or marks it read.

export const LABEL_MAX = 60;
/** A label name as it may be written, or null: letters, digits, spaces and / - _ . & only. Pure. */
export const cleanLabel = (v) => {
  const name = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return name && name.length <= LABEL_MAX && /^[\p{L}\p{N} /_.&-]+$/u.test(name) && !/^\//.test(name) ? name : null;
};

/** The folder/label names in LIST responses, system folders left out. Pure. */
export const parseListNames = (responses) => responses
  .map((r) => /^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))$/i.exec(r.text))
  .filter((m) => m && !/\\Noselect/i.test(m[1]))
  .map((m) => (m[2] ?? m[3]).replace(/\\(.)/g, '$1'))
  .filter((name) => !/^INBOX$/i.test(name) && !/^\[Gmail\]/i.test(name));

/**
 * Every label (folder) of the mailbox the holder may use.
 * @returns {Promise<{ok: true, labels: string[]} | {ok: false, detail: string}>}
 */
// impure — network
export const listLabels = (credentials, { signal } = {}) => _withSession(credentials, { signal }, async (exec) => {
  const list = await exec('LIST "" "*"');
  return list.ok ? { ok: true, labels: parseListNames(list.responses).sort((a, b) => a.localeCompare(b)) }
    : { ok: false, detail: `the labels could not be listed: ${list.status.slice(0, 120)}` };
});

/**
 * Put a label on one inbox message (made first when the mailbox has none by
 * that name), take it off, or archive the message out of the inbox.
 * @param {{uid: number, label?: string, remove?: boolean, archive?: boolean}} change
 * @returns {Promise<{ok: true, done: string[]} | {ok: false, detail: string}>}
 */
// impure — network
export const labelMessage = (credentials, { uid, label, remove = false, archive = false }, { signal } = {}) => {
  const id = parseInt(uid, 10);
  if (!Number.isInteger(id) || id <= 0) return Promise.resolve({ ok: false, detail: 'a positive message uid is required' });
  const name = label === undefined || label === null || label === '' ? null : cleanLabel(label);
  if (label && !name) return Promise.resolve({ ok: false, detail: `label: at most ${LABEL_MAX} characters — letters, digits, spaces and / - _ . &` });
  if (!name && !archive) return Promise.resolve({ ok: false, detail: 'name a label, or archive: true' });
  return _withSession(credentials, { signal, write: true }, async (exec) => {
    const gmail = (await exec('CAPABILITY')).responses.some((r) => /X-GM-EXT-1/i.test(r.text));
    const found = await exec(`UID FETCH ${id} (FLAGS)`);
    if (!found.ok || !parseFetchItems(found.responses).some((i) => i.uid === id)) return { ok: false, detail: `no message with uid ${id} in the inbox` };
    const done = [];
    if (name) {
      const quoted = imapQuote(name);
      if (remove) {
        if (!gmail) return { ok: false, detail: 'this mail server keeps labels as folders: a copy in a folder is removed in the mail program, not from here' };
        const off = await exec(`UID STORE ${id} -X-GM-LABELS (${quoted})`);
        if (!off.ok) return { ok: false, detail: `the label could not be removed: ${off.status.slice(0, 120)}` };
        done.push(`"${name}" removed`);
      } else {
        const made = await exec(`CREATE ${quoted}`);
        if (made.ok) done.push(`label "${name}" created`);
        const on = await exec(gmail ? `UID STORE ${id} +X-GM-LABELS (${quoted})` : `UID COPY ${id} ${quoted}`);
        if (!on.ok) return { ok: false, detail: `the label could not be applied: ${on.status.slice(0, 120)}` };
        done.push(`"${name}" applied`);
      }
    }
    if (archive) {
      if (!gmail) return { ok: false, detail: `${done.join('; ') || 'nothing done'} — archiving is only known for Gmail; on this server move it in the mail program` };
      const out = await exec(`UID STORE ${id} -X-GM-LABELS (\\Inbox)`);
      if (!out.ok) return { ok: false, detail: `the message could not be archived: ${out.status.slice(0, 120)}` };
      done.push('archived out of the inbox');
    }
    return { ok: true, done };
  });
};
