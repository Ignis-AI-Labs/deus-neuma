// A real mail server for a test (RULE 0 — no mock in the path): implicit TLS
// on a free localhost port, a throwaway certificate made by the real openssl,
// trusted by THIS test process only (Node's own trust store,
// tls.setDefaultCACertificates — the house's SMTP sender verifies it exactly
// as it verifies a provider's), speaking the SMTP the sender speaks. Every
// message that arrives is kept whole; close() restores the trust store.

import fs from 'fs/promises';
import path from 'path';
import tls from 'tls';
import { execFileSync } from 'child_process';

const reply = (socket, line) => socket.write(`${line}\r\n`);

// One session: EHLO, AUTH, MAIL, RCPT, DATA … '.', QUIT — each answered as the sender expects.
const session = (socket, received) => {
  let buffer = '';
  let data = null;
  let envelope = { from: null, to: [] };
  reply(socket, '220 localhost ESMTP test');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let at = buffer.indexOf('\r\n');
    while (at >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      if (data !== null) {
        if (line === '.') {
          received.push({ ...envelope, data: data.join('\r\n') });
          data = null;
          envelope = { from: null, to: [] };
          reply(socket, '250 2.0.0 queued as T1');
        } else data.push(line);
      } else if (/^EHLO/i.test(line)) reply(socket, '250 localhost');
      else if (/^AUTH PLAIN/i.test(line)) reply(socket, '235 2.7.0 accepted');
      else if (/^MAIL FROM:/i.test(line)) { envelope.from = line.slice(10).replace(/[<>]/g, ''); reply(socket, '250 2.1.0 ok'); }
      else if (/^RCPT TO:/i.test(line)) { envelope.to.push(line.slice(8).replace(/[<>]/g, '')); reply(socket, '250 2.1.5 ok'); }
      else if (/^DATA/i.test(line)) { data = []; reply(socket, '354 go ahead'); }
      else if (/^QUIT/i.test(line)) { reply(socket, '221 2.0.0 bye'); socket.end(); }
      else reply(socket, '502 not here');
      at = buffer.indexOf('\r\n');
    }
  });
  socket.on('error', () => {});
};

/**
 * @param {string} dir - an empty tmp directory for the certificate
 * @returns {Promise<{port: number, received: Array<{from: string, to: string[], data: string}>, close: () => Promise<void>}>}
 */
export const startTlsSmtp = async (dir) => {
  const key = path.join(dir, 'smtp-key.pem');
  const cert = path.join(dir, 'smtp-cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  const [keyPem, certPem] = await Promise.all([fs.readFile(key, 'utf8'), fs.readFile(cert, 'utf8')]);
  const before = tls.getCACertificates('default');
  tls.setDefaultCACertificates([...before, certPem]);
  const received = [];
  const server = tls.createServer({ key: keyPem, cert: certPem }, (socket) => session(socket, received));
  const port = await new Promise((resolve) => server.listen(0, 'localhost', () => resolve(server.address().port)));
  return {
    port,
    received,
    close: () => new Promise((resolve) => server.close(() => { tls.setDefaultCACertificates(before); resolve(); })),
  };
};
