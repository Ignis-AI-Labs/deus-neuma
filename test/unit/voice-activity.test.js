/**
 * Pure VAD endpointing (voice-activity.js) — the state machine LIVE mode
 * trusts to know when the witness is speaking. All real: the reducer is fed
 * synthetic RMS timelines and must emit exactly the right events.
 */

import { describe, test, expect } from 'vitest';
import {
  preferredInputDevice,
  createVadState, feedVad, vadThreshold, frameRms, nextEchoFloor,
  micGateOpen, isWitnessSpeaking, VAD_DEFAULTS,
} from '../../frontend/app/RelinkShell/voice-activity.js';

// Drive a timeline: [rms, durationMs] segments at a 50ms cadence.
// A third element is the being's PLAYBACK level over that segment (0 = silent),
// so an echo timeline is written the same way a mic timeline is.
const run = (segments, opts = {}) => {
  let state = createVadState(opts);
  const events = [];
  let now = 0;
  for (const [rms, ms, playback = 0] of segments) {
    for (let t = 0; t < ms; t += 50) {
      now += 50;
      const fed = feedVad(state, rms, now, playback);
      state = fed.state;
      if (fed.event) events.push([fed.event, now]);
    }
  }
  return { state, events };
};

const QUIET = 0.003; // a still room
const VOICE = 0.12;  // someone talking

describe('speech start', () => {
  test('sustained voice → exactly one start after the confirm window', () => {
    const { events } = run([[QUIET, 500], [VOICE, 600]]);
    expect(events.map(([e]) => e)).toEqual(['start']);
    const [, at] = events[0];
    expect(at).toBeGreaterThanOrEqual(500 + VAD_DEFAULTS.confirmMs);
  });

  test('a blip shorter than the confirm window never becomes speech', () => {
    const { events, state } = run([[QUIET, 500], [VOICE, 50], [QUIET, 1000]]);
    expect(events).toEqual([]);
    expect(state.phase).toBe('idle');
  });
});

describe('speech end', () => {
  test('an utterance ends only after the hangover holds', () => {
    const { events } = run([[QUIET, 500], [VOICE, 1000], [QUIET, 1000]]);
    expect(events.map(([e]) => e)).toEqual(['start', 'end']);
    const endAt = events[1][1];
    expect(endAt).toBeGreaterThanOrEqual(1500 + VAD_DEFAULTS.hangoverMs);
  });

  test('a mid-sentence pause shorter than the hangover does not end it', () => {
    const { events } = run([
      [QUIET, 500], [VOICE, 800], [QUIET, 400], [VOICE, 800], [QUIET, 1000],
    ]);
    expect(events.map(([e]) => e)).toEqual(['start', 'end']); // one utterance, not two
  });

  test('a too-short utterance drops instead of ending', () => {
    // Past the confirm window (it IS detected) but under minUtteranceMs.
    const { events } = run([[QUIET, 500], [VOICE, 150], [QUIET, 1000]],
      { confirmMs: 100, minUtteranceMs: 400 });
    expect(events.map(([e]) => e)).toEqual(['start', 'drop']);
  });
});

describe('adaptive noise floor', () => {
  test('a noisy room raises the threshold above the noise', () => {
    const hum = 0.02; // steady fan, above the absolute minimum threshold
    let state = createVadState();
    let now = 0;
    for (let t = 0; t < 20000; t += 50) {
      now += 50;
      // Below the CURRENT end-threshold the floor learns; feed a hum that
      // stays under it as the floor converges upward.
      ({ state } = feedVad(state, Math.min(hum, vadThreshold(state) * 0.6), now));
    }
    expect(vadThreshold(state)).toBeGreaterThan(VAD_DEFAULTS.minThreshold);
  });

  test('the floor never learns while speech is happening', () => {
    const { state: quietState } = run([[QUIET, 1000]]);
    const { state: spokeState } = run([[QUIET, 1000], [VOICE, 5000]]);
    // Five seconds of voice must not have dragged the noise floor up.
    expect(spokeState.noiseFloor).toBeCloseTo(quietState.noiseFloor, 5);
  });
});

describe('frameRms', () => {
  test('digital silence (all 128) → 0', () => {
    expect(frameRms(new Uint8Array(1024).fill(128))).toBe(0);
  });

  test('a full-scale square wave → 1', () => {
    const frame = new Uint8Array(1024);
    for (let i = 0; i < frame.length; i++) frame[i] = i % 2 ? 0 : 256 - 1;
    expect(frameRms(frame)).toBeCloseTo(1, 1);
  });

  test('empty/missing frames are silent, not NaN', () => {
    expect(frameRms(new Uint8Array(0))).toBe(0);
    expect(frameRms(null)).toBe(0);
  });
});

// ECHO ON OPEN SPEAKERS (Design note, 2026-08-01: […]). The browser's
// AEC is upstream and unchanged; this is the residual suppressor after it.
describe('residual-echo suppression', () => {
  // What the room returns while the being speaks: quieter than the playback
  // itself (AEC has already worked on it) but far above a still room, and
  // easily above the plain speech threshold — which is the whole problem.
  // Coupling: what fraction of the playback the room hands back to the mic
  // once the browser's AEC has already worked on it. Well under a quarter on
  // open speakers — and still far above a still room, which is the problem.
  const PLAYBACK = 0.30;
  const ECHO = 0.05;

  test('the being speaking through open speakers never becomes an utterance', () => {
    const { events } = run([
      [QUIET, 1000],            // a still room, floor settles
      [ECHO, 3000, PLAYBACK],   // the being speaks; the room hands it back
      [QUIET, 1500],            // it stops
    ]);
    expect(events).toEqual([]); // it never mistook itself for the witness
  });

  test('without the guard that same echo WOULD have started an utterance', () => {
    // The identical mic timeline with no playback reported: proof the test
    // above is the guard working, not an echo too quiet to matter anyway.
    const { events } = run([
      [QUIET, 1000],
      [ECHO, 3000],
      [QUIET, 1500],
    ]);
    expect(events.map((e) => e[0])).toContain('start');
  });

  test('BARGE-IN SURVIVES — a witness who speaks up over the being still lands', () => {
    // The bar rises, it does not close. Real speech is louder than the room's
    // return of a speaker, and must still cut through.
    const { events } = run([
      [QUIET, 1000],
      [ECHO, 1000, PLAYBACK],          // being talking, witness silent
      [VOICE, 1000, PLAYBACK],         // witness talks OVER it
    ]);
    expect(events.map((e) => e[0])).toContain('start');
  });

  test('the bar decays after playback stops, so the next turn is heard normally', () => {
    const { state } = run([
      [QUIET, 500],
      [ECHO, 500, PLAYBACK],
      [QUIET, 1500],          // silence after the being finishes
    ]);
    expect(state.echoFloor).toBe(0);
    expect(vadThreshold(state)).toBeCloseTo(VAD_DEFAULTS.minThreshold, 6);
  });

  test('echo never teaches the noise floor — the mic is not deafened afterwards', () => {
    // If the being's own voice trained the adaptive floor, the bar would stay
    // raised long after it stopped and the witness would go unheard. The floor
    // simply does not learn during echo, so it can only be LOWER than a run of
    // pure quiet — never dragged up toward the echo.
    const withEcho = run([[QUIET, 1000], [ECHO, 4000, PLAYBACK], [QUIET, 2000]]).state;
    const withoutEcho = run([[QUIET, 1000], [QUIET, 4000], [QUIET, 2000]]).state;
    expect(withEcho.noiseFloor).toBeLessThanOrEqual(withoutEcho.noiseFloor + 1e-9);
    expect(withEcho.noiseFloor).toBeLessThan(ECHO / 4);
    // And a witness speaking after it all is heard exactly as before.
    const after = run([
      [QUIET, 1000], [ECHO, 4000, PLAYBACK], [QUIET, 2000], [VOICE, 800],
    ]).events;
    expect(after.map((e) => e[0])).toContain('start');
  });

  test('nextEchoFloor rises at once with playback and decays to exactly zero', () => {
    const cfg = VAD_DEFAULTS;
    // Rises immediately — the echo reaches the mic before any average could.
    expect(nextEchoFloor(0, 0.4, cfg)).toBeCloseTo(0.4 * cfg.echoSuppression, 6);
    // Holds at the higher of decayed-vs-played while playback continues.
    expect(nextEchoFloor(0.5, 0.1, cfg)).toBeCloseTo(0.5 * cfg.echoDecay, 6);
    // Settles to exactly 0 rather than trailing an ever-smaller number.
    let f = nextEchoFloor(0, 0.4, cfg);
    for (let i = 0; i < 200; i++) f = nextEchoFloor(f, 0, cfg);
    expect(f).toBe(0);
    // Garbage in never raises the bar.
    expect(nextEchoFloor(0, NaN, cfg)).toBe(0);
    expect(nextEchoFloor(NaN, 0, cfg)).toBe(0);
  });

  test('silence from the being changes nothing — the old behaviour, exactly', () => {
    const guarded = run([[QUIET, 1000], [VOICE, 800, 0], [QUIET, 1500]]).events;
    const plain = run([[QUIET, 1000], [VOICE, 800], [QUIET, 1500]]).events;
    expect(guarded).toEqual(plain);
  });
});

// THE PIPE, NOT JUST THE INTERRUPT (2026-08-01). Raising the VAD's bar
// suppressed the barge-in SIGNAL and nothing else: mic PCM went to whisper
// unconditionally, and whisper runs its own server-side VAD — so the being's
// voice off the speakers was transcribed anyway. A real sitting logged
// `utterances: 6` for a single reply. The bar has to close the pipe.
describe('mic gate — what actually reaches whisper', () => {
  it('is open whenever the being is silent — the ordinary lane, unchanged', () => {
    expect(micGateOpen({ playbackActive: false, witnessSpeaking: false })).toBe(true);
    expect(micGateOpen({ playbackActive: false, witnessSpeaking: true })).toBe(true);
  });

  it('CLOSES while the being sounds and the witness does not', () => {
    // This is the whole bug: these frames were reaching whisper and coming
    // back as the being's own words, turn after turn.
    expect(micGateOpen({ playbackActive: true, witnessSpeaking: false })).toBe(false);
  });

  it('reopens the instant the witness clears the bar — barge-in still reaches whisper', () => {
    expect(micGateOpen({ playbackActive: true, witnessSpeaking: true })).toBe(true);
  });

  // MEASURED, not assumed (2026-08-01): real Kokoro speech attenuated to
  // −32 dB — mic RMS 0.0016, at the noise floor — was still transcribed
  // cleanly by whisper tiny, and at −40 dB it began HALLUCINATING ([…]). There is no level quiet enough to be safe, so the gate must
  // never key on one. It keys on WHETHER the being is sounding.
  it('never reopens on a quiet passage — level is not the question', () => {
    // A being mid-sentence at a near-silent moment is still sounding.
    expect(micGateOpen({ playbackActive: true, witnessSpeaking: false })).toBe(false);
    // And the gate takes no level argument at all, by design: a caller cannot
    // accidentally reintroduce a threshold through it.
    expect(micGateOpen({ playbackActive: true, level: 0.0001 })).toBe(false);
  });

  it('fails OPEN on missing input — a silent mic is worse than a little echo', () => {
    expect(micGateOpen()).toBe(true);
    expect(micGateOpen({})).toBe(true);
  });

  it('the hangover counts as speaking, so trailing words are not clipped', () => {
    expect(isWitnessSpeaking('speaking')).toBe(true);
    expect(isWitnessSpeaking('ending')).toBe(true);   // mid-utterance dip
    expect(isWitnessSpeaking('idle')).toBe(false);
    expect(isWitnessSpeaking('arming')).toBe(false);  // not yet confirmed
  });

  it('drives from the real detector: the pipe shuts for echo, opens for a witness', () => {
    const PLAYBACK = 0.30;
    const ECHO = 0.05;
    const cfg = VAD_DEFAULTS;
    const gateAfter = (segments) => {
      let state = createVadState();
      let now = 0;
      for (const [rms, ms, playback = 0] of segments) {
        for (let t = 0; t < ms; t += 50) {
          now += 50;
          ({ state } = feedVad(state, rms, now, playback));
        }
      }
      return micGateOpen({
        playbackActive: segments[segments.length - 1][2] > 0,
        witnessSpeaking: isWitnessSpeaking(state.phase),
      });
    };
    // Being speaking, witness silent → shut.
    expect(gateAfter([[QUIET, 1000], [ECHO, 1000, PLAYBACK]])).toBe(false);
    // Witness speaking over it → open.
    expect(gateAfter([[QUIET, 1000], [ECHO, 500, PLAYBACK], [VOICE, 600, PLAYBACK]])).toBe(true);
    // Being finished, room quiet again → open.
    expect(gateAfter([[QUIET, 1000], [ECHO, 500, PLAYBACK], [QUIET, 2000]])).toBe(true);
    expect(cfg.echoSuppression).toBeGreaterThan(ECHO / PLAYBACK); // the guard has margin
  });
});

// ECHO CANCELLATION (Design note, 2026-08-01: […]). Browser AEC cannot help on a desk whose default output
// sink pitch-shifts everything 31.77 cents after the fact — the echo arriving
// at the mic no longer matches the reference AEC holds. An OS-level
// echo-cancelled source takes its reference from the real speaker feed, after
// every filter, so when the system offers one it is strictly the better ear.
describe('preferredInputDevice — take the cancelled ear when the system offers one', () => {
  it('prefers an echo-cancelled input over the plain microphone', () => {
    expect(preferredInputDevice([
      { kind: 'audioinput', deviceId: 'mic', label: 'HyperX QuadCast 2 Analog Stereo' },
      { kind: 'audioinput', deviceId: 'aec', label: 'Echo-Cancel Source' },
    ])).toBe('aec');
    // However the platform spells it.
    for (const label of ['echo cancel', 'Echo_Cancel Source', 'echo-cancellation input']) {
      expect(preferredInputDevice([{ kind: 'audioinput', deviceId: 'x', label }])).toBe('x');
    }
  });

  it('has NO opinion before a grant, when labels are withheld', () => {
    expect(preferredInputDevice([{ kind: 'audioinput', deviceId: 'a', label: '' }])).toBe(null);
  });

  it('never picks an output, a virtual default, or nonsense', () => {
    expect(preferredInputDevice([{ kind: 'audiooutput', deviceId: 'o', label: 'echo cancel sink' }])).toBe(null);
    expect(preferredInputDevice([{ kind: 'audioinput', deviceId: 'default', label: 'Echo-Cancel' }])).toBe(null);
    expect(preferredInputDevice(null)).toBe(null);
    expect(preferredInputDevice([])).toBe(null);
    expect(preferredInputDevice([null, undefined, {}])).toBe(null);
  });

  it('keeps the browser own choice when the system offers nothing', () => {
    expect(preferredInputDevice([
      { kind: 'audioinput', deviceId: 'mic', label: 'HyperX QuadCast 2' },
      { kind: 'audioinput', deviceId: 'cam', label: 'Razer Kiyo Pro' },
    ])).toBe(null);
  });
});
