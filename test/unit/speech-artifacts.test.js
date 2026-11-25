/**
 * What Whisper writes over silence never reaches the chat box, another app, or a recording's
 * transcript (core/text/speech-artifacts.js). The first case is the line that landed at the end of
 * Founder's dictation on 2026-11-15.
 */
import { describe, expect, test } from 'vitest';
import { withoutSpeechArtifacts } from '../../core/text/speech-artifacts.js';
import { appendTranscript, spliceTranscript } from '../../frontend/app/RelinkShell/dictation.js';

const SAID = 'we don\'t have the ability to get where we want to go without each other and that especially financial';

describe('lines Whisper writes over silence', () => {
  test('the FEMA line at the end of a hold is gone, and what was said stays whole', () => {
    expect(withoutSpeechArtifacts(`${SAID} For more information, visit www.fema.gov`)).toBe(SAID);
    expect(withoutSpeechArtifacts('For more information visit www.FEMA.gov.')).toBe('');
    expect(withoutSpeechArtifacts(`${SAID} Subtitles by the Amara.org community`)).toBe(SAID);
  });

  test('the artifacts a person could say are removed only when they are all that came back', () => {
    expect(withoutSpeechArtifacts('Thanks for watching!')).toBe('');
    expect(withoutSpeechArtifacts('you')).toBe('');
    expect(withoutSpeechArtifacts('Thanks for watching the demo with me, it went well.')).toBe('Thanks for watching the demo with me, it went well.');
    expect(withoutSpeechArtifacts('Thank you.')).toBe('Thank you.');
  });

  test('the chat box takes the words and never the artifact', () => {
    expect(appendTranscript('Draft.', `${SAID} For more information, visit www.fema.gov`)).toBe(`Draft. ${SAID}`);
    expect(appendTranscript('Draft.', 'For more information, visit www.fema.gov')).toBe('Draft.');
    expect(spliceTranscript('', 0, 0, 'Thanks for watching!')).toBeNull();
  });
});
