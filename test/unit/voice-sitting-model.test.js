// VoiceSitting pure view-model — the mount decision, turn-state derivation,
// level mapping, the mic readout, and the one TALK toggle. Pure functions
// called with real inputs, checked against real outputs (no mocks — Rule 0).

import { describe, it, expect } from 'vitest';
import {
  shouldMountVoiceSitting,
  deriveTurnState,
  normalizeLevel,
  levelToBars,
  micReadout,
  talkToggleModel,
  speakPrompt,
  TURN_STATES,
} from '../../frontend/app/RelinkShell/VoiceSitting/voice-sitting-model.js';
import deskEn from '../../frontend/i18n/locales/en/desk.js';

describe('voice-sitting-model — the mount decision (F-03)', () => {
  it('stands ONLY for a declared conversation with LIVE armed', () => {
    expect(shouldMountVoiceSitting({ purpose: 'conversation', liveArmed: true })).toBe(true);
    expect(shouldMountVoiceSitting({ purpose: 'conversation', liveArmed: false })).toBe(false);
    expect(shouldMountVoiceSitting({ purpose: 'work', liveArmed: true })).toBe(false);
    expect(shouldMountVoiceSitting({ purpose: 'work', liveArmed: false })).toBe(false);
  });

  it('fails closed on missing/garbage input — the ordinary desk is the default', () => {
    expect(shouldMountVoiceSitting()).toBe(false);
    expect(shouldMountVoiceSitting({})).toBe(false);
    expect(shouldMountVoiceSitting({ purpose: 'chat', liveArmed: true })).toBe(false);
    expect(shouldMountVoiceSitting({ purpose: 'conversation', liveArmed: 1 })).toBe(false);
  });
});

describe('voice-sitting-model — turn state (F-04)', () => {
  it('playback activity outranks thinking; thinking outranks listening', () => {
    expect(deriveTurnState({ playbackActive: true, thinking: true })).toBe('speaking');
    expect(deriveTurnState({ playbackActive: true, thinking: false })).toBe('speaking');
    expect(deriveTurnState({ playbackActive: false, thinking: true })).toBe('thinking');
    expect(deriveTurnState({ playbackActive: false, thinking: false })).toBe('listening');
  });

  it('defaults to listening — a live voice sitting at rest is listening', () => {
    expect(deriveTurnState()).toBe('listening');
    expect(TURN_STATES).toContain(deriveTurnState());
  });
});

describe('voice-sitting-model — levels to bars', () => {
  it('normalizeLevel gains speech RMS into [0,1] and clamps', () => {
    expect(normalizeLevel(0)).toBe(0);
    expect(normalizeLevel(-1)).toBe(0);
    expect(normalizeLevel(NaN)).toBe(0);
    expect(normalizeLevel(Infinity)).toBe(0);
    expect(normalizeLevel(0.1)).toBeCloseTo(0.3, 6);
    expect(normalizeLevel(0.5)).toBe(1); // clamped, never over-range
  });

  it('levelToBars returns a frozen, center-weighted row derived from the one level', () => {
    const bars = levelToBars(0.5, 8);
    expect(bars).toHaveLength(8);
    expect(Object.isFrozen(bars)).toBe(true);
    // Every bar is bounded by the level; the center carries the most.
    for (const b of bars) {
      expect(b).toBeGreaterThan(0);
      expect(b).toBeLessThanOrEqual(0.5);
    }
    expect(bars[3]).toBeGreaterThan(bars[0]);
    // Silence draws silence — nothing is invented.
    expect(levelToBars(0, 8).every((b) => b === 0)).toBe(true);
    // Garbage input draws silence, and the count is always honored.
    expect(levelToBars(NaN, 4).every((b) => b === 0)).toBe(true);
    expect(levelToBars(1, 0)).toHaveLength(1);
  });
});

describe('voice-sitting-model — the one TALK toggle', () => {
  it('is one button, lit only while the sitting actually stands', () => {
    expect(talkToggleModel(true).live).toBe(true);
    expect(talkToggleModel(false).live).toBe(false);
    expect(talkToggleModel(true).labelKey).toBe('talk');
    expect(talkToggleModel(false).labelKey).toBe('talk');
  });

  it('names what pressing it does, not the state it is in', () => {
    expect(talkToggleModel(true).titleKey).toBe('talkTitleLeave');
    expect(talkToggleModel(false).titleKey).toBe('talkTitleEnter');
  });

  it('fails closed on anything that is not a true sitting, and freezes', () => {
    // Only an explicit true is a live sitting — undefined/null/'yes' are not.
    for (const bad of [undefined, null, 'conversation', 1, {}]) {
      expect(talkToggleModel(bad).live).toBe(false);
    }
    expect(Object.isFrozen(talkToggleModel(true))).toBe(true);
  });
});

describe('voice-sitting-model — the mic readout', () => {
  const open = { micState: 'listening', liveArmed: true };

  it('names the device actually capturing', () => {
    const r = micReadout({ ...open, device: 'Blue Yeti Analog Stereo' });
    expect(r.live).toBe(true);
    expect(r.device).toBe('Blue Yeti Analog Stereo');
    expect(r).toMatchObject({ key: 'micNamed', args: { device: 'BLUE YETI ANALOG STEREO' } });
  });

  it('says ON but unnamed when the browser withholds the label of an OPEN mic', () => {
    // A granted track with an empty label is a live mic whose name we were not
    // given — it must never read as silence, and never be given a made-up name.
    const r = micReadout({ ...open, device: '' });
    expect(r.live).toBe(true);
    expect(r.key).toBe('micOnUnnamed');
  });

  // THE REGRESSION THIS EXISTS FOR (2026-08-01): the readout keyed on
  // `liveArmed`, which only means the desk ASKED for a mic. A sitting whose
  // grant never landed printed […] over hardware that
  // was never touched, and sent Founder hunting for a mic that was never open.
  it('never claims a mic is ON just because the desk asked for one', () => {
    const asked = micReadout({ device: '', liveArmed: true, micState: 'off' });
    expect(asked.live).toBe(false);
    expect(asked.key).toBe('micRequested');
  });

  it('names a refused grant as blocked, not as silence or as ON', () => {
    const blocked = micReadout({ device: '', liveArmed: true, micState: 'error' });
    expect(blocked.live).toBe(false);
    expect(blocked.key).toBe('micBlocked');
    // Even a lingering label from a previous grant must not read as live.
    expect(micReadout({ device: 'Blue Yeti', liveArmed: true, micState: 'error' }).live).toBe(false);
  });

  it('shows the opening moment as opening, not as open', () => {
    const r = micReadout({ device: '', liveArmed: true, micState: 'opening' });
    expect(r.live).toBe(false);
    expect(r.key).toBe('micOpening');
  });

  it('reads OFF whenever LIVE is not armed, whatever label lingers', () => {
    expect(micReadout({ device: 'Blue Yeti', liveArmed: false, micState: 'listening' }).key).toBe('micOff');
    expect(micReadout({ device: '', liveArmed: false }).live).toBe(false);
    expect(micReadout().key).toBe('micOff');
  });

  it('freezes the readout and tolerates non-string labels', () => {
    expect(Object.isFrozen(micReadout({ ...open, device: 'x' }))).toBe(true);
    expect(micReadout({ ...open, device: null }).device).toBe('');
    expect(micReadout({ ...open, device: '   ' }).device).toBe('');
  });
});

// PUSH TO TALK (Design note, 2026-08-01: […]). Measured reason: whisper
// transcribes the being off open speakers down to −32 dB and hallucinates
// below that, so an open mic in a room with speakers is a losing position.
describe('voice-sitting-model — hold to talk says what it is', () => {
  it('tells the witness to hold, and says so only while they are not', () => {
    expect(speakPrompt({ pushToTalk: true, holding: false }).key).toBe('speakHold');
    expect(speakPrompt({ pushToTalk: true, holding: false }).live).toBe(false);
  });

  it('says it is HEARING them only while the key is actually down', () => {
    const held = speakPrompt({ pushToTalk: true, holding: true });
    expect(held.live).toBe(true);
    expect(held.key).toBe('speakHearing');
  });

  it('the open-mic lane still simply says the mic is open', () => {
    expect(speakPrompt({ pushToTalk: false }).key).toBe('speakOpen');
    expect(speakPrompt().key).toBe('speakOpen');
  });

  it('freezes, and fails to the quiet standing on nonsense', () => {
    expect(Object.isFrozen(speakPrompt({ pushToTalk: true }))).toBe(true);
    expect(speakPrompt({ pushToTalk: true, holding: undefined }).live).toBe(false);
  });
});

// LISTENING HAS TO MEAN SOMETHING. The same class of bug as the "MIC ON"
// readout over untouched hardware: between holds the pipe is shut, and a
// sitting that reads LISTENING while nothing can reach the being is lying.
describe('voice-sitting-model — the turn readout under a shut pipe', () => {
  it('rests at WAITING when the mic pipe is closed', () => {
    expect(deriveTurnState({ micOpen: false })).toBe('waiting');
  });

  it('reads LISTENING only with the pipe actually open', () => {
    expect(deriveTurnState({ micOpen: true })).toBe('listening');
    expect(deriveTurnState()).toBe('listening'); // open-mic default, unchanged
  });

  it('the being still outranks the mic — speaking and thinking are unaffected', () => {
    expect(deriveTurnState({ micOpen: false, playbackActive: true })).toBe('speaking');
    expect(deriveTurnState({ micOpen: false, thinking: true })).toBe('thinking');
    expect(deriveTurnState({ micOpen: true, thinking: true, playbackActive: true })).toBe('speaking');
  });

  it('every standing it can return is a declared one', () => {
    for (const args of [{}, { micOpen: false }, { thinking: true }, { playbackActive: true }]) {
      expect(TURN_STATES).toContain(deriveTurnState(args));
    }
  });
});

// THE RELEASE MUST ANSWER (Design note, 2026-08-01: […]).
// Between key-up and the being thinking, the words still have to be decoded —
// and the sitting read WAITING through all of it, which is indistinguishable
// from nothing having happened.
describe('voice-sitting-model — the turn was taken, and it says so', () => {
  it('acknowledges the release before the being has anything to say', () => {
    expect(deriveTurnState({ heard: true, micOpen: false })).toBe('heard');
    expect(TURN_STATES).toContain('heard');
  });

  it('the being still outranks the acknowledgement', () => {
    expect(deriveTurnState({ heard: true, thinking: true })).toBe('thinking');
    expect(deriveTurnState({ heard: true, playbackActive: true })).toBe('speaking');
  });

  it('says nothing was taken when nothing was', () => {
    expect(deriveTurnState({ heard: false, micOpen: false })).toBe('waiting');
    expect(deriveTurnState()).toBe('listening');
  });

  it('the footer names the sending beat, in the live register', () => {
    const sending = speakPrompt({ pushToTalk: true, sending: true });
    expect(sending.key).toBe('speakSending');
    expect(sending.live).toBe(true);
    // Holding outranks it — a new hold is not a pending send.
    expect(speakPrompt({ pushToTalk: true, holding: true, sending: true }).key)
      .toBe('speakHearing');
    // And it never leaks into the open-mic lane.
    expect(speakPrompt({ pushToTalk: false, sending: true }).key).toBe('speakOpen');
  });
});

// i18n wave 2: the model returns catalog keys; the WORDS live in the en desk
// catalog (stream.*), verbatim — the rendered English must be byte-identical
// to what shipped before the keys existed.
describe('voice-sitting-model — the en catalog keeps the shipped wording verbatim', () => {
  it('renders the mic readout and prompts exactly as they rendered pre-i18n', () => {
    const open = { micState: 'listening', liveArmed: true };
    expect(deskEn.stream.micOff).toBe('MIC OFF');
    expect(deskEn.stream.micBlocked).toBe('MIC BLOCKED — NO INPUT, SEE THE CONSOLE');
    expect(deskEn.stream.micRequested).toBe('MIC REQUESTED — NOT OPEN');
    expect(deskEn.stream.micOnUnnamed).toBe('MIC ON · UNNAMED DEVICE');
    expect(deskEn.stream.speakHold).toBe('HOLD SPACE TO SPEAK.');
    expect(deskEn.stream.speakHearing).toBe('HEARING YOU — RELEASE TO SEND.');
    expect(deskEn.stream.speakOpen).toBe('SPEAK — THE MIC IS OPEN.');
    expect(deskEn.stream.speakSending).toBe('GOT IT — SENDING…');
    expect(deskEn.stream.talk).toBe('TALK');
    expect(deskEn.stream.talkTitleLeave).toBe('Leave the talk — the composer returns exactly');
    expect(deskEn.stream.talkTitleEnter).toBe('Talk with the being — voice sitting, mic open, the composer steps aside');
    const named = micReadout({ ...open, device: 'Blue Yeti' });
    expect(deskEn.stream[named.key].replace('{{device}}', named.args.device)).toBe('MIC · BLUE YETI');
  });
});
