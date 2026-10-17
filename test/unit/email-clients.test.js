// Email protocol clients — RULE 0 posture: every pure core is proven with
// real inputs and real expected bytes; the impure runners are proven against
// a REAL local TCP listener (a silent peer — the TLS handshake never
// completes, no packet leaves the box) for the abort path, and real
// validation outcomes for everything reachable without a live account.
// The live SMTP/IMAP path is proven by scripts/email-verify.mjs against the
// real provider — stated, not faked.

import { describe, it, expect } from 'vitest';
import net from 'net';
import {
  charsetToString,
  decodeQuotedPrintable,
  decodeEncodedWords,
  encodeHeaderWord,
  encodeBase64Body,
  parseMimeHeaders,
  parseContentType,
  extractTextPart,
} from '../../backend/services/email/mime.js';
import {
  validateSendRequest,
  buildMimeMessage,
  dotStuff,
  smtpReplyComplete,
  buildSmtpDialogue,
  sendEmail,
} from '../../backend/services/email/smtp-sender.js';
import {
  imapQuote,
  parseImapResponses,
  parseSearchUids,
  parseFetchItems,
  parseEnvelope,
  listInbox,
  readMessage,
  READ_BODY_CAP_BYTES,
} from '../../backend/services/email/imap-reader.js';

// Built with fromCharCode — the harness mangles literal escapes (see
// feedback_harness_escape_mangling).
const NUL = String.fromCharCode(0);

const CREDS = Object.freeze({
  address: 'keir@example.com',
  username: 'keir@example.com',
  password: 'app-password-1234',
  smtpHost: '127.0.0.1',
  smtpPort: '465',
  imapHost: '127.0.0.1',
  imapPort: '993',
});

// A real TCP listener that accepts and stays silent — the client's TLS
// handshake genuinely starts and never completes, so abort/timeout paths
// run on a live socket without a packet leaving the box.
const silentServer = () => new Promise((resolve) => {
  const server = net.createServer(() => {});
  server.listen(0, '127.0.0.1', () => {
    resolve({ port: String(server.address().port), close: () => server.close() });
  });
});

describe('mime codecs', () => {
  it('decodes B and Q encoded-words including adjacent-word whitespace', () => {
    const b = `=?UTF-8?B?${Buffer.from('héllo wörld', 'utf8').toString('base64')}?=`;
    expect(decodeEncodedWords(b)).toBe('héllo wörld');
    expect(decodeEncodedWords('=?utf-8?Q?caf=C3=A9_time?=')).toBe('café time');
    expect(decodeEncodedWords('=?UTF-8?B?aGk=?= =?UTF-8?B?IHRoZXJl?=')).toBe('hi there');
    expect(decodeEncodedWords('plain subject')).toBe('plain subject');
  });

  it('round-trips a non-ASCII subject through encodeHeaderWord', () => {
    const subject = 'Приветствие от Keir — 日本語も';
    expect(decodeEncodedWords(encodeHeaderWord(subject)).replace(/\r\n /g, '')).toBe(subject);
    expect(encodeHeaderWord('plain ascii')).toBe('plain ascii');
  });

  it('splits long non-ASCII headers into RFC-legal encoded words', () => {
    const long = 'ü'.repeat(120);
    for (const line of encodeHeaderWord(long).split('\r\n ')) {
      expect(line.length).toBeLessThanOrEqual(75);
      expect(line).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
  });

  it('decodes quoted-printable with soft breaks and applies charsets', () => {
    expect(charsetToString(decodeQuotedPrintable('caf=C3=A9 mor=\r\nning'), 'utf-8')).toBe('café morning');
    expect(charsetToString(Buffer.from([0xe9]), 'iso-8859-1')).toBe('é');
  });

  it('wraps base64 bodies at 76 columns and round-trips', () => {
    const text = 'line one\r\n'.repeat(30);
    const encoded = encodeBase64Body(text);
    for (const line of encoded.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
    expect(Buffer.from(encoded.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe(text);
  });

  it('parses folded headers and quoted content-type params', () => {
    const headers = parseMimeHeaders('Subject: a very\r\n long subject\r\nFrom: <a@b.co>\r\n');
    expect(headers.subject).toBe('a very long subject');
    const ct = parseContentType('multipart/alternative; boundary="=_b 1"; charset=UTF-8');
    expect(ct.type).toBe('multipart/alternative');
    expect(ct.params.boundary).toBe('=_b 1');
  });

  it('extracts the text/plain part from a real multipart message', () => {
    const raw = [
      'From: lead@example.com',
      'Content-Type: multipart/alternative; boundary="XYZ"',
      '',
      '--XYZ',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('interested in Ignis — call me', 'utf8').toString('base64'),
      '--XYZ',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>interested</p>',
      '--XYZ--',
      '',
    ].join('\r\n');
    expect(extractTextPart(raw)).toEqual({
      text: 'interested in Ignis — call me',
      contentType: 'text/plain',
    });
  });

  it('extracts quoted-printable single-part bodies and reports no-text messages', () => {
    const qp = 'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\ncaf=C3=A9';
    expect(extractTextPart(qp)?.text).toBe('café');
    const image = 'Content-Type: image/png\r\n\r\n\x89PNG';
    expect(extractTextPart(image)).toBeNull();
  });
});

describe('smtp sender — pure core', () => {
  it('validates recipients, subject, and text; fails closed', () => {
    expect(validateSendRequest({}).ok).toBe(false);
    expect(validateSendRequest({ to: 'not-an-address', subject: 's', text: 't' }).ok).toBe(false);
    expect(validateSendRequest({ to: 'a@b.co', subject: '', text: 't' }).ok).toBe(false);
    expect(validateSendRequest({ to: 'a@b.co', subject: 's', text: '' }).ok).toBe(false);
    const many = Array.from({ length: 11 }, (_, i) => `p${i}@b.co`);
    expect(validateSendRequest({ to: many, subject: 's', text: 't' }).ok).toBe(false);
    const good = validateSendRequest({ to: 'lead@example.com', subject: 'Hello', text: 'Hi there' });
    expect(good).toMatchObject({ ok: true, to: ['lead@example.com'] });
  });

  it('refuses header injection through the subject or an address', () => {
    const crlf = String.fromCharCode(13, 10);
    expect(validateSendRequest({
      to: 'a@b.co',
      subject: `hi${crlf}Bcc: everyone@example.com`,
      text: 't',
    }).ok).toBe(false);
    expect(validateSendRequest({
      to: `a@b.co${crlf}RCPT TO:<x@y.z>`,
      subject: 's',
      text: 't',
    }).ok).toBe(false);
  });

  it('builds an RFC 5322 message whose body decodes back to the text', () => {
    const message = buildMimeMessage({
      from: 'keir@example.com',
      to: ['lead@example.com', 'second@example.com'],
      subject: 'Ignis intro',
      text: 'Hello from Keir.\r\n.leading dot line',
      date: new Date('2026-07-20T00:00:00Z'),
      messageId: '<abc123@example.com>',
    });
    const [headerBlock, body] = message.split('\r\n\r\n');
    const headers = parseMimeHeaders(headerBlock);
    expect(headers.from).toBe('<keir@example.com>');
    expect(headers.to).toBe('<lead@example.com>, <second@example.com>');
    expect(headers['message-id']).toBe('<abc123@example.com>');
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'))
      .toBe('Hello from Keir.\r\n.leading dot line');
  });

  it('dot-stuffs and recognizes complete multi-line replies', () => {
    expect(dotStuff('.start\r\nmid\r\n.dot')).toBe('..start\r\nmid\r\n..dot');
    expect(smtpReplyComplete('250-first\r\n250-second\r\n')).toBe(false);
    expect(smtpReplyComplete('250-first\r\n250 done\r\n')).toBe(true);
    expect(smtpReplyComplete('220 smtp.gmail.com ESMTP\r\n')).toBe(true);
  });

  it('builds the exact dialogue: greet, EHLO, AUTH PLAIN, envelope, DATA, QUIT', () => {
    const steps = buildSmtpDialogue(CREDS, {
      from: CREDS.address,
      to: ['a@b.co', 'c@d.co'],
      message: '.stuffme',
    });
    expect(steps[0]).toEqual({ send: null, expect: 220 });
    expect(steps[1].send).toBe('EHLO neuma.local');
    const auth = Buffer.from(steps[2].send.replace('AUTH PLAIN ', ''), 'base64').toString('utf8');
    expect(auth).toBe([NUL, CREDS.username, NUL, CREDS.password].join(""));
    expect(steps[3].send).toBe(`MAIL FROM:<${CREDS.address}>`);
    expect(steps[4].send).toBe('RCPT TO:<a@b.co>');
    expect(steps[5].send).toBe('RCPT TO:<c@d.co>');
    expect(steps[6]).toEqual({ send: 'DATA', expect: 354 });
    expect(steps[7].send).toBe('..stuffme\r\n.');
    expect(steps[8]).toEqual({ send: 'QUIT', expect: 221 });
  });
});

describe('smtp sender — runner against a real socket', () => {
  it('reports not configured on null credentials', async () => {
    expect(await sendEmail(null, { to: 'a@b.co', subject: 's', text: 't' }))
      .toEqual({ ok: false, detail: 'email credentials are not configured' });
  });

  it('a live abort cuts the in-flight connection (real TLS attempt, silent peer)', async () => {
    const server = await silentServer();
    const controller = new AbortController();
    const outcome = sendEmail(
      { ...CREDS, smtpPort: server.port },
      { to: 'lead@example.com', subject: 'never sent', text: 'never sent' },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 50);
    expect(await outcome).toEqual({ ok: false, detail: 'interrupted by your operator before sending' });
    server.close();
  });
});

describe('imap reader — pure core', () => {
  it('quotes safely and refuses control characters', () => {
    expect(imapQuote('user@x.co')).toBe('"user@x.co"');
    expect(imapQuote('pa"ss\\word')).toBe('"pa\\"ss\\\\word"');
    expect(imapQuote(`bad${String.fromCharCode(13)}login`)).toBeNull();
  });

  it('tokenizes responses with literals and keeps incomplete bytes as rest', () => {
    const header = 'From: a@b.co\r\nSubject: hi\r\n\r\n';
    const buf = Buffer.concat([
      Buffer.from('* SEARCH 3 7 12\r\n'),
      Buffer.from(`* 1 FETCH (UID 7 FLAGS (\\Seen) BODY[HEADER] {${header.length}}\r\n`),
      Buffer.from(header),
      Buffer.from(')\r\n'),
      Buffer.from('A2 OK done\r\nA3 partial'),
    ]);
    const { responses, rest } = parseImapResponses(buf);
    expect(responses).toHaveLength(3);
    expect(responses[0].text).toBe('* SEARCH 3 7 12');
    expect(responses[1].text).toBe('* 1 FETCH (UID 7 FLAGS (\\Seen) BODY[HEADER] )');
    expect(responses[1].literals[0].toString('utf8')).toBe(header);
    expect(rest.toString('utf8')).toBe('A3 partial');
  });

  it('holds a response whose literal has not fully arrived', () => {
    const { responses, rest } = parseImapResponses(Buffer.from('* 1 FETCH (BODY[] {100}\r\nonly a few bytes'));
    expect(responses).toHaveLength(0);
    expect(rest.length).toBeGreaterThan(0);
  });

  it('parses search uids, fetch items, and envelopes with encoded-words', () => {
    expect(parseSearchUids([{ text: '* SEARCH 9 2 5' }])).toEqual([2, 5, 9]);
    expect(parseSearchUids([{ text: '* SEARCH' }])).toEqual([]);
    const items = parseFetchItems([
      { text: '* 4 FETCH (UID 44 FLAGS (\\Seen \\Answered) BODY[HEADER.FIELDS (FROM)] )', literals: [Buffer.from('From: x@y.z\r\n')] },
      { text: '* 5 FETCH (UID 45 FLAGS () BODY[HEADER.FIELDS (FROM)] )', literals: [] },
      { text: '* OK still here', literals: [] },
    ]);
    expect(items).toEqual([
      { uid: 44, seen: true, payload: expect.any(Buffer) },
      { uid: 45, seen: false, payload: null },
    ]);
    const envelope = parseEnvelope(Buffer.from(
      'From: =?UTF-8?B?TMOpYQ==?= <lea@example.com>\r\nSubject: =?utf-8?Q?caf=C3=A9?=\r\nDate: Sun, 19 Jul 2026 12:00:00 +0000\r\n\r\nbody noise: ignored',
    ));
    expect(envelope.from).toBe('Léa <lea@example.com>');
    expect(envelope.subject).toBe('café');
    expect(envelope.date).toBe('Sun, 19 Jul 2026 12:00:00 +0000');
  });
});

describe('imap reader — runner against a real socket', () => {
  it('reports not configured on null or malformed credentials', async () => {
    expect(await listInbox(null)).toEqual({ ok: false, detail: 'email credentials are not configured' });
    expect((await listInbox({ ...CREDS, imapPort: 'nope' })).ok).toBe(false);
    expect((await readMessage({ ...CREDS, password: `x${String.fromCharCode(10)}y` }, 1)).ok).toBe(false);
  });

  it('rejects a non-positive uid before touching the network', async () => {
    expect(await readMessage(CREDS, 0)).toEqual({ ok: false, detail: 'a positive message uid is required' });
  });

  it('a live abort cuts an in-flight session (real TLS attempt, silent peer)', async () => {
    const server = await silentServer();
    const controller = new AbortController();
    const outcome = listInbox({ ...CREDS, imapPort: server.port }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    expect(await outcome).toEqual({ ok: false, detail: 'interrupted by your operator' });
    server.close();
  });

  it('exposes the read cap the portal advertises', () => {
    expect(READ_BODY_CAP_BYTES).toBe(262144);
  });
});
