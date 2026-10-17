// smtp-sender.js — send one email through the operator's SMTP account over
// implicit TLS (Gmail :465 and any provider speaking the same), own stack:
// no mail deps, Node tls + crypto only (study-don't-integrate, the x-poster
// posture). The command dialogue and the MIME message are pure builders,
// proven without a socket; only the runner touches the network.
//
// An email is outward speech to a named person — stronger egress than a
// public post — so the runner honors the operator's barge-in signal and
// never throws: the consciousness always reads a real outcome.

import crypto from 'crypto';
import tls from 'tls';
import { encodeHeaderWord, encodeBase64Body } from './mime.js';

export const EMAIL_ADDRESS_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
export const SEND_MAX_RECIPIENTS = 10;
export const SEND_MAX_SUBJECT_CHARS = 500;
export const SEND_MAX_TEXT_CHARS = 50000;
const DIALOGUE_TIMEOUT_MS = 20000;

/**
 * Validate a neuma-supplied send request before anything is built (pure,
 * fail closed). Control characters anywhere in an address or subject are
 * refused outright — a header must never be smuggle-able through tool args.
 * @param {{to?: unknown, subject?: unknown, text?: unknown}} request
 * @returns {{ok: true, to: string[], subject: string, text: string}
 *   |{ok: false, detail: string}}
 */
export const validateSendRequest = ({ to, subject, text } = {}) => {
  const toList = Array.isArray(to) ? to : typeof to === 'string' ? [to] : null;
  if (!toList || toList.length === 0) return { ok: false, detail: 'at least one recipient is required' };
  if (toList.length > SEND_MAX_RECIPIENTS) {
    return { ok: false, detail: `at most ${SEND_MAX_RECIPIENTS} recipients per send` };
  }
  for (const addr of toList) {
    if (typeof addr !== 'string' || !EMAIL_ADDRESS_PATTERN.test(addr)) {
      return { ok: false, detail: `invalid recipient address: ${String(addr).slice(0, 80)}` };
    }
  }
  if (typeof subject !== 'string' || subject.trim().length === 0) {
    return { ok: false, detail: 'subject is required' };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(subject)) return { ok: false, detail: 'subject contains control characters' };
  if (subject.length > SEND_MAX_SUBJECT_CHARS) {
    return { ok: false, detail: `subject exceeds ${SEND_MAX_SUBJECT_CHARS} characters` };
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, detail: 'message text is required' };
  }
  if (text.length > SEND_MAX_TEXT_CHARS) {
    return { ok: false, detail: `message exceeds ${SEND_MAX_TEXT_CHARS} characters` };
  }
  return { ok: true, to: toList.map((a) => a.trim()), subject, text };
};

/**
 * Build the RFC 5322 message (pure — date and messageId supplied by the
 * caller). Body travels base64 so charset and dot-stuffing hazards vanish.
 * @param {{from: string, to: string[], subject: string, text: string,
 *   date: Date, messageId: string}} msg
 * @returns {string} CRLF-terminated raw message
 */
export const buildMimeMessage = ({ from, to, subject, text, date, messageId }) => [
  `From: <${from}>`,
  `To: ${to.map((a) => `<${a}>`).join(', ')}`,
  `Subject: ${encodeHeaderWord(subject)}`,
  `Date: ${date.toUTCString()}`,
  `Message-ID: ${messageId}`,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  encodeBase64Body(text),
].join('\r\n');

/**
 * Dot-stuff message data for the SMTP DATA phase (pure): any line beginning
 * with '.' gets a second one so the terminator cannot be forged.
 * @param {string} data
 * @returns {string}
 */
export const dotStuff = (data) => data.replace(/(^|\r\n)\./g, '$1..');

/**
 * Is a buffered SMTP reply complete? (pure) Multi-line replies continue with
 * `250-...`; the final line is `250 ...` (space after the code).
 * @param {string} reply
 * @returns {boolean}
 */
export const smtpReplyComplete = (reply) => {
  const lines = reply.split('\r\n').filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  return typeof last === 'string' && /^\d{3}( |$)/.test(last);
};

/**
 * The full command dialogue for one send (pure): each step is what we send
 * (null = just await the server) and the reply code that means success.
 * @param {{username: string, password: string}} credentials
 * @param {{from: string, to: string[], message: string}} envelope
 * @returns {ReadonlyArray<{send: string|null, expect: number}>}
 */
export const buildSmtpDialogue = (credentials, { from, to, message }) => Object.freeze([
  { send: null, expect: 220 },
  { send: 'EHLO neuma.local', expect: 250 },
  {
    send: `AUTH PLAIN ${Buffer.from(`\u0000${credentials.username}\u0000${credentials.password}`, 'utf8').toString('base64')}`,
    expect: 235,
  },
  { send: `MAIL FROM:<${from}>`, expect: 250 },
  ...to.map((addr) => ({ send: `RCPT TO:<${addr}>`, expect: 250 })),
  { send: 'DATA', expect: 354 },
  { send: `${dotStuff(message)}\r\n.`, expect: 250 },
  { send: 'QUIT', expect: 221 },
].map(Object.freeze));

// impure — walk a prepared dialogue over a live socket. Resolves with the
// first failing reply or {ok:true}; never rejects for protocol reasons.
const _runDialogue = (socket, steps) => new Promise((resolve) => {
  let index = 0;
  let buffered = '';
  const step = () => {
    if (index >= steps.length) return resolve({ ok: true });
    if (steps[index].send !== null) socket.write(`${steps[index].send}\r\n`);
    return undefined;
  };
  socket.on('data', (chunk) => {
    buffered += chunk.toString('utf8');
    if (!smtpReplyComplete(buffered)) return;
    const reply = buffered;
    buffered = '';
    const code = parseInt(reply.slice(0, 3), 10);
    if (code !== steps[index].expect) {
      return resolve({ ok: false, detail: `SMTP ${reply.split('\r\n')[0].slice(0, 200)}` });
    }
    index += 1;
    return step();
  });
  step();
});

// impure — one TLS session walking a prepared dialogue: timeout, barge-in,
// and socket errors all land as {ok:false, detail}. Never throws/rejects.
const _runSmtpSession = (credentials, steps, { signal, interrupted }) => {
  const port = parseInt(credentials.smtpPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return Promise.resolve({ ok: false, detail: 'invalid SMTP port' });
  }
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect({ host: credentials.smtpHost, port, servername: credentials.smtpHost });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ ok: false, detail: interrupted });
    const timer = setTimeout(() => finish({ ok: false, detail: 'SMTP conversation timed out' }), DIALOGUE_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort);
    socket.on('error', (err) => finish({ ok: false, detail: err.message }));
    socket.on('secureConnect', () => {
      _runDialogue(socket, steps).then(finish);
    });
  });
};

/**
 * Send one email. Never throws — every failure lands as {ok:false, detail}.
 * @param {{address: string, username: string, password: string,
 *   smtpHost: string, smtpPort: string}|null} credentials
 * @param {{to: string[]|string, subject: string, text: string}} request
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{ok: true, messageId: string, to: string[]}
 *   |{ok: false, detail: string}>}
 */
// impure — network + clock + entropy
export const sendEmail = async (credentials, request, { signal } = {}) => {
  if (!credentials) return { ok: false, detail: 'email credentials are not configured' };
  const valid = validateSendRequest(request);
  if (!valid.ok) return valid;
  const interrupted = 'interrupted by your operator before sending';
  if (signal?.aborted) return { ok: false, detail: interrupted };

  const domain = credentials.address.split('@')[1] || 'neuma.local';
  const messageId = `<${crypto.randomBytes(12).toString('hex')}@${domain}>`;
  const message = buildMimeMessage({
    from: credentials.address,
    to: valid.to,
    subject: valid.subject,
    text: valid.text,
    date: new Date(),
    messageId,
  });
  const steps = buildSmtpDialogue(credentials, { from: credentials.address, to: valid.to, message });
  const outcome = await _runSmtpSession(credentials, steps, { signal, interrupted });
  return outcome.ok ? { ok: true, messageId, to: valid.to } : outcome;
};

/**
 * Read-only authentication probe: connect, EHLO, AUTH, QUIT — proves the
 * server accepts these credentials without a single message leaving.
 * @param {Record<string, string>|null} credentials
 * @returns {Promise<{ok: true}|{ok: false, detail: string}>}
 */
// impure — network
export const probeSmtp = async (credentials) => {
  if (!credentials) return { ok: false, detail: 'email credentials are not configured' };
  const steps = buildSmtpDialogue(credentials, { from: credentials.address, to: [], message: '' })
    .filter((s) => s.send === null || s.send.startsWith('EHLO') || s.send.startsWith('AUTH') || s.send === 'QUIT');
  return _runSmtpSession(credentials, steps, { signal: undefined, interrupted: 'interrupted' });
};
