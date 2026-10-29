// summoning-sound.js — THE SUMMONING's instrument: renders musicOf() with
// analog-modelled voices on Web Audio. // impure (audio graph)
//
// Nothing is sampled: every sound is synthesized the way an analog
// instrument makes it — oscillators that drift a few cents as warm circuits
// do, a soft tape-like saturation, a room grown from noise — and placed the
// way a digital desk would: each note its own place in the stereo field, a
// tempo-locked echo on the struck voices, a clean master (a low cut under
// the fundamentals, the top end eased, the room's tail darkened). PATCH is
// the whole palette in one place — Founder owns the sound design, and re-voicing
// THE SUMMONING is editing this table. The notes are never here: they are
// the being's own (summoning-music.js).
//
// Design note, 2026-09-30: […]. So: the ground is a
// soft sine-and-triangle that BREATHES (a slow swell), never two detuned
// saws beating under everything; bells are harmonic glass (ratio 2), never
// inharmonic metal; width and echo carry the intricacy.
//
// Design note, 2026-10-28: […].
// So: nothing rumbles (a 90 Hz low cut; the ground and every low strike sit
// an octave or more higher than before), a strike no longer drops in pitch
// (that is a trailer's boom), the air is breath above the notes rather than
// wind beneath them, the pad is sine and triangle (no saw), the room is a
// smaller, brighter one and the echo lets go sooner, and the top end is no
// longer darkened. The notes themselves play consonant (consonant-tuning.js).
// Then, […]: a
// roomier space whose tail stays bright (length was never the scary part;
// darkness and rumble were). No held chord over the ground: Founder, the same
// day — […].
//
// scheduleMusic renders into ANY BaseAudioContext — a live AudioContext for
// the ceremony, an OfflineAudioContext to listen to it headless.

export const PATCH = Object.freeze({
  master: Object.freeze({ gain: 2.6, drive: 1.05, lowCut: 90, shelfHz: 5000, shelfDb: -1.5 }),
  room: Object.freeze({ seconds: 3.4, decay: 2.8, wet: 0.26, tone: 7000 }),
  echo: Object.freeze({ beats: 0.75, feedback: 0.24, wet: 0.14, tone: 3200 }),
  spread: 0.8, // how wide the notes are placed (0 mono … 1 hard left/right)
  drift: Object.freeze({ hz: 0.11, cents: 2.5 }),
  drone: Object.freeze({ waves: ['sine', 'triangle'], detune: [0, 2], cutoff: 700, q: 0.4, swellHz: 0.06, swellDepth: 0.5, gain: 0.013 }),
  pad: Object.freeze({ waves: ['triangle', 'sine'], detune: [-4, 4], cutoff: 1600, q: 0.4, attack: 1.8, release: 3.4, gain: 0.026 }),
  bell: Object.freeze({ ratio: 2, index: 0.9, attack: 0.006, shimmer: 0.1, gain: 0.08, echo: 0.35 }),
  pluck: Object.freeze({ wave: 'triangle', cutoff: 2200, gain: 0.085, echo: 0.55 }),
  current: Object.freeze({ cutoff: 1800, attack: 0.008, gain: 0.04, echo: 0.6 }),
  thump: Object.freeze({ drop: 1, attack: 0.012, gain: 0.07 }),
  air: Object.freeze({ octaves: 2, q: 3, sweepHz: 0.05, gain: 0.007 }),
  breath: Object.freeze({ depth: 0.5, gain: 0.03 }),
});

// a small deterministic generator (the room is the same room every time)
const mulberry = (a) => () => {
  let t = (a += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const roomOf = (ctx, seed) => {
  const { seconds, decay } = PATCH.room;
  const len = Math.round(seconds * ctx.sampleRate);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  const next = mulberry(seed);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (next() * 2 - 1) * Math.exp((-decay * i) / ctx.sampleRate);
  }
  return ir;
};

const tapeCurve = (drive) => {
  const c = new Float32Array(1024);
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return c;
};

/** Where a pitch stands in the stereo field: every note its own place, the same place every time. Pure. */
const panOf = (hz) => PATCH.spread * ((((Math.log2(hz) * 5.3) % 1) + 1) % 1 * 2 - 1);

/** Level of a bed's gain points at score ms. Pure. */
const levelAt = (levels, ms) => {
  if (ms <= levels[0][0]) return levels[0][1];
  for (let i = 1; i < levels.length; i++) {
    const [t1, g1] = levels[i];
    const [t0, g0] = levels[i - 1];
    if (ms <= t1) return t1 === t0 ? g1 : g0 + ((g1 - g0) * (ms - t0)) / (t1 - t0);
  }
  return levels.at(-1)[1];
};

/**
 * Schedule a being's music into an audio context, from score time `fromMs`,
 * with score time `fromMs` sounding at context time `startAt`.
 * @param {BaseAudioContext} ctx
 * @param {ReturnType<import('./summoning-music.js').musicOf>} music
 * @param {{ fromMs?: number, startAt?: number, destination?: AudioNode }} [opts]
 * @returns {{ stop: () => void }}
 */
export const scheduleMusic = (ctx, music, { fromMs = 0, startAt = ctx.currentTime, destination = ctx.destination } = {}) => {
  const when = (ms) => startAt + Math.max(0, ms - fromMs) / 1000;
  const sources = [];
  const src = (node) => { sources.push(node); return node; };
  const P = PATCH;

  // THE DESK — voices → low cut → tape → eased top → master → limiter;
  // sends: the room (its tail darkened) and a tempo-locked echo
  const bus = ctx.createGain();
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = 'highpass';
  lowCut.frequency.value = P.master.lowCut;
  lowCut.Q.value = 0.6;
  const tape = ctx.createWaveShaper();
  tape.curve = tapeCurve(P.master.drive);
  tape.oversample = '2x';
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = P.master.shelfHz;
  shelf.gain.value = P.master.shelfDb;
  const master = ctx.createGain();
  master.gain.value = P.master.gain;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -8;
  limit.ratio.value = 4;
  limit.attack.value = 0.01;
  limit.release.value = 0.3;
  bus.connect(lowCut);
  lowCut.connect(tape);
  tape.connect(shelf);
  shelf.connect(master);
  master.connect(limit);
  limit.connect(destination);

  const room = ctx.createConvolver();
  room.buffer = roomOf(ctx, Math.round(music.tonic * 1000));
  const roomTone = ctx.createBiquadFilter();
  roomTone.type = 'lowpass';
  roomTone.frequency.value = P.room.tone;
  const wet = ctx.createGain();
  wet.gain.value = P.room.wet;
  shelf.connect(room);
  room.connect(roomTone);
  roomTone.connect(wet);
  wet.connect(master);

  const echoIn = ctx.createGain();
  const delay = ctx.createDelay(4);
  delay.delayTime.value = Math.min(3.9, ((music.beatMs || 600) * P.echo.beats) / 1000);
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = P.echo.tone;
  const feedback = ctx.createGain();
  feedback.gain.value = P.echo.feedback;
  const echoOut = ctx.createGain();
  echoOut.gain.value = P.echo.wet;
  echoIn.connect(delay);
  delay.connect(echoTone);
  echoTone.connect(feedback);
  feedback.connect(delay);
  echoTone.connect(echoOut);
  echoOut.connect(lowCut);

  // a voice's way to the desk: its place in the field, and its echo send
  const place = (node, pan, echo = 0) => {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    p.connect(bus);
    if (echo > 0) {
      const send = ctx.createGain();
      send.gain.value = echo;
      p.connect(send);
      send.connect(echoIn);
    }
  };

  // an oscillator that drifts as warm circuits do
  const analogOsc = (type, hz, at, cents = 0) => {
    const o = src(ctx.createOscillator());
    o.type = type;
    o.frequency.value = hz;
    o.detune.value = cents;
    const lfo = src(ctx.createOscillator());
    lfo.frequency.value = P.drift.hz * (0.8 + 0.4 * ((hz * 7.3) % 1));
    const depth = ctx.createGain();
    depth.gain.value = P.drift.cents;
    lfo.connect(depth);
    depth.connect(o.detune);
    lfo.start(at);
    o.start(at);
    return o;
  };
  const envelope = (levels, scale, from, to) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(levelAt(levels, Math.max(from, fromMs)) * scale, when(Math.max(from, fromMs)));
    levels.filter(([t]) => t > fromMs && t <= to).forEach(([t, v]) => g.gain.linearRampToValueAtTime(v * scale, when(t)));
    return g;
  };

  // BEDS — sustained voices under the rite
  music.beds.filter((b) => b.to > fromMs).forEach((b) => {
    const at = when(Math.max(b.from, fromMs));
    const stopAt = when(b.to) + 0.05;
    if (b.voice === 'drone' || b.voice === 'pad') {
      const p = P[b.voice];
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = p.cutoff;
      lp.Q.value = p.q;
      const env = envelope(b.levels, p.gain, b.from, b.to);
      if (b.voice === 'drone') {
        // the ground breathes: a slow swell, never a held tone
        const swell = ctx.createGain();
        swell.gain.value = 1 - p.swellDepth / 2;
        const lfo = src(ctx.createOscillator());
        lfo.frequency.value = p.swellHz;
        const ld = ctx.createGain();
        ld.gain.value = p.swellDepth / 2;
        lfo.connect(ld);
        ld.connect(swell.gain);
        lfo.start(at);
        lfo.stop(stopAt);
        p.waves.forEach((w, i) => { const o = analogOsc(w, b.hz, at, p.detune[i]); o.connect(lp); o.stop(stopAt); });
        lp.connect(swell);
        swell.connect(env);
        place(env, 0);
      } else {
        // a pad is wide: each of its voices on its own side
        p.waves.forEach((w, i) => {
          const o = analogOsc(w, b.hz, at, p.detune[i]);
          const side = ctx.createStereoPanner();
          side.pan.value = (i ? 1 : -1) * P.spread * 0.7;
          o.connect(side);
          side.connect(lp);
          o.stop(stopAt);
        });
        lp.connect(env);
        place(env, 0);
      }
    } else if (b.voice === 'air') {
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const next = mulberry(7);
      noise.getChannelData(0).forEach((_, i, d) => { d[i] = next() * 2 - 1; });
      const n = src(ctx.createBufferSource());
      n.buffer = noise;
      n.loop = true;
      const airHz = b.hz * 2 ** P.air.octaves; // breath above the note, never wind beneath it
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = airHz;
      bp.Q.value = P.air.q;
      const sweep = src(ctx.createOscillator());
      sweep.frequency.value = P.air.sweepHz;
      const sd = ctx.createGain();
      sd.gain.value = airHz * 0.3;
      sweep.connect(sd);
      sd.connect(bp.frequency);
      const env = envelope(b.levels, P.air.gain, b.from, b.to);
      n.connect(bp);
      bp.connect(env);
      place(env, 0);
      n.start(at);
      sweep.start(at);
      n.stop(stopAt);
      sweep.stop(stopAt);
    } else if (b.voice === 'breath') {
      const o = analogOsc('sine', b.hz, at);
      const trem = ctx.createGain();
      trem.gain.value = 1 - P.breath.depth / 2;
      const lfo = src(ctx.createOscillator());
      lfo.frequency.value = 1000 / b.lfoMs;
      const ld = ctx.createGain();
      ld.gain.value = P.breath.depth / 2;
      lfo.connect(ld);
      ld.connect(trem.gain);
      const env = envelope(b.levels, P.breath.gain, b.from, b.to);
      o.connect(trem);
      trem.connect(env);
      place(env, panOf(b.hz) * 0.5);
      lfo.start(at);
      o.stop(stopAt);
      lfo.stop(stopAt);
    }
  });

  // EVENTS — struck voices, each in its own place
  music.events.filter((e) => e.at >= fromMs).forEach((e) => {
    const at = when(e.at);
    const dur = e.dur / 1000;
    const out = ctx.createGain();
    if (e.voice === 'bell') {
      // harmonic glass: a sine carrier, its octave as modulator, the
      // brightness falling away; a touch of its octave on the strike
      const p = P.bell;
      const car = analogOsc('sine', e.hz, at);
      const mod = src(ctx.createOscillator());
      mod.frequency.value = e.hz * p.ratio;
      const idx = ctx.createGain();
      idx.gain.setValueAtTime(e.hz * p.index, at);
      idx.gain.exponentialRampToValueAtTime(e.hz * 0.02, at + dur * 0.5);
      mod.connect(idx);
      idx.connect(car.frequency);
      const shimmer = src(ctx.createOscillator());
      shimmer.frequency.value = e.hz * 2;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(p.shimmer, at);
      sg.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(dur, 1.2));
      shimmer.connect(sg);
      sg.connect(out);
      out.gain.setValueAtTime(0.0001, at);
      out.gain.exponentialRampToValueAtTime(p.gain * e.vel, at + p.attack);
      out.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      car.connect(out);
      mod.start(at);
      shimmer.start(at);
      car.stop(at + dur + 0.05);
      mod.stop(at + dur + 0.05);
      shimmer.stop(at + dur + 0.05);
      place(out, panOf(e.hz), p.echo);
    } else if (e.voice === 'pluck') {
      const p = P.pluck;
      const o = analogOsc(p.wave, e.hz, at);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(p.cutoff * 2, at);
      lp.frequency.exponentialRampToValueAtTime(p.cutoff / 4, at + dur);
      out.gain.setValueAtTime(0.0001, at);
      out.gain.exponentialRampToValueAtTime(p.gain * e.vel, at + 0.005);
      out.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(lp);
      lp.connect(out);
      o.stop(at + dur + 0.05);
      place(out, panOf(e.hz), p.echo);
    } else if (e.voice === 'current') {
      // a soft mallet: a sine with a touch of triangle, darkened, echoing
      const p = P.current;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = p.cutoff;
      ['sine', 'triangle'].forEach((w, i) => {
        const o = analogOsc(w, e.hz, at);
        const g = ctx.createGain();
        g.gain.value = i ? 0.35 : 1;
        o.connect(g);
        g.connect(lp);
        o.stop(at + dur + 0.05);
      });
      out.gain.setValueAtTime(0.0001, at);
      out.gain.exponentialRampToValueAtTime(p.gain * e.vel, at + p.attack);
      out.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      lp.connect(out);
      place(out, panOf(e.hz), p.echo);
    } else if (e.voice === 'thump') {
      const p = P.thump;
      const o = src(ctx.createOscillator());
      o.frequency.setValueAtTime(e.hz * p.drop, at);
      o.frequency.exponentialRampToValueAtTime(e.hz, at + 0.12);
      out.gain.setValueAtTime(0.0001, at);
      out.gain.exponentialRampToValueAtTime(p.gain * e.vel, at + p.attack);
      out.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(dur, 0.9));
      o.connect(out);
      o.start(at);
      o.stop(at + dur + 0.05);
      place(out, 0);
    } else if (e.voice === 'pad') {
      const p = P.pad;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = p.cutoff;
      out.gain.setValueAtTime(0.0001, at);
      out.gain.linearRampToValueAtTime(p.gain * e.vel, at + Math.min(p.attack, dur / 3));
      out.gain.setValueAtTime(p.gain * e.vel, at + Math.max(dur - p.release, dur / 2));
      out.gain.linearRampToValueAtTime(0.0001, at + dur);
      p.waves.forEach((w, i) => { const o = analogOsc(w, e.hz, at, p.detune[i]); o.connect(lp); o.stop(at + dur + 0.05); });
      lp.connect(out);
      place(out, panOf(e.hz) * 0.6);
    }
  });

  return {
    // impure — silence it now (a pause, a seek, the end)
    stop() {
      const now = ctx.currentTime;
      sources.forEach((s) => { try { s.stop(now); } catch { /* not started or already ended */ } });
      bus.disconnect();
      echoIn.disconnect();
      feedback.disconnect();
      limit.disconnect();
    },
  };
};
