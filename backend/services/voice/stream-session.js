// Voice Stream Session — the portal↔whisper-sidecar bridge for live voice
// sittings (THE SPEECH SYSTEM, Phase A / B-02).
//
// One voice session per portal connection, ever (threat-model control #1).
// The session opens a WebSocket to the whisper sidecar's /stream lane
// (lazy-launching the sidecar through engine-manager.ensureReady when down),
// forwards the operator's PCM, and maps sidecar events back to portal frames.
//
// TOKEN-EXPIRY-MID-SITTING LAW (B-03 open item, resolved here): a voice
// sitting lives and dies with its WebSocket connection. Session tokens expire
// (24h TTL) but expiry is only checked at connect time — a sitting never
// re-auths mid-stream, and when the socket dies the session dies with it
// (mic + sidecar link closed). A reconnect is a NEW authenticated connection
// that re-opens its own session. There is no session resumption across
// connections, so there is nothing to expire mid-sitting.
//
// GENERATIONS (CancelScope pattern, control #6): every forwarded output is
// stamped with the session's current generation. cancel() bumps the
// generation and sends {type:'reset'} to the sidecar; the sidecar answers
// reset_done strictly after every pre-reset output (its pump is a FIFO), so
// the bridge drops every sidecar event that arrives while a reset is
// outstanding — stale decodes can never be stamped with the new generation.
// The playback sink re-validates gen on its end (drop-on-mismatch).
//
// DEGRADATION LAW (control #7): if the sidecar wedges or dies, the session
// emits an honest voice:error with degrade:'text' and closes. There is NO
// cloud fallback anywhere in this path — voice is local or it is text.
//
// PCM is never logged and never touches disk (control #5) — logs carry byte
// counts and event kinds only.

import WebSocket from 'ws';
import { ensureReady, resolveServe } from './engine-manager.js';
import { createLogger } from '../logger.js';
import { sidecarSocketHeaders } from './sidecar-trust.js';

const log = createLogger('Voice.StreamSession');

// --- pure core -------------------------------------------------------------

/**
 * mic_open gate (fail-closed): only a conversation-purpose connection may
 * open a voice session. undefined/'work'/garbage all refuse — the purpose
 * field is written by the session-purpose lane; anything unset is 'work'.
 * @param {string|undefined} purpose
 * @returns {boolean}
 */
export const canOpenVoiceSession = (purpose) => purpose === 'conversation';

/**
 * PCM flood bound per connection (control #1). 16 kHz s16le mono is
 * 32 000 B/s of honest speech; the bound allows 2× realtime over a sliding
 * window before frames drop.
 */
export const PCM_RATE_LIMIT = Object.freeze({
  maxBytesPerWindow: 192_000,
  windowMs: 3_000,
});

/**
 * Sliding-window byte accounting. Pure — takes the window, returns the new
 * one (entries older than windowMs from `now` are dropped).
 * @param {Array<{at: number, bytes: number}>} window
 * @param {number} now
 * @param {number} bytes
 * @param {number} windowMs
 * @returns {Array<{at: number, bytes: number}>}
 */
const recordWindowBytes = (window, now, bytes, windowMs) =>
  window.filter((e) => now - e.at < windowMs).concat({ at: now, bytes });

/**
 * Total bytes inside a window. Pure.
 * @param {Array<{at: number, bytes: number}>} window
 * @returns {number}
 */
const windowByteTotal = (window) => window.reduce((sum, e) => sum + e.bytes, 0);

/**
 * Map one sidecar event to a portal frame, stamped with the generation that
 * was current when the event arrived. Pure. Unknown/internal events
 * (ready, reset_done) map to null — they are bridge-side facts, not frames.
 * @param {{type: string, text?: string, code?: string, message?: string}} event
 * @param {number} generation
 * @returns {Object|null}
 */
const mapSidecarEvent = (event, generation) => {
  switch (event.type) {
    case 'speech_started':
      return { type: 'voice:speech_started', gen: generation };
    case 'speech_stopped':
      return { type: 'voice:speech_stopped', gen: generation };
    case 'partial':
      return typeof event.text === 'string' && event.text.length > 0
        ? { type: 'voice:partial', text: event.text, gen: generation }
        : null;
    case 'utterance':
      return typeof event.text === 'string' && event.text.length > 0
        ? { type: 'voice:utterance', text: event.text, gen: generation }
        : null;
    case 'error':
      return {
        type: 'voice:error',
        code: typeof event.code === 'string' ? event.code.slice(0, 64) : 'stt_error',
        degrade: 'text',
        gen: generation,
      };
    default:
      return null;
  }
};

// --- impure bridge ---------------------------------------------------------

/**
 * One live voice sitting: portal connection ↔ sidecar /stream. All IO.
 */
export class VoiceStreamSession {
  /**
   * @param {{ send: (frame: Object) => void, onWedge?: () => void }} io
   *   send: impure — puts a frame on the owning portal socket.
   *   onWedge: impure — called once when the sidecar link dies unexpectedly
   *   (the portal clears its session reference).
   */
  constructor({ send, onWedge }) {
    this._send = send;
    this._onWedge = onWedge || (() => {});
    this.generation = 0;
    this.closed = false;
    this._ws = null;
    this._window = [];
    this._awaitingReset = false;
    // A flush that arrived mid-reset, owed to the sidecar once reset_done
    // lands. Dropping it lost the whole hold — see flush().
    this._pendingFlush = false;
    // Whether the KEY owns the endpoint (push-to-talk). Latched so a session
    // opened after the desk declared its mode still tells the sidecar.
    this._hold = false;
    this._floodNotifiedAt = 0;
    // S-20 latency anchors (timings + counts ONLY, threat control #5).
    this._speechStoppedAt = 0;
    this._utteranceCount = 0;
  }

  /** impure — launch the sidecar if needed and open the /stream link. */
  async open() {
    const serve = resolveServe('whisper');
    if (!serve) throw new Error('whisper engine missing from registry');
    await ensureReady('whisper');
    const { host, port } = serve;
    // the transcription audio goes only to a sidecar that proves the install key (sidecar-trust.js)
    const ws = new WebSocket(`ws://${host}:${port}/stream`, { headers: await sidecarSocketHeaders(`http://${host}:${port}`) });
    this._ws = ws;
    // Open is not admitted: the lane answers `ready`, or refuses (one /stream
    // client at a time — close 1013 while another holds it). Wait for which,
    // so a refused session fails here (err.code 1013) instead of after the ack.
    // Listening from the start: `ready` can ride the same packet as the handshake.
    await new Promise((resolve, reject) => {
      const done = (fn, arg) => {
        ws.off('message', onMessage); ws.off('close', onClose); ws.off('error', onError);
        if (fn === reject) ws.on('error', () => {}); // a refused link may still report; never unhandled
        fn(arg);
      };
      const onMessage = (data) => {
        let event;
        try { event = JSON.parse(data.toString()); } catch { return; }
        if (event.type === 'ready') done(resolve);
        else if (event.type === 'error') done(reject, new Error(`stream lane refused: ${event.code}`));
      };
      const onClose = (code) => done(reject, Object.assign(new Error(`stream lane closed (${code})`), { code }));
      const onError = (err) => done(reject, err);
      ws.on('message', onMessage);
      ws.on('close', onClose);
      ws.on('error', onError);
    });
    ws.on('message', (data) => this._onSidecarMessage(data));
    ws.on('close', () => this._onSidecarGone('closed'));
    ws.on('error', () => this._onSidecarGone('error'));
    // A mode declared before the link existed still has to reach the sidecar.
    if (this._hold) ws.send(JSON.stringify({ type: 'hold_on' }));
  }

  /**
   * impure — forward one PCM chunk to the sidecar under the flood bound.
   * Over-bound bytes are dropped; the operator is told once per window.
   * @param {Buffer} pcm
   */
  sendPcm(pcm) {
    if (this.closed || !this._ws) return;
    const now = Date.now();
    const candidate = recordWindowBytes(this._window, now, pcm.length, PCM_RATE_LIMIT.windowMs);
    if (windowByteTotal(candidate) > PCM_RATE_LIMIT.maxBytesPerWindow) {
      this._window = recordWindowBytes(this._window, now, 0, PCM_RATE_LIMIT.windowMs);
      if (now - this._floodNotifiedAt > PCM_RATE_LIMIT.windowMs) {
        this._floodNotifiedAt = now;
        log.warn('PCM flood bound hit — dropping audio', { gen: this.generation });
        this._send({
          type: 'voice:error', code: 'pcm_flood', degrade: 'text', gen: this.generation,
        });
      }
      return;
    }
    this._window = candidate;
    this._ws.send(pcm);
  }

  /**
   * Force the sidecar to finalize what it is holding, now.
   *
   * PUSH-TO-TALK needs this. With an open mic the server VAD decides an
   * utterance has ended by HEARING silence — but a witness who releases the
   * key stops sending audio altogether, so no silence ever arrives and the
   * last words would sit in the decoder unspoken. Release says […] more precisely than any silence could.
   *
   * Not generation-tagged, unlike cancel(): a flush KEEPS what was said and
   * asks for it, where a cancel throws it away. Same generation in, same
   * generation out.
   */
  flush() {
    if (this.closed || !this._ws) return;
    // Mid-reset the decoder is being emptied on purpose; asking it to finalize
    // would race the reset and could surface pre-cancel words as if they were
    // new. So it WAITS — it must never be dropped.
    //
    // Dropping it is what made short holds vanish (Design note, 2026-08-01: […]). Every push-to-talk keydown sends a cancel, and
    // reset_done travels the sidecar's FIFO behind the queued PCM and a
    // decode; any hold shorter than that round trip released into a still-open
    // reset window, and the words sat in the decoder forever with the desk
    // showing a calm LISTENING. Owed now, and paid when reset_done lands — by
    // which time the hold's own audio is already queued ahead of it.
    if (this._awaitingReset) {
      this._pendingFlush = true;
      return;
    }
    this._ws.send(JSON.stringify({ type: 'flush' }));
  }

  /**
   * Declare who owns the end of an utterance.
   *
   * Push-to-talk means the KEY does, and the sidecar has to be told: left to
   * itself its VAD ends the line after 400 ms of quiet, so one held sentence
   * with a thinking pause in it became two turns — and a release landing after
   * that finalize re-emitted the same words, so the being answered one
   * sentence twice (both measured, 2026-08-01). In hold mode the sidecar
   * bypasses its VAD entirely and only flush() ends a line.
   *
   * Latched: a mode declared before the link is up is sent on open.
   * @param {boolean} on
   */
  setHold(on) {
    const next = on === true;
    if (this._hold === next) return;
    this._hold = next;
    if (this.closed || !this._ws) return;
    this._ws.send(JSON.stringify({ type: next ? 'hold_on' : 'hold_off' }));
  }

  /**
   * Generation-tagged cancel (CancelScope): bump the generation, reset the
   * sidecar, and drop every sidecar event until reset_done proves the stale
   * decodes are behind us. Monotonic — a cancel never moves the generation
   * backwards.
   * @param {number} [gen] - client-suggested generation (adopted if higher)
   */
  cancel(gen) {
    if (this.closed) return;
    const suggested = Number.isInteger(gen) ? gen : 0;
    this.generation = Math.max(this.generation + 1, suggested);
    if (this._ws && !this._awaitingReset) {
      this._awaitingReset = true;
      this._ws.send(JSON.stringify({ type: 'reset' }));
    }
  }

  /** impure — tear down the sidecar link. Idempotent. */
  close() {
    if (this.closed) return;
    this.closed = true;
    const ws = this._ws;
    this._ws = null;
    if (ws) {
      ws.removeAllListeners();
      try { ws.close(); } catch { /* already gone */ }
    }
  }

  // impure — sidecar event → portal frame. While a reset is outstanding the
  // event is stale by construction (the sidecar emits reset_done strictly
  // after all pre-reset output) and is dropped bridge-side.
  _onSidecarMessage(data) {
    if (this.closed) return;
    let event;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return; // non-JSON from the sidecar is not part of the contract — drop
    }
    if (event.type === 'reset_done') {
      this._awaitingReset = false;
      // Pay the flush that was owed. The hold's PCM went through the same FIFO
      // ahead of this, so finalizing now finalizes exactly that hold.
      if (this._pendingFlush) {
        this._pendingFlush = false;
        if (this._ws) this._ws.send(JSON.stringify({ type: 'flush' }));
      }
      return;
    }
    if (this._awaitingReset) return;
    // S-20 latency instrumentation (timings + counts ONLY — never PCM, never
    // transcript text; threat control #5): anchor the turn at server-VAD
    // speech_stopped, measure to the VAD-finalized utterance. The
    // utterance→turn leg crosses the client (the desk submits the finalized
    // text as the next turn), so the backend-side chain closes here; the TTS
    // first-chunk leg is stamped in portal-stream.js _synthesizeAndEmit.
    if (event.type === 'speech_stopped') {
      this._speechStoppedAt = Date.now();
    } else if (event.type === 'utterance' && this._speechStoppedAt) {
      log.info('voice turn STT finalize', {
        gen: this.generation,
        sttFinalizeMs: Date.now() - this._speechStoppedAt,
        utterances: (this._utteranceCount += 1),
      });
      this._speechStoppedAt = 0;
    }
    const frame = mapSidecarEvent(event, this.generation);
    if (frame) this._send(frame);
  }

  // impure — the sidecar link died mid-sitting: degrade to text, honestly.
  // NEVER a cloud fallback (control #7 — sovereignty).
  _onSidecarGone(reason) {
    if (this.closed) return;
    log.warn('sidecar link lost mid-sitting — degrading to text', {
      reason, gen: this.generation,
    });
    this._send({
      type: 'voice:error', code: 'stt_unavailable', degrade: 'text', gen: this.generation,
    });
    this.close();
    this._onWedge();
  }
}
