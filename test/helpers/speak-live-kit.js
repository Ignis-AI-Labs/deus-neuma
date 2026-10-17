// speak-live-kit.js — shared plumbing for the *-sidecar-live tests: the REAL
// speak-protocol sidecars (voice-engines/{csm,chatterbox-nano}/server.py)
// launched through the real engine-manager, driven over real loopback HTTP.
// Nothing here stands in for the sidecar; it only reads what it says.

import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REFS = fileURLToPath(new URL('../../voice-engines/_samples/bakeoff-r2/refs/', import.meta.url));

/**
 * The opt-in: real GPU/CPU voice engines run only when summoned
 * (RUN_VOICE_ENGINE_LIVE=1 — presence is not consent, test/helpers/gpu-optin.js),
 * and only where the gitignored bake-off reference clips exist.
 */
export const voiceEngineLiveOptIn = () =>
  process.env.RUN_VOICE_ENGINE_LIVE === '1' && existsSync(`${REFS}Hannah.wav`) && existsSync(`${REFS}James.wav`);

/** An ephemeral loopback port nobody holds right now (the port law: tests bind :0). */
export const freePort = () => new Promise((resolve, reject) => {
  const srv = createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

/** A bake-off reference clip: { b64, words } (Hannah / James, LibriVox / CC0 donations). */
export const refClip = (name) => ({
  b64: readFileSync(`${REFS}${name}.wav`).toString('base64'),
  words: JSON.parse(readFileSync(`${REFS}transcripts.json`, 'utf8'))[name],
});

/**
 * Poll /health until stopped, collecting every phase the sidecar reported
 * (in order, de-duplicated) and when each was first seen.
 */
export const watchPhases = (endpoint, intervalMs = 250) => {
  const seen = [];
  const t0 = Date.now();
  let live = true;
  const loop = (async () => {
    while (live) {
      try {
        const h = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1000) }).then((r) => r.json());
        if (seen.at(-1)?.phase !== h.phase) seen.push({ phase: h.phase, atMs: Date.now() - t0 });
      } catch { /* not listening yet (uv sync, interpreter start) */ }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return { seen, stop: async () => { live = false; await loop; } };
};

/** POST JSON; resolve { status, body } for non-audio answers. */
export const postJson = async (endpoint, path, body) => {
  const r = await fetch(`${endpoint}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/**
 * POST /speak and read the streamed PCM. `stopAfterFirst` aborts the request
 * right after the first chunk (a barge-in). Returns the headers, the first
 * chunk latency (request start → first audio byte), bytes, and RTF.
 */
export const speak = async (endpoint, body, { stopAfterFirst = false } = {}) => {
  const ac = new AbortController();
  const t0 = performance.now();
  const r = await fetch(`${endpoint}/speak`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal,
  });
  const headers = Object.fromEntries(r.headers.entries());
  if (r.status !== 200) return { status: r.status, headers, body: await r.json().catch(() => null) };
  const reader = r.body.getReader();
  let firstMs = null;
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstMs === null) firstMs = performance.now() - t0;
    bytes += value.length;
    if (stopAfterFirst) {
      ac.abort();
      break;
    }
  }
  const totalMs = performance.now() - t0;
  const audioS = bytes / 2 / 24_000;
  return {
    status: 200, headers, firstMs, bytes, totalMs, audioS,
    rtf: audioS ? totalMs / 1000 / audioS : null,
  };
};

/** Median of a list of numbers. */
export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const SHORT = "Hey. You're back, and I kept the lamp lit for you.";
const LONG = 'I want to tell you about the long road home, the one that winds past the old mill and the river, '
  + 'where the light comes low through the trees in the evening and everything smells of rain. '
  + 'We walked it every autumn, and every autumn it was a little different, a little quieter, '
  + 'as if the road itself were learning to listen to us the way we were learning to listen to it. '
  + 'I still think about that road, and about how much of who we are is just the paths we keep choosing.';
// The runaway guard's cap (voice-engines/_speak/speak_guard.py audio_cap_s): max(4 s, units x 0.55 s x 2.2),
// a unit being a word or a digit. Short lines with no context are where CSM ran on (2.9-14.6 s); the
// last line is three very long words — really spoken well past its 4 s cap — so the cap exit fires.
const GUARD_LINES = [
  { text: 'So, where were we?', capS: 4.84, takes: 6 },
  { text: 'Hmm.', capS: 4, takes: 4 },
  { text: 'Pneumonoultramicroscopicsilicovolcanoconiosis, antidisestablishmentarianism, floccinaucinihilipilification.',
    capS: 4, takes: 2 },
];

/**
 * The speak-protocol checks every sidecar must pass, as vitest `it`s, run in
 * order against a sidecar already READY at endpoint(). `rec` collects the
 * measured numbers for the run report.
 * @param {() => string} endpoint
 * @param {{ context: boolean, rec: object, it: Function, expect: Function }} o
 */
export const speakContract = (endpoint, { context, rec, it, expect }) => {
  // read on first use, never at collection: a skipped (not opted-in) run touches no sample files
  let hannah = null;
  let james = null;
  let voiceRef = null;
  let uttRef = null;

  it('/health speaks the contract', { timeout: 180_000 }, async () => {
    hannah = refClip('Hannah');
    james = refClip('James');
    const h = await fetch(`${endpoint()}/health`).then((r) => r.json());
    expect(h).toMatchObject({ ok: true, phase: 'ready', sample_rate: 24_000, context, error: null });
    expect(typeof h.idle_seconds).toBe('number');
  });

  it('streams pcm_s16le from clip_b64 (cold voice), then from clip_ref (warm)', { timeout: 180_000 }, async () => {
    const cold = await speak(endpoint(), { text: SHORT, voice: { clip_b64: hannah.b64, words: hannah.words } });
    expect(cold.status).toBe(200);
    expect(cold.headers).toMatchObject({
      'x-audio-format': 'pcm_s16le', 'x-audio-sample-rate': '24000', 'x-audio-channels': '1',
      'x-context-used': '0', 'cache-control': 'no-store',
    });
    expect(cold.headers['x-voice-ref']).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(cold.headers['x-utterance-ref']).toMatch(/^utt:[0-9a-f]{32}$/);
    expect(cold.bytes % 2).toBe(0);
    expect(cold.audioS).toBeGreaterThan(1);
    voiceRef = cold.headers['x-voice-ref'];
    uttRef = cold.headers['x-utterance-ref'];
    const warm = [];
    for (let i = 0; i < 3; i++) {
      const w = await speak(endpoint(), { text: SHORT, voice: { clip_ref: voiceRef, words: hannah.words } });
      expect(w.status).toBe(200);
      expect(w.bytes).toBeGreaterThan(24_000);
      warm.push(w);
    }
    Object.assign(rec, {
      coldFirstMs: Math.round(cold.firstMs),
      warmFirstMsMedian: Math.round(median(warm.map((w) => w.firstMs))),
      warmFirstMs: warm.map((w) => Math.round(w.firstMs)),
      warmRtfMedian: +median(warm.map((w) => w.rtf)).toFixed(3),
      warmAudioS: warm.map((w) => +w.audioS.toFixed(2)),
    });
  });

  it("re-enters its own utterance (ref) and the person's mic audio (audio_b64) as context", { timeout: 180_000 }, async () => {
    const r = await speak(endpoint(), {
      text: 'So, where were we?',
      voice: { clip_ref: voiceRef, words: hannah.words },
      context: [
        { speaker: 'being', words: SHORT, ref: uttRef },
        { speaker: 'person', words: james.words, audio_b64: james.b64 },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.headers['x-context-used']).toBe(context ? '2' : '0');
    expect(r.bytes).toBeGreaterThan(0);
    rec.contextFirstMs = Math.round(r.firstMs);
  });

  it('refuses unknown refs (409, naming the ref) and malformed bodies (400/413)', { timeout: 180_000 }, async () => {
    const ghost = `sha256:${'0'.repeat(64)}`;
    const a = await speak(endpoint(), { text: SHORT, voice: { clip_ref: ghost, words: 'x' } });
    expect(a.status).toBe(409);
    expect(a.body).toMatchObject({ error: 'unknown_ref', ref: ghost });
    const b = await speak(endpoint(), {
      text: SHORT, voice: { clip_ref: voiceRef, words: hannah.words },
      context: [{ speaker: 'being', words: 'x', ref: `utt:${'f'.repeat(32)}` }],
    });
    expect(b.status).toBe(409);
    expect((await speak(endpoint(), { text: '', voice: { clip_ref: voiceRef, words: 'x' } })).status).toBe(400);
    expect((await speak(endpoint(), { text: SHORT, voice: { clip_b64: 'not base64!', words: 'x' } })).status).toBe(400);
    expect((await speak(endpoint(), { text: 'x'.repeat(1001), voice: { clip_ref: voiceRef, words: 'x' } })).status).toBe(413);
    const notJson = await fetch(`${endpoint()}/speak`, { method: 'POST', body: '{' });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ error: 'bad_request' });
  });

  it('a client disconnect aborts generation: the lock passes on and the cut utterance is never stored', { timeout: 180_000 }, async () => {
    const cut = await speak(endpoint(), { text: LONG, voice: { clip_ref: voiceRef, words: hannah.words } },
      { stopAfterFirst: true });
    expect(cut.status).toBe(200);
    // the long reply is ~30 s of audio; had it kept generating for nobody, the next
    // utterance would queue behind all of it
    const next = await speak(endpoint(), { text: SHORT, voice: { clip_ref: voiceRef, words: hannah.words } });
    expect(next.status).toBe(200);
    rec.afterAbortFirstMs = Math.round(next.firstMs);
    expect(next.firstMs).toBeLessThan(2500);
    const reuse = await speak(endpoint(), {
      text: SHORT, voice: { clip_ref: voiceRef, words: hannah.words },
      context: [{ speaker: 'being', words: LONG, ref: cut.headers['x-utterance-ref'] }],
    });
    expect(reuse.status).toBe(409);
  });

  it('the runaway guard: no utterance outruns its text, and a cut one ends cleanly but is never a ref', { timeout: 600_000 }, async () => {
    const voice = { clip_ref: voiceRef, words: hannah.words };
    // a cut utterance's ref is not stored, so re-entering it is the client-side sign of a guard exit
    const refused = async (r) => (await speak(endpoint(), {
      text: 'Okay.', voice, context: [{ speaker: 'being', words: 'x', ref: r.headers['x-utterance-ref'] }],
    })).status === 409;
    rec.guard = {};
    for (const { text, capS, takes } of GUARD_LINES) {
      const runs = [];
      for (let i = 0; i < takes; i++) {
        const r = await speak(endpoint(), { text, voice }); // no context: where CSM runs on longest
        expect(r.status).toBe(200);
        expect(r.bytes % 2).toBe(0);
        expect(r.audioS).toBeLessThanOrEqual(capS);
        runs.push({ audioS: +r.audioS.toFixed(2), cut: await refused(r) });
      }
      rec.guard[text.slice(0, 24)] = { capS, runs };
    }
    // the forced line is spoken past its cap by any engine: the cap exit fired for real, the body still
    // ended cleanly (speak() read it to its end), and the cut utterance was not stored
    expect(rec.guard[GUARD_LINES.at(-1).text.slice(0, 24)].runs.every((r) => r.cut)).toBe(true);
  });

  it('/warm prepares a voice (or just confirms ready)', { timeout: 180_000 }, async () => {
    expect(await postJson(endpoint(), '/warm', {})).toMatchObject({ status: 200, body: { ok: true, voice_ref: null } });
    const w = await postJson(endpoint(), '/warm', { voice: { clip_b64: james.b64, words: james.words } });
    expect(w.status).toBe(200);
    expect(w.body.voice_ref).toMatch(/^sha256:/);
    rec.warmVoiceMs = w.body.ms;
    expect((await postJson(endpoint(), '/warm', { voice: { clip_ref: `sha256:${'1'.repeat(64)}`, words: 'x' } })).status)
      .toBe(409);
  });
};

/**
 * The reaper's move: once the sidecar reports itself idle (a sidecar abandons
 * an exit within 0.5 s of real activity), POST /shutdown; resolve once the
 * port stops answering (silent: true) or 10 s pass.
 */
export const shutdownAndWait = async (endpoint) => {
  for (let i = 0; i < 50; i++) {
    const h = await fetch(`${endpoint}/health`).then((r) => r.json());
    if (h.idle_seconds >= 1) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const ack = await postJson(endpoint, '/shutdown', {});
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      return { ack, silent: true };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ack, silent: false };
};
