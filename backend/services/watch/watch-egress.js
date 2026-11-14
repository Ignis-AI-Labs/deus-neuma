// watch-egress — the one door the downloader reaches the network through.
//
// yt-dlp makes its own connections, so the web guard that stands in front of every page a neuma
// reads (web-guard.js: outward only, never this computer or its network, every name resolved once
// and pinned) cannot stand inside it. It stands here instead: a proxy on this computer's loopback,
// alive for one download, that the downloader is told to use for everything. Each tunnel (HTTPS) and
// each plain request (HTTP) is judged by assertSafeWebTarget and connected to the addresses it
// vetted, so a page that points the downloader at a router, a model server or the backend itself is
// refused, and said so. It reaches only what any program on this computer can already reach, so it
// asks no password. impure (sockets, DNS)
import http from 'node:http';
import net from 'node:net';
import { assertSafeWebTarget } from '../web-guard.js';
import { pinnedLookup } from '../web-fetch.js';

const REFUSED = 'refused by the platform';

// impure — a TCP connection to the first vetted address that answers
const connectVetted = (addrs, port) => new Promise((resolve, reject) => {
  const tryAt = (i) => {
    if (i >= addrs.length) return reject(new Error('no vetted address answered'));
    const socket = net.connect({ host: addrs[i].address, port, family: addrs[i].family });
    socket.once('connect', () => { socket.removeAllListeners('error'); resolve(socket); });
    socket.once('error', () => { socket.destroy(); tryAt(i + 1); });
    socket.setTimeout(30_000, () => socket.destroy(new Error('timeout')));
  };
  tryAt(0);
});

/**
 * Start a guarded proxy for one download. impure
 * @returns {Promise<{url: string, refused: string[], close: () => Promise<void>}>} `refused`: the
 *   hosts it would not reach, with why, for the being's answer
 */
export const startWatchEgress = async () => {
  const refused = [];
  const sockets = new Set();
  const refuse = (where, reason) => { refused.push(`${where} (${reason})`); };

  const server = http.createServer(async (req, res) => {
    // a plain-HTTP request arrives in absolute form: http://host/path
    let target;
    try { target = new URL(req.url); } catch { res.writeHead(400).end(); return; }
    const guard = await assertSafeWebTarget(target.href);
    if (!guard.ok || target.protocol !== 'http:') {
      refuse(target.host, guard.reason || 'not http');
      res.writeHead(403, REFUSED).end();
      return;
    }
    const headers = { ...req.headers };
    for (const h of Object.keys(headers)) if (/^proxy-/i.test(h)) delete headers[h];
    const upstream = http.request(target, { method: req.method, headers, lookup: pinnedLookup(guard.addrs), timeout: 30_000 }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); });
    req.pipe(upstream);
  });

  // a tunnel: CONNECT host:port, then bytes both ways (the TLS stays end to end)
  server.on('connect', async (req, client, head) => {
    sockets.add(client);
    client.once('close', () => sockets.delete(client));
    client.on('error', () => {});
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(String(req.url || ''));
    const host = m?.[1];
    const port = Number(m?.[2]);
    const guard = host && port > 0 && port < 65536 ? await assertSafeWebTarget(`https://${host.includes(':') ? `[${host}]` : host}:${port}/`) : { ok: false, reason: 'bad-target' };
    if (!guard.ok) {
      refuse(String(req.url), guard.reason);
      client.end(`HTTP/1.1 403 ${REFUSED}\r\n\r\n`);
      return;
    }
    try {
      const upstream = await connectVetted(guard.addrs, port);
      sockets.add(upstream);
      upstream.once('close', () => sockets.delete(upstream));
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    } catch {
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    refused,
    close: () => new Promise((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
};
