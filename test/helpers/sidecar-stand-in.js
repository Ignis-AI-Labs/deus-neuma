// sidecar-stand-in.js — a REAL child process serving the voice-sidecar HTTP
// contract (/health with idle_seconds, POST /shutdown that exits) on a given
// port. Used to prove the engine-manager's adopt→reap lifecycle with a real
// process dying over real HTTP — nothing in the manager's path is faked.
// The Python side of the same contract is proven separately by the live
// engine test (VOICE_ENGINES_LIVE=1).
//
// Usage: node sidecar-stand-in.js <port> <idleSeconds|none>

import { createServer } from 'node:http';

const port = Number(process.argv[2]);
const idleArg = process.argv[3];

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/shutdown') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, shutting_down: true }));
    setTimeout(() => process.exit(0), 100);
    return;
  }
  if (req.url === '/health') {
    const body = { ok: true, model: 'stand-in' };
    if (idleArg !== 'none') body.idle_seconds = Number(idleArg);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write('LISTENING\n');
});
