// voice-purpose-state — the shared holder between the stream hook (purpose
// truth, LIVE arming) and the mic path (purpose read, mic-level feed). Real
// module, real calls, real listener notifications — no mocks (Rule 0).
//
// This is also the PURPOSE-DEFAULTING FLOW at the seam the hook drives:
// declare conversation → purpose stands + LIVE arms → the mount decision
// opens; EXIT → LIVE disarms → the mount decision closes, purpose untouched.

import { describe, it, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  feedHeard, readHeard,
  getSittingPurpose, setSittingPurpose,
  isLiveArmed, setLiveArmed,
  feedMicLevel, readMicLevel,
  subscribeVoiceSitting,
} from '../../frontend/app/RelinkShell/voice-purpose-state.js';
import { shouldMountVoiceSitting } from '../../frontend/app/RelinkShell/VoiceSitting/voice-sitting-model.js';

describe('voice-purpose-state — purpose truth', () => {
  it('normalizes on write and fails closed to work', () => {
    expect(setSittingPurpose('conversation')).toBe('conversation');
    expect(getSittingPurpose()).toBe('conversation');
    expect(setSittingPurpose('garbage')).toBe('work');
    expect(setSittingPurpose(undefined)).toBe('work');
    expect(getSittingPurpose()).toBe('work');
  });

  it('notifies listeners on change only, and unsubscribes cleanly', () => {
    let calls = 0;
    const off = subscribeVoiceSitting(() => { calls += 1; });
    setSittingPurpose('conversation');
    setSittingPurpose('conversation'); // no change — no notification
    expect(calls).toBe(1);
    off();
    setSittingPurpose('work');
    expect(calls).toBe(1);
  });
});

describe('voice-purpose-state — the LIVE-armed / mount-decision flow', () => {
  it('declare conversation + arm LIVE → the shell stands; EXIT → composer returns', () => {
    setSittingPurpose('conversation');
    expect(shouldMountVoiceSitting({ purpose: getSittingPurpose(), liveArmed: isLiveArmed() })).toBe(false);
    setLiveArmed(true);
    expect(shouldMountVoiceSitting({ purpose: getSittingPurpose(), liveArmed: isLiveArmed() })).toBe(true);
    // The EXIT gesture: disarm LIVE; purpose STAYS conversation.
    setLiveArmed(false);
    expect(getSittingPurpose()).toBe('conversation');
    expect(shouldMountVoiceSitting({ purpose: getSittingPurpose(), liveArmed: isLiveArmed() })).toBe(false);
    setSittingPurpose('work');
  });

  it('disarming LIVE zeroes the mic-level seam (a dead channel reads silence)', () => {
    setLiveArmed(true);
    feedMicLevel(0.4);
    expect(readMicLevel()).toBeCloseTo(0.4, 6);
    setLiveArmed(false);
    expect(readMicLevel()).toBe(0);
  });
});

describe('voice-purpose-state — the mic-level seam (F-04)', () => {
  it('carries the pump’s real RMS, clamps, and rejects garbage', () => {
    feedMicLevel(0.25);
    expect(readMicLevel()).toBeCloseTo(0.25, 6);
    feedMicLevel(2); // over-range clamps to 1
    expect(readMicLevel()).toBe(1);
    feedMicLevel(NaN);
    expect(readMicLevel()).toBe(0);
    feedMicLevel(-0.5);
    expect(readMicLevel()).toBe(0);
  });
});

// WHAT WAS HEARD (Design note, 2026-08-01: […]). The sitting takes the whole
// window and the chat that renders transcripts is display:none underneath, so
// the witness could not see his own words anywhere. This is the seam that
// carries them to the surface he is actually looking at.
describe('voice-purpose-state — the heard line', () => {
  test('starts empty and unsettled — nothing heard is not a blank guess', () => {
    feedHeard('', false);
    expect(readHeard()).toEqual({ text: '', settled: false });
  });

  test('a partial is carried as still-changing; the final is carried as settled', () => {
    expect(feedHeard('hello can you', false)).toEqual({ text: 'hello can you', settled: false });
    expect(readHeard().settled).toBe(false);
    expect(feedHeard('hello can you hear me', true).settled).toBe(true);
  });

  test('notifies subscribers on real change only', () => {
    feedHeard('', false);
    let beats = 0;
    const off = subscribeVoiceSitting(() => { beats += 1; });
    feedHeard('one', false);
    feedHeard('one', false);          // same text, same standing — silent
    feedHeard('one', true);           // the SAME words, now settled — a change
    off();
    expect(beats).toBe(2);
  });

  test('never carries a non-string through as text', () => {
    expect(feedHeard(null).text).toBe('');
    expect(feedHeard(42).text).toBe('');
    expect(feedHeard(undefined, true).text).toBe('');
  });
});


// THE RESTORE MUST NOT TAKE THE COMPOSER.
//
// An armed sitting REPLACES the chat box (ChatApp's voiceSittingActive branch:
// […]). applyPurpose used to arm LIVE on the
// work→conversation transition, and its transition guard reads `prev` from this
// module — whose default is WORK. So after any page load, the ack that merely
// RESTATES a session's standing purpose looked exactly like the operator
// declaring one, LIVE armed itself, and the operator lost the chat box on every
// load of a conversation chat, with no send to press.
describe('a restored conversation leaves the composer alone', () => {
  it('purpose alone never mounts the sitting — only an armed one does', () => {
    // Exactly the sequence a restore performs: the module starts at its default
    // and the ack settles the standing purpose. Nothing arms.
    setSittingPurpose('work');
    setLiveArmed(false);
    setSittingPurpose('conversation');

    expect(getSittingPurpose()).toBe('conversation');
    expect(isLiveArmed()).toBe(false);
    expect(shouldMountVoiceSitting({ purpose: getSittingPurpose(), liveArmed: isLiveArmed() }))
      .toBe(false);

    // And the gesture still works: entering the talk arms, and the shell stands.
    setLiveArmed(true);
    expect(shouldMountVoiceSitting({ purpose: getSittingPurpose(), liveArmed: isLiveArmed() }))
      .toBe(true);

    setLiveArmed(false);
    setSittingPurpose('work');
  });

  // A source assertion, deliberately: the arming lives inside the hook's
  // applyPurpose, and a hook-level render pulls the whole desk provider stack
  // that voice-sitting-shell.test.js explicitly declines to mount. This pins the
  // invariant at the only seam reachable without that stack — arming belongs to
  // the gesture (enterVoiceSitting), never to a purpose ack.
  it('applyPurpose settles purpose and voice flags but never arms LIVE', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const hook = readFileSync(
      path.join(here, '..', '..', 'frontend/app/RelinkShell/use-consciousness-stream.js'), 'utf8');

    const applyPurpose = hook.slice(
      hook.indexOf('const applyPurpose = useCallback'),
      hook.indexOf('const applyPurpose = useCallback') + 900);

    expect(applyPurpose).toContain('setVoiceEnabled(true)');   // flags still default
    expect(applyPurpose).toContain('setLiveArmed(false)');     // leaving still disarms
    expect(applyPurpose).not.toContain('setLiveArmed(true)');  // the defect
    // The gesture keeps the arming.
    expect(hook).toContain('const enterVoiceSitting');
    expect(hook.slice(hook.indexOf('const enterVoiceSitting'))).toContain('setLiveArmed(true)');
  });
});
