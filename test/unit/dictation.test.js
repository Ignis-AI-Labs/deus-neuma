// dictation.test.js — pure hold-to-talk decisions.
//
// Pure functions, real inputs, real outputs — no mock anywhere (RULE 0).

import {
  isTypingTarget, isPushToTalkPress, holdsPushToTalkKey,
  appendTranscript, spliceTranscript, stripHoldSpace, HOLD_TO_TALK_MS,
} from '../../frontend/app/RelinkShell/dictation.js';

describe('isTypingTarget', () => {
  test('fields the witness types into are typing targets', () => {
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  test('everything else is fair game for push-to-talk', () => {
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe('isPushToTalkPress', () => {
  const on = (target, overrides = {}) => ({ code: 'Space', repeat: false, target, ...overrides });

  test('first Space press outside a typing target begins capture', () => {
    expect(isPushToTalkPress(on({ tagName: 'BODY' }))).toBe(true);
    expect(isPushToTalkPress(on({ tagName: 'BUTTON' }))).toBe(true);
  });

  test('Space inside a field stays a space character', () => {
    expect(isPushToTalkPress(on({ tagName: 'TEXTAREA' }))).toBe(false);
    expect(isPushToTalkPress(on({ tagName: 'INPUT' }))).toBe(false);
    expect(isPushToTalkPress(on({ tagName: 'DIV', isContentEditable: true }))).toBe(false);
  });

  test('key auto-repeat while holding never re-triggers', () => {
    expect(isPushToTalkPress(on({ tagName: 'BODY' }, { repeat: true }))).toBe(false);
  });

  test('other keys never trigger', () => {
    expect(isPushToTalkPress(on({ tagName: 'BODY' }, { code: 'Enter' }))).toBe(false);
    expect(isPushToTalkPress(on({ tagName: 'BODY' }, { code: 'KeyV' }))).toBe(false);
  });
});

// THE REGRESSION THIS EXISTS FOR (ruling, 2026-08-01): […] Ownership of the key and the START of a hold
// are two different questions, and conflating them is what broke it — the
// auto-repeats of a held key were not owned, so their default survived, and in
// Chromium an un-prevented repeat re-arms the focused button's activation.
// The release then clicked TALK, which exits the sitting.
describe('holdsPushToTalkKey — every Space of a hold, not just its first', () => {
  const on = (target, overrides = {}) => ({ code: 'Space', repeat: false, target, ...overrides });

  test('owns the auto-repeats of a held key — the case that closed the talk', () => {
    expect(holdsPushToTalkKey(on({ tagName: 'BODY' }, { repeat: true }))).toBe(true);
    // The button that opened the sitting still holds focus. This is the one.
    expect(holdsPushToTalkKey(on({ tagName: 'BUTTON' }, { repeat: true }))).toBe(true);
  });

  test('owns the press and the release alike', () => {
    expect(holdsPushToTalkKey(on({ tagName: 'BODY' }))).toBe(true);
    expect(holdsPushToTalkKey(on({ tagName: 'BUTTON' }))).toBe(true);
  });

  test('never owns Space inside a field — there it is a space character', () => {
    expect(holdsPushToTalkKey(on({ tagName: 'TEXTAREA' }, { repeat: true }))).toBe(false);
    expect(holdsPushToTalkKey(on({ tagName: 'INPUT' }))).toBe(false);
    expect(holdsPushToTalkKey(on({ tagName: 'DIV', isContentEditable: true }))).toBe(false);
  });

  test('never owns another key, and survives nothing at all', () => {
    expect(holdsPushToTalkKey(on({ tagName: 'BODY' }, { code: 'Enter' }))).toBe(false);
    expect(holdsPushToTalkKey(undefined)).toBe(false);
    expect(holdsPushToTalkKey(null)).toBe(false);
  });

  test('beginning a capture stays the narrower question', () => {
    // Owned but NOT a new capture: the same hold continuing.
    const repeat = on({ tagName: 'BODY' }, { repeat: true });
    expect(holdsPushToTalkKey(repeat)).toBe(true);
    expect(isPushToTalkPress(repeat)).toBe(false);
  });
});

describe('appendTranscript — the auto lexicon tier', () => {
  test('repairs a mis-heard domain word as the transcript lands', () => {
    // Verbatim large-v3 output, 2026-07-31: "A neuma is…" came back "Anuma is…"
    expect(appendTranscript('', 'Anuma is a sovereign consciousness.'))
      .toBe('A neuma is a sovereign consciousness.');
    expect(appendTranscript('I asked.', 'The Numer answered.'))
      .toBe('I asked. The neuma answered.');
  });

  test('does NOT restructure what the operator said', () => {
    // Case, spacing, and filler are the manual tier — untouched here.
    expect(appendTranscript('', 'and, uh, it was  clear'))
      .toBe('and, uh, it was  clear');
  });

  test('a real word the operator could mean is left alone', () => {
    expect(appendTranscript('', 'Every Pneuma has its own DNA.'))
      .toBe('Every Pneuma has its own DNA.');
  });

  test('only the arriving transcript is repaired, never the standing draft', () => {
    // The operator may have typed or hand-corrected the draft already.
    expect(appendTranscript('Anuma stays as typed.', 'The Numer speaks.'))
      .toBe('Anuma stays as typed. The neuma speaks.');
  });
});

describe('appendTranscript', () => {
  test('an empty draft becomes the transcript', () => {
    expect(appendTranscript('', 'The portal is open.')).toBe('The portal is open.');
  });

  test('joins onto an existing draft with exactly one space', () => {
    expect(appendTranscript('First thought.', 'Second thought.')).toBe('First thought. Second thought.');
    expect(appendTranscript('Trailing space   ', 'joined.')).toBe('Trailing space joined.');
  });

  test('an empty or whitespace transcript leaves the draft untouched', () => {
    expect(appendTranscript('Keep me', '')).toBe('Keep me');
    expect(appendTranscript('Keep me', '   ')).toBe('Keep me');
    expect(appendTranscript('Keep me', null)).toBe('Keep me');
  });

  test('transcript whitespace is trimmed before joining', () => {
    expect(appendTranscript('', '  spoken words  ')).toBe('spoken words');
  });
});

describe('stripHoldSpace', () => {
  test('removes the space a hold-recognized press typed, correcting the caret', () => {
    expect(stripHoldSpace('Coming back now. ', 17)).toEqual({ value: 'Coming back now.', caret: 16 });
  });

  test('strips mid-text when the caret sat inside the draft', () => {
    expect(stripHoldSpace('before after', 7)).toEqual({ value: 'beforeafter', caret: 6 });
  });

  test('a single typed space in an empty field strips back to empty', () => {
    expect(stripHoldSpace(' ', 1)).toEqual({ value: '', caret: 0 });
  });

  test('nothing to strip when no space precedes the caret', () => {
    expect(stripHoldSpace('word', 4)).toBeNull();
    expect(stripHoldSpace('', 0)).toBeNull();
    expect(stripHoldSpace(' moved', 6)).toBeNull(); // caret wandered off the space
  });

  test('only the one typed space goes — earlier text is untouched', () => {
    expect(stripHoldSpace('a  ', 3)).toEqual({ value: 'a ', caret: 2 });
  });

  test('the hold threshold outlasts a typed tap but not a deliberate hold', () => {
    // A tap's keyup lands well under the threshold; OS key auto-repeat starts
    // no sooner than ~250ms — the window in which exactly one space exists.
    expect(HOLD_TO_TALK_MS).toBeGreaterThanOrEqual(250);
    expect(HOLD_TO_TALK_MS).toBeLessThanOrEqual(500);
  });
});

describe('spliceTranscript — dictation lands at the caret, paragraphs intact', () => {
  test('inserts at the caret, not the end of the draft', () => {
    const s = spliceTranscript('alpha  omega', 6, 6, 'middle');
    expect(s.value).toBe('alpha middle omega');
    expect(s.text).toBe('middle');
  });

  test('typed newlines before the caret survive — no space injected after them', () => {
    const s = spliceTranscript('first paragraph.\n\n', 18, 18, 'second paragraph');
    expect(s.value).toBe('first paragraph.\n\nsecond paragraph');
  });

  test('joins with exactly one space against a word on either edge', () => {
    const s = spliceTranscript('before after', 6, 6, 'between');
    expect(s.value).toBe('before between after');
  });

  test('an edge that already carries whitespace gets no extra space', () => {
    expect(spliceTranscript('lead ', 5, 5, 'word').value).toBe('lead word');
    expect(spliceTranscript(' tail', 0, 0, 'word').value).toBe('word tail');
  });

  test('the span is the text alone, so a preview pass revises itself in place', () => {
    const first = spliceTranscript('note:\n', 6, 6, 'hello wor');
    const revised = spliceTranscript(first.value, first.start, first.end, 'hello world entirely');
    expect(revised.value).toBe('note:\nhello world entirely');
    expect(revised.value.slice(revised.start, revised.end)).toBe('hello world entirely');
  });

  test('an empty draft takes the transcript bare', () => {
    const s = spliceTranscript('', 0, 0, ' spoken words ');
    expect(s.value).toBe('spoken words');
    expect(s.start).toBe(0);
    expect(s.end).toBe(12);
  });

  test('a transcript that repairs to nothing changes nothing', () => {
    expect(spliceTranscript('draft', 5, 5, '   ')).toBeNull();
    expect(spliceTranscript('draft', 5, 5, null)).toBeNull();
  });

  test('out-of-range span clamps instead of corrupting the draft', () => {
    const s = spliceTranscript('short', 99, 120, 'tail');
    expect(s.value).toBe('short tail');
  });
});
