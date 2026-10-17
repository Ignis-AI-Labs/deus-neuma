/**
 * Dictate routes — hold-to-talk dictation over the live speech lane (/dictate-ws).
 *
 * The composer's dictation used to post the whole hold to /transcribe on
 * release (and re-post it every few hundred ms for the preview), so the final
 * waited on a re-read of everything said. The live lane (the whisper sidecar's
 * /stream, Nemotron inside since 2026-10-07) reads each piece of audio once as
 * it arrives: words land while the key is down and the final follows the
 * release by ~0.2 s, however long the hold (docs/work/dictation-flow.md).
 *
 * One socket = one hold. Auth-on-connect like the terminal (`?token=`); the
 * key owns the endpoint (hold mode — the sidecar's VAD is bypassed). The
 * bridge is the portal's own VoiceStreamSession, so the flood bound, the
 * owed-flush and the honest degrade are the sitting's, not a copy.
 *
 * Client → here: binary 16 kHz s16le mono PCM frames; {"type":"flush"} on release.
 * Here → client: ready, partial {text}, final {text}, error {code}. A refused
 * lane (the sidecar serves one /stream client — a voice sitting holds it) is
 * an error; the desk falls back to /transcribe for that hold.
 */

import { verifySessionToken } from '../services/auth.js';
import { VoiceStreamSession } from '../services/voice/stream-session.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('DictateRoutes');

// PCM the desk sends while the lane is still opening (a cold sidecar) is held,
// not dropped — bounded at 30 s of speech; past it the hold degrades to /transcribe.
const MAX_EARLY_BYTES = 32_000 * 30;
// After the lane says the speech stopped, the words follow at once; if they
// never do (a hold with nothing said), the desk is told so instead of waiting.
const FINAL_GRACE_MS = 1500;
// Holds come back to back ([…]): the lane frees its one
// slot a moment after the last hold closes, so a busy answer is retried this long.
const BUSY_RETRY_MS = 2000;
const BUSY_STEP_MS = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const send = (ws, frame) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
};

/** Bind the dictation socket. impure. */
export const setupDictateRoutes = (wss) => {
  wss.on('connection', async (ws, req) => {
    const token = new URL(req.url, 'http://localhost').searchParams.get('token');
    if (!token || !verifySessionToken(token)) { ws.close(4001, 'Unauthorized'); return; }

    let open = false;
    let heard = false;      // any PCM reached the lane
    let finished = false;
    let early = [];
    let earlyBytes = 0;
    let graceTimer = null;
    const finish = (text) => {
      if (finished) return;
      finished = true;
      clearTimeout(graceTimer);
      send(ws, { type: 'final', text });
    };
    const onFrame = (frame) => {
      if (frame.type === 'voice:partial') send(ws, { type: 'partial', text: frame.text });
      else if (frame.type === 'voice:utterance') finish(frame.text);
      else if (frame.type === 'voice:speech_stopped') {
        graceTimer = setTimeout(() => finish(''), FINAL_GRACE_MS);
      } else if (frame.type === 'voice:error' && frame.code !== 'pcm_flood') {
        send(ws, { type: 'error', code: frame.code });
        ws.close(1011, frame.code);
      }
    };
    let session = null;

    const forward = (pcm) => { heard = true; session?.sendPcm(pcm); };
    const flush = () => {
      if (!heard) { finish(''); return; }
      session.flush();
    };
    let flushOwed = false;

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const pcm = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (open) { forward(pcm); return; }
        earlyBytes += pcm.length;
        if (earlyBytes > MAX_EARLY_BYTES) { send(ws, { type: 'error', code: 'lane_slow' }); ws.close(1011); return; }
        early.push(pcm);
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg?.type !== 'flush') return;
      if (open) flush(); else flushOwed = true;
    });
    ws.on('close', () => { clearTimeout(graceTimer); session?.close(); });

    // The portal's own bridge, in hold mode: the key ends the line, not the VAD.
    const deadline = Date.now() + BUSY_RETRY_MS;
    for (;;) {
      const attempt = new VoiceStreamSession({ send: onFrame, onWedge: () => ws.close(1011, 'stt_unavailable') });
      attempt.setHold(true);
      try {
        await attempt.open();
        session = attempt;
        break;
      } catch (err) {
        attempt.close();
        if (ws.readyState !== ws.OPEN) return;
        if (err?.code === 1013 && Date.now() < deadline) { await sleep(BUSY_STEP_MS); continue; }
        log.warn('dictation lane unavailable', { reason: String(err?.message || err).slice(0, 200) });
        send(ws, { type: 'error', code: 'stt_unavailable' });
        ws.close(1011, 'stt_unavailable');
        return;
      }
    }
    if (ws.readyState !== ws.OPEN) { session.close(); return; }
    open = true;
    for (const pcm of early) forward(pcm);
    early = [];
    send(ws, { type: 'ready' });
    if (flushOwed) flush();
  });
};
