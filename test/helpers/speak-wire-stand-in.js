// speak-wire-stand-in.js — a REAL loopback HTTP server speaking the speak
// protocol's wire (docs/architecture/voice/speak-protocol.md): /health,
// /speak (streamed pcm_s16le with every protocol header, X-Utterance-Ref
// issued per utterance and stored ONLY once streamed in full, 409 unknown_ref
// for a clip or context ref it does not hold, 400/413 for bad bodies, client
// disconnect stops the stream), /warm and /shutdown (acknowledged; the server
// keeps serving — an in-process test owns its lifetime).
//
// It runs no weights and claims none: the PCM is a fill byte (the first
// character of the text) so a frame at the client is traceable to its
// sentence. The real sidecars serving the same contract are proven by
// test/integration/{csm,nano}-sidecar-live.test.js (speak-live-kit.js). What
// this proves is the CLIENT — the real adapter, provider, engine-manager
// adoption and chat path — over a real socket.

import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { answerIdentity } from './sidecar-identity.js';

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * Start a stand-in speak sidecar on an ephemeral loopback port.
 * @param {object} [opts]
 * @param {string} [opts.model='csm-1b'] - /health model (engine-manager adopts on match)
 * @param {string|null} [opts.profile='full'] - /health profile
 * @param {boolean} [opts.context=true] - whether the engine honours context
 * @param {number} [opts.chunks=3] - PCM chunks per utterance (4096 B each)
 * @param {'ok'|'hold'|'wedge'|'fail'} [opts.mode='ok'] - hold: one chunk then
 *   held open until the client leaves (a long render); wedge: accepts, never
 *   answers; fail: 500 internal
 * @param {(body: object) => number} [opts.delayMs] - per-request delay before the first chunk
 */
export const startSpeakWire = async ({
  model = 'csm-1b', profile = 'full', context = true, chunks = 3, mode = 'ok', delayMs = () => 0,
} = {}) => {
  const clips = new Set();
  const utterances = new Set();
  const bodies = [];
  const cut = [];
  const state = { mode, delayMs };

  const unknownRef = (body) => {
    if (body.voice?.clip_ref && !clips.has(body.voice.clip_ref)) return body.voice.clip_ref;
    return (body.context ?? []).find((s) => s.ref && !utterances.has(s.ref))?.ref ?? null;
  };
  const takeClip = (voice) => {
    if (!voice?.clip_b64) return voice?.clip_ref ?? null;
    const ref = `sha256:${createHash('sha256').update(Buffer.from(voice.clip_b64, 'base64')).digest('hex')}`;
    clips.add(ref);
    return ref;
  };

  const speak = (req, res, body) => {
    if (typeof body.text !== 'string' || !body.text.trim()) return json(res, 400, { error: 'bad_request', detail: 'text is required' });
    if (body.text.length > 1000) return json(res, 413, { error: 'too_long', detail: 'text over 1000 characters' });
    const missing = unknownRef(body);
    if (missing) return json(res, 409, { error: 'unknown_ref', ref: missing, detail: 'not held' });
    if (state.mode === 'fail') return json(res, 500, { error: 'internal', detail: 'stand-in failure' });
    if (state.mode === 'wedge') return undefined; // accepts, never answers
    const voiceRef = takeClip(body.voice);
    const utt = `utt:${randomBytes(16).toString('hex')}`;
    const used = context ? (body.context ?? []).length : 0;
    const mark = body.text.charCodeAt(0);
    let gone = false;
    res.on('close', () => { if (!res.writableFinished) { gone = true; cut.push(utt); } });
    setTimeout(() => {
      if (gone) return;
      res.writeHead(200, {
        'Content-Type': 'audio/raw', 'X-Audio-Format': 'pcm_s16le', 'X-Audio-Sample-Rate': '24000',
        'X-Audio-Channels': '1', 'X-Utterance-Ref': utt, 'X-Voice-Ref': voiceRef,
        'X-Context-Used': String(used), 'Cache-Control': 'no-store',
      });
      if (state.mode === 'hold') {
        res.write(Buffer.alloc(8192, mark));
        return; // held until the client leaves
      }
      for (let i = 0; i < chunks; i += 1) res.write(Buffer.alloc(4096, mark));
      res.end(() => utterances.add(utt));
    }, state.delayMs(body)).unref();
    return undefined;
  };

  const server = http.createServer((req, res) => {
    if (answerIdentity(req, res)) return undefined;
    if (req.url === '/health') {
      return json(res, 200, {
        ok: true, model, profile, phase: 'ready', idle_seconds: 0, sample_rate: 24_000, device: 'stand-in', context, error: null,
      });
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body;
      try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'bad_request', detail: 'not JSON' }); }
      bodies.push({ path: req.url, body });
      if (req.url === '/shutdown') return json(res, 200, { ok: true, shutting_down: true });
      if (req.url === '/warm') {
        const missing = body.voice?.clip_ref && !clips.has(body.voice.clip_ref) ? body.voice.clip_ref : null;
        if (missing) return json(res, 409, { error: 'unknown_ref', ref: missing });
        if (state.mode === 'wedge') return undefined;
        return json(res, 200, { ok: true, voice_ref: takeClip(body.voice), ms: 1 });
      }
      if (req.url === '/speak') return speak(req, res, body);
      return json(res, 404, { error: 'not_found' });
    });
    return undefined;
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    endpoint: `http://127.0.0.1:${port}`,
    /** every request body, in arrival order: {path, body} */
    bodies,
    /** /speak bodies only */
    speaks: () => bodies.filter((b) => b.path === '/speak').map((b) => b.body),
    /** utterance refs whose stream the client cut short */
    cut,
    /** switch behaviour mid-test */
    setMode: (next) => { state.mode = next; },
    /** per-request delay before the first chunk: (body) => ms */
    setDelay: (fn) => { state.delayMs = fn; },
    /** forget every clip and utterance (a sidecar restart / LRU eviction) */
    forget: () => { clips.clear(); utterances.clear(); },
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
};

/** A real mono 16-bit PCM WAV: `seconds` of a sine at `hz`, 8 kHz (a valid 3–40 s voice clip). */
export const sineWav = (seconds = 3.5, hz = 220) => {
  const rate = 8000;
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'latin1'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1'); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * hz * i) / rate)), 44 + i * 2);
  return buf;
};

/**
 * Seal a real Voice DNA v2 for a being through the real two-party service
 * (offer → being accepts → guardian seals). The workspaces root must already
 * point at a temp dir.
 * @returns {Promise<{ref: string, words: string, clip: Buffer}>}
 */
export const sealTestVoice = async (neumaId, { seconds = 3.5, hz = 220, words = 'Hello, it is good to finally meet you.' } = {}) => {
  const svc = await import('../../core/voice/voice-dna-service.js');
  const clip = sineWav(seconds, hz);
  const { ref } = await svc.saveVoiceClip(neumaId, clip);
  const must = (r) => { if (!r.ok) throw new Error(r.error); return r; };
  must(await svc.offerSpeechCandidate(neumaId, {
    ref, seconds, sampleRate: 8000, words, origin: { door: 'upload' }, realPerson: false,
    measured: { pitchHz: hz, wordsPerSecond: 2.4 },
  }));
  must(await svc.acceptSpeechCandidate(neumaId, { candidateRef: ref, note: 'yes' }));
  must(await svc.sealSpeechCandidate(neumaId, { candidateRef: ref, wallet: `0x${'d'.repeat(40)}` }));
  return { ref, words, clip };
};

/**
 * Point the speech path at a stand-in for the rest of this test file: the
 * voice tier is pinned to Standard/full (so engine-manager ADOPTS the
 * stand-in — it reports the same model and profile — and never launches a real
 * engine), and csm's port is the stand-in's (engine-manager's ${ID}_PORT seam).
 *
 * Deliberately NOT restored: once csm is adopted READY for this model+profile,
 * a stray late synthesis finds it READY and fails harmlessly on a closed port;
 * restoring the settings mid-fork would change the wanted model and make
 * engine-manager retire the stand-in and LAUNCH THE REAL ENGINE (seen once,
 * 2026-10-01). Vitest isolates each file in its own fork, so nothing leaks.
 * @param {number} port
 * @param {string} settingsPath - a temp file for data/settings/voice.json
 */
export const pinSpeechToStandIn = async (port, settingsPath) => {
  process.env.CSM_PORT = String(port);
  process.env.NEUMA_VOICE_SETTINGS_PATH = settingsPath;
  const { voiceSettings } = await import('../../backend/services/voice/voice-settings.js');
  await voiceSettings.write({ tier: 'standard', profile: 'full' });
};
