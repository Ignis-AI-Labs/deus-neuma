// transcribe-wire-stand-in.js — a REAL loopback HTTP server speaking the
// whisper sidecar's forge contract (voice-engines/whisper/server.py): /health
// (ready), POST /transcribe (any audio body → {text, language,
// durationSeconds}) and /shutdown (acknowledged; an in-process test owns its
// lifetime). The backend's real engine-manager ADOPTS it when WHISPER_PORT
// points here, so no real sidecar is launched.
//
// It runs no weights and claims none: it answers the words it was told the
// audio says — the test renders exactly those words with espeak-ng. The real
// whisper behind the same contract is proven by api-voice-forge-seal (CPU
// whisper). What this proves is the forge path around it, over a real socket.

import http from 'node:http';

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * Start a stand-in transcriber on an ephemeral loopback port.
 * @param {{text: string}} opts - the words every /transcribe answers
 */
export const startTranscribeWire = async ({ text }) => {
  const heard = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/health') return json(res, 200, { ok: true, phase: 'ready', idle_seconds: 0, device: 'stand-in', error: null });
    let bytes = 0;
    req.on('data', (c) => { bytes += c.length; });
    req.on('end', () => {
      if (req.url === '/shutdown') return json(res, 200, { ok: true, shutting_down: true });
      if (req.method === 'POST' && req.url.split('?')[0] === '/transcribe') {
        if (!bytes) return json(res, 400, { detail: 'no audio' });
        heard.push(bytes);
        return json(res, 200, { text, language: 'en', durationSeconds: 0 });
      }
      return json(res, 404, { error: 'not_found' });
    });
    return undefined;
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    /** the byte length of every audio body transcribed, in arrival order */
    heard,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
};
