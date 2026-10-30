// A real IMAP server for a test (RULE 0 — no mock in the path): implicit TLS
// on a free localhost port, a throwaway certificate made by the real openssl,
// trusted by THIS test process only (tls.setDefaultCACertificates, as
// smtp-tls-kit.js does), speaking the IMAP the house's reader speaks: LOGIN,
// EXAMINE INBOX, UID SEARCH ALL, UID FETCH (envelopes, or a whole message),
// LOGOUT. deliver() puts new mail in the box; logins counts every session.

import fs from 'fs/promises';
import path from 'path';
import tls from 'tls';
import { Buffer } from 'buffer';
import { execFileSync } from 'child_process';

const line = (socket, text) => socket.write(`${text}\r\n`);
const raw = (m) => [`From: ${m.from}`, `To: ${m.to ?? 'house@tidewater.example'}`, `Subject: ${m.subject}`, `Date: ${m.date ?? new Date().toUTCString()}`,
  `Message-ID: <${m.uid}@test>`, '', m.body ?? ''].join('\r\n');
const headers = (m) => `${raw(m).split('\r\n\r\n')[0]}\r\n\r\n`;

// One session, answered as the reader expects.
const session = (socket, box, state) => {
  let buffer = '';
  line(socket, '* OK IMAP4rev1 test ready');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let at = buffer.indexOf('\r\n');
    while (at >= 0) {
      const command = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const [tag, ...rest] = command.split(' ');
      const verb = rest.join(' ');
      if (/^LOGIN /i.test(verb)) { state.logins += 1; line(socket, `${tag} OK logged in`); }
      else if (/^EXAMINE INBOX/i.test(verb)) { line(socket, `* ${box.length} EXISTS`); line(socket, `${tag} OK [READ-ONLY] examined`); }
      else if (/^UID SEARCH ALL/i.test(verb)) { line(socket, `* SEARCH ${box.map((m) => m.uid).join(' ')}`.trim()); line(socket, `${tag} OK search done`); }
      else if (/^UID FETCH /i.test(verb)) {
        const uids = verb.split(' ')[2].split(',').map(Number);
        const whole = /BODY\.PEEK\[\]/i.test(verb);
        for (const m of box.filter((x) => uids.includes(x.uid))) {
          const payload = whole ? raw(m) : headers(m);
          socket.write(`* ${box.indexOf(m) + 1} FETCH (UID ${m.uid} FLAGS () BODY[${whole ? '' : 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)'}] {${Buffer.byteLength(payload)}}\r\n${payload})\r\n`);
        }
        line(socket, `${tag} OK fetch done`);
      } else if (/^LOGOUT/i.test(verb)) { line(socket, '* BYE'); line(socket, `${tag} OK bye`); socket.end(); }
      else line(socket, `${tag} BAD not here`);
      at = buffer.indexOf('\r\n');
    }
  });
  socket.on('error', () => {});
};

/**
 * @param {string} dir - an empty tmp directory for the certificate
 * @returns {Promise<{port: number, deliver: (m: {from: string, subject: string, body?: string}) => number,
 *   state: {logins: number}, close: () => Promise<void>}>}
 */
export const startTlsImap = async (dir) => {
  const key = path.join(dir, 'imap-key.pem');
  const cert = path.join(dir, 'imap-cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  const [keyPem, certPem] = await Promise.all([fs.readFile(key, 'utf8'), fs.readFile(cert, 'utf8')]);
  const before = tls.getCACertificates('default');
  tls.setDefaultCACertificates([...before, certPem]);
  const box = [];
  const state = { logins: 0 };
  const server = tls.createServer({ key: keyPem, cert: certPem }, (socket) => session(socket, box, state));
  const port = await new Promise((resolve) => server.listen(0, 'localhost', () => resolve(server.address().port)));
  return {
    port,
    state,
    deliver: (m) => {
      const uid = (box.at(-1)?.uid ?? 100) + 1;
      box.push({ ...m, uid });
      return uid;
    },
    close: () => new Promise((resolve) => server.close(() => { tls.setDefaultCACertificates(before); resolve(); })),
  };
};
