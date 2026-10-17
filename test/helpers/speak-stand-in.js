// speak-stand-in.js — a REAL child process serving the speak-protocol /health
// and /shutdown contract (docs/architecture/voice/speak-protocol.md) on a
// port: the model it serves, the phase timeline a real sidecar walks
// (loading → compiling → ready | failed), idle_seconds, and a /shutdown that
// exits the process. It proves the engine-manager's lifecycle decisions —
// adopt, wait through a compile, surface a failed load, retire a sidecar
// serving the wrong model — with a real process over real HTTP. The Python
// sidecars that serve the same contract are proven by the *-sidecar-live tests.
//
// Usage: node speak-stand-in.js <port> '<json options>'
//   { "model": "csm-1b" | null, "profile": "full" | null, "idle": 12 | null,
//     "phases": [["loading", 300], ["compiling", 1200]],   // each held for N ms, then…
//     "final": "ready" | "failed", "error": "why it failed" }

import { createServer } from 'node:http';

const port = Number(process.argv[2]);
const opts = JSON.parse(process.argv[3] || '{}');
const started = Date.now();

// the phase at this instant: walk the timeline, then settle on the final phase
const phaseNow = () => {
  let t = Date.now() - started;
  for (const [phase, ms] of opts.phases ?? []) {
    if (t < ms) return phase;
    t -= ms;
  }
  return opts.final ?? 'ready';
};

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/shutdown') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, shutting_down: true }));
    setTimeout(() => process.exit(0), 100);
    return;
  }
  if (req.url === '/health') {
    const phase = phaseNow();
    const body = {
      ok: phase === 'ready', model: opts.model ?? 'stand-in', profile: opts.profile ?? null, phase,
      error: phase === 'failed' ? (opts.error ?? 'stand-in failure') : null,
    };
    if (opts.idle !== null && opts.idle !== undefined) body.idle_seconds = opts.idle;
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
