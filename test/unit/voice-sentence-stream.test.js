import { describe, it, expect } from 'vitest';
import { createSentenceStream, _splitBuffer, hasSpeakableContent } from '../../backend/services/voice/sentence-stream.js';

describe('voice/sentence-stream.js', () => {
  describe('_splitBuffer', () => {
    it('returns null head when buffer is below minLength', () => {
      const [head, tail] = _splitBuffer('short', 24, 240);
      expect(head).toBeNull();
      expect(tail).toBe('short');
    });

    it('splits on strong boundary (. followed by space)', () => {
      const [head, tail] = _splitBuffer('Hello world. Next sentence.', 5, 240);
      expect(head).toBe('Hello world. ');
      expect(tail).toBe('Next sentence.');
    });

    it('splits on strong boundary at end of buffer', () => {
      const [head, tail] = _splitBuffer('Hello world.', 5, 240);
      expect(head).toBe('Hello world.');
      expect(tail).toBe('');
    });

    it('splits on ? and ! (consuming trailing whitespace)', () => {
      expect(_splitBuffer('Why? Because.', 3, 240)[0]).toBe('Why? ');
      expect(_splitBuffer('Wow! Indeed.', 3, 240)[0]).toBe('Wow! ');
    });

    it('splits on CJK fullwidth terminator (no whitespace required)', () => {
      const [head, tail] = _splitBuffer('こんにちは世界。次の文。', 3, 240);
      expect(head).toBe('こんにちは世界。');
      expect(tail).toBe('次の文。');
    });

    it('forces split at last space when buffer exceeds maxLength with no boundary', () => {
      // 60 chars of "word word word..." then a comma after maxLength
      // comma is past the window, so falls back to last space within window
      const buf = 'word '.repeat(12) + ',bbbbbbbbbbbbbbbb';
      const [head, tail] = _splitBuffer(buf, 5, 40);
      expect(head.length).toBeLessThanOrEqual(40);
      expect(tail.length).toBeGreaterThan(0);
    });

    it('forces split on space as last resort', () => {
      const buf = 'word '.repeat(20) + 'tail';
      const [head, tail] = _splitBuffer(buf, 5, 40);
      expect(head.length).toBeLessThanOrEqual(40);
      expect(tail.length).toBeGreaterThan(0);
    });

    it('returns whole window when no boundary at all', () => {
      const buf = 'a'.repeat(100);
      const [head, tail] = _splitBuffer(buf, 5, 40);
      expect(head).toBe('a'.repeat(40));
      expect(tail).toBe('a'.repeat(60));
    });
  });

  describe('createSentenceStream', () => {
    it('accumulates chunks and emits on sentence boundary', () => {
      const emitted = [];
      const s = createSentenceStream((x) => emitted.push(x));
      s.push('Hello ');
      s.push('world.');
      s.push(' Second ');
      s.push('sentence.');
      s.flush();
      expect(emitted).toEqual(['Hello world.', 'Second sentence.']);
    });

    it('does not emit anything when only whitespace received', () => {
      const emitted = [];
      const s = createSentenceStream((x) => emitted.push(x));
      s.push('  \n  ');
      s.flush();
      expect(emitted).toEqual([]);
    });

    it('trims leading/trailing whitespace per emitted sentence', () => {
      const emitted = [];
      const s = createSentenceStream((x) => emitted.push(x));
      s.push('   Hello world.   ');
      s.flush();
      expect(emitted).toEqual(['Hello world.']);
    });

    it('flushes remaining buffer at stream end', () => {
      const emitted = [];
      const s = createSentenceStream((x) => emitted.push(x), { minLength: 200 });
      s.push('partial sentence with no terminator');
      s.flush();
      expect(emitted).toEqual(['partial sentence with no terminator']);
    });

    it('reset clears the buffer', () => {
      const emitted = [];
      const s = createSentenceStream((x) => emitted.push(x), { minLength: 200 });
      s.push('buffered content not yet emittable');
      s.reset();
      s.flush();
      expect(emitted).toEqual([]);
    });

    it('simulates realistic LLM token stream', () => {
      const tokens = ['The', ' neuma', ' emerges', ' from', ' the', ' void', '.',
                      ' It', ' speaks', ' its', ' first', ' words', '.',
                      ' The', ' witness', ' listens', '.'];
      const emitted = [];
      const s = createSentenceStream((x) => emitted.push(x));
      for (const tok of tokens) s.push(tok);
      s.flush();
      expect(emitted).toEqual([
        'The neuma emerges from the void.',
        'It speaks its first words.',
        'The witness listens.',
      ]);
    });

    it('respects custom maxLength for long utterances', () => {
      const emitted = [];
      const s = createSentenceStream((x) => emitted.push(x), { maxLength: 30 });
      s.push('this is a very long run of text without any sentence boundary for a long long long stretch');
      s.flush();
      // should be split into multiple chunks of <= ~30 chars
      expect(emitted.length).toBeGreaterThan(1);
      for (const e of emitted) expect(e.length).toBeLessThanOrEqual(31);
    });

    it('push ignores empty/null chunks', () => {
      const emitted = [];
      const s = createSentenceStream((x) => emitted.push(x));
      s.push('');
      s.push(null);
      s.push('Real sentence.');
      s.flush();
      expect(emitted).toEqual(['Real sentence.']);
    });
  });
});

// THE FIRST SENTENCE LEAVES EARLY (Design note, 2026-08-01: […]). Only the first sentence of a turn is ever waited on — every
// later one is synthesized while the previous is still playing — so it carries
// the whole of the witness's perceived delay.
//
// What the floor controls is WHEN a boundary is looked for, not which boundary
// is taken: so these assert emission TIMING against arriving chunks, which is
// the thing that actually shortens the wait.
describe('sentence-stream — the first sentence leaves early', () => {
  // Push chunks one at a time, recording how many sentences had been emitted
  // after each — the shape of the wait, not just the final text.
  const timeline = (chunks, options) => {
    const out = [];
    const counts = [];
    const s = createSentenceStream((x) => out.push(x), options);
    for (const c of chunks) { s.push(c); counts.push(out.length); }
    return { out, counts, stream: s };
  };

  const OPENER = 'I hear you. ';                                  // 12 chars
  const REST = 'The routing problem is a dispatch table. ';

  it('releases a short opening on its own chunk instead of holding it', () => {
    const { out, counts } = timeline([OPENER, REST]);
    expect(counts[0]).toBe(1);        // spoken before the second chunk existed
    expect(out[0]).toBe('I hear you.');
  });

  it('the old floor would have made that opening WAIT for more text', () => {
    // Same input, first-sentence floor raised to the ordinary buffer: nothing
    // leaves on the first chunk. This is the delay the fast path removes.
    const { counts } = timeline([OPENER, REST], { firstMinLength: 24 });
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBeGreaterThan(0);
  });

  it('LATER sentences go back to the full buffer — the fast path is first-only', () => {
    // After the opener, a 5-char chunk must NOT leave on its own; it waits for
    // the ordinary buffer exactly as it always did.
    const { counts } = timeline([OPENER, 'Yes. ', REST]);
    expect(counts[0]).toBe(1); // the opener
    expect(counts[1]).toBe(1); // 'Yes. ' alone did not clear the 24-char floor
    expect(counts[2]).toBeGreaterThan(1);
  });

  it('a first sentence under even the fast floor still waits — no clipped word', () => {
    const { out } = timeline(['Yes. ']);
    expect(out).toEqual([]); // 5 chars: below the first-sentence floor too
  });

  it('the whole reply still arrives, in order, unchanged', () => {
    const { out, stream } = timeline([
      OPENER, 'The shape is simpler than it looks. ', 'Want me to sketch it?',
    ]);
    stream.flush();
    expect(out.join(' ')).toBe('I hear you. The shape is simpler than it looks. Want me to sketch it?');
  });

  it('reset makes it a fresh turn — the next first sentence leaves early again', () => {
    const out = [];
    const s = createSentenceStream((x) => out.push(x));
    s.push(OPENER);
    s.push('A much longer second sentence that clears the ordinary buffer. ');
    const before = out.length;
    s.reset();
    s.push(OPENER);
    expect(out.length).toBe(before + 1); // left on its own chunk again
    expect(out[out.length - 1]).toBe('I hear you.');
  });
});

// A real sitting logged `kokoro synthesize failed (500): kokoro produced no
// audio` on a reply's tail fragment — a wasted round trip, a warn, and with
// voice-gated display a sentence whose words reach the desk down the FAILURE
// path instead of the audio path.
describe('sentence-stream — is there anything to say?', () => {
  it('accepts anything with letters or digits, in any script', () => {
    expect(hasSpeakableContent('Hello.')).toBe(true);
    expect(hasSpeakableContent('3 things')).toBe(true);
    expect(hasSpeakableContent('ここに')).toBe(true);
    expect(hasSpeakableContent('Ω')).toBe(true);
    expect(hasSpeakableContent('a')).toBe(true);
  });

  it('refuses fragments an engine can only fail on', () => {
    expect(hasSpeakableContent('...')).toBe(false);
    expect(hasSpeakableContent(' — ')).toBe(false);
    expect(hasSpeakableContent(')')).toBe(false);
    expect(hasSpeakableContent('')).toBe(false);
    expect(hasSpeakableContent('   ')).toBe(false);
    expect(hasSpeakableContent('•')).toBe(false);
  });

  it('never throws on non-strings — a bad input is simply unspeakable', () => {
    expect(hasSpeakableContent(null)).toBe(false);
    expect(hasSpeakableContent(undefined)).toBe(false);
    expect(hasSpeakableContent(42)).toBe(false);
  });
});

// THE STAMMER (Design note, 2026-08-01: […]). A terminator used to
// end a sentence with ZERO or more whitespace after it, so any full stop
// anywhere was a boundary. Measured against this real splitter before the fix:
// one ordinary technical reply of four sentences came out as NINE fragments —
// […] + […], […] + […].
// Each fragment is its own synthesis request, and every request arrives with
// ~400 ms of head and ~550 ms of tail silence baked in by the engine, so the
// fragmentation did not merely mangle the words — it multiplied the dead air
// by the fragment count.
describe('sentence-stream — a full stop inside a word is not a sentence', () => {
  const split = (text) => {
    const out = [];
    const s = createSentenceStream((x) => out.push(x));
    for (const tok of text.match(/\S+\s*/g) || [text]) s.push(tok);
    s.flush();
    return out;
  };

  it('keeps file names whole', () => {
    expect(split('I read portal-stream.js at line 6103 for you.'))
      .toEqual(['I read portal-stream.js at line 6103 for you.']);
  });

  it('keeps decimals and version numbers whole', () => {
    expect(split('The rate is 24.0 kHz and the adapter is v2.0 today.'))
      .toEqual(['The rate is 24.0 kHz and the adapter is v2.0 today.']);
  });

  it('the reply that used to shatter into nine now speaks in two', () => {
    const chunks = split(
      'Hey. I read portal-stream.js at line 6103. The rate is 24.0 kHz. Let me check v2.0 now.',
    );
    expect(chunks.length).toBeLessThanOrEqual(3);
    // Nothing may be lost or invented by the coalescing — same words, fewer cuts.
    expect(chunks.join(' ')).toContain('portal-stream.js');
    expect(chunks.join(' ')).toContain('24.0 kHz');
    expect(chunks.join(' ')).toContain('v2.0');
  });

  it('still splits real sentence ends', () => {
    expect(split('I hear you. Let me think about that for a moment. It matters.'))
      .toEqual(['I hear you.', 'Let me think about that for a moment.', 'It matters.']);
  });

  it('still splits CJK, which does not space its sentences', () => {
    // 。 is never a decimal point or a filename separator, so it needs no
    // whitespace after it — requiring one would stop splitting Japanese.
    const [head, tail] = _splitBuffer('こんにちは世界。次の文。', 3, 240);
    expect(head).toBe('こんにちは世界。');
    expect(tail).toBe('次の文。');
  });
});
