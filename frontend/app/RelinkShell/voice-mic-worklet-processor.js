// voice-mic-worklet-processor.js — the AudioWorklet processor, as a REAL
// same-origin asset.
//
// WHY A FILE AND NOT A BLOB (2026-08-01): this processor used to be a template
// string handed to addModule() through URL.createObjectURL — […], which is a genuine convenience and was silently fatal.
// The desk's CSP carries `script-src 'self'` (security-headers.js), and an
// AudioWorklet module is a SCRIPT: Chromium refused every blob: module with
// `AbortError: The user aborted a request`. use-live-voice.js catches that,
// tears the mic down and reports 'error' — so the mic opened for an instant
// and closed, voice:mic_open never went out, and a voice sitting sat there
// listening to nothing. Proven against the real desk origin, 2026-08-01.
//
// Shipping it as an asset keeps `script-src 'self'` intact — widening the CSP
// to allow blob: scripts would have bought the same fix by loosening the one
// directive that matters most.
//
// The worklet stays deliberately dumb: accumulate raw captured samples at the
// context's native rate and post ~100 ms Float32 chunks to the page.
// Everything with a decision in it — downsampling, framing, s16le, base64 —
// lives page-side in voice-mic-worklet.js where the suite can prove it.
//
// NEVER zero-fill: a partial frame is HELD, not padded. Fabricated silence is
// a lie about what the mic heard.
//
// The processor name is a literal here because a worklet's global scope is not
// the page's — it cannot import the shared constant. voice-mic-worklet.test.js
// asserts this file and WORKLET_NAME still agree.

/* global sampleRate: readonly */
class NeumaPcmPump extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is the AudioContext's native rate, a worklet global.
    this._target = Math.max(128, Math.round(sampleRate * 0.1));
    this._buf = new Float32Array(this._target);
    this._fill = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;
    let offset = 0;
    while (offset < input.length) {
      const take = Math.min(this._target - this._fill, input.length - offset);
      this._buf.set(input.subarray(offset, offset + take), this._fill);
      this._fill += take;
      offset += take;
      if (this._fill >= this._target) {
        const chunk = this._buf.slice(0, this._fill);
        this.port.postMessage(chunk, [chunk.buffer]);
        this._fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('neuma-pcm-pump', NeumaPcmPump);
