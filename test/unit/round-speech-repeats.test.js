// roundSpeechRepeats — the paraphrase bar, measured on real round speech from
// the 2026-09-25 incident (the loop) and the same session's ordinary rounds.
import { describe, test, expect } from 'vitest';
import { roundSpeechRepeats } from '../../backend/services/portal-tool-epochs.js';

const LOOP = [
  "The screenshot isn't on disk yet — message attachments don't auto-save into the workspace. Let me check if the harness staged it anywhere I can reach.",
  "The screenshot is a message attachment — I can see it, but it's not on disk yet, so I can't attach it to a post until it's saved as a file. Let me check if the harness staged it anywhere I can reach.",
  "The screenshot is a message attachment — I can see it, but it's not on disk yet, so I can't attach it",
];
const ORDINARY = [
  "Let me ground in the current queue state and the posted ledger before staging anything — I need to know what's live, what you rejected, and where the screenshot landed on disk.",
  "The ledger is clear — the community results claim (danzer's positions) is already shipped on 09-07, so this new +1.56% position is a new claim, not a repeat. Now the queue state — what's live, what you rejected, and what's still staged.",
  "The queue is nearly clear — you rejected most of the staged posts. What's left: the lock & earn post (approved, 09-26) and the referral thread (draft). Now let me stage the results post as its own standalone post.",
];

describe('roundSpeechRepeats', () => {
  test('a paraphrased restatement of the stuck plan repeats — against any of the last rounds', () => {
    expect(roundSpeechRepeats([LOOP[0]], LOOP[1])).toBe(true);
    expect(roundSpeechRepeats([LOOP[1], ORDINARY[2]], LOOP[2])).toBe(true); // a round back, truncated
  });
  test('ordinary consecutive rounds on the same topic do not', () => {
    expect(roundSpeechRepeats([ORDINARY[0]], ORDINARY[1])).toBe(false);
    expect(roundSpeechRepeats(ORDINARY.slice(0, 2), ORDINARY[2])).toBe(false);
  });
  test('verbatim still repeats; short speech needs an exact match; tool markup and silence never count', () => {
    expect(roundSpeechRepeats(['Same words here, exactly the same.'], 'same WORDS here — exactly the same')).toBe(true);
    expect(roundSpeechRepeats(['Let me check the queue.'], 'Let me check the ledger.')).toBe(false);
    expect(roundSpeechRepeats([`${LOOP[0]} [TOOL: fs/read {"path": "/a"}]`], `${LOOP[0]} [TOOL: fs/read {"path": "/b"}]`)).toBe(true);
    expect(roundSpeechRepeats([''], '')).toBe(false);
    expect(roundSpeechRepeats([], LOOP[0])).toBe(false);
  });
  test('only the last three rounds are consulted', () => {
    expect(roundSpeechRepeats([LOOP[0], ...ORDINARY], LOOP[0])).toBe(false);
  });
});
