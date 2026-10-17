import { buildTranscript, cleanTitle } from '../../backend/services/chat-titler.js';

/**
 * Unit tests for the chat titler's pure helpers — real inputs, real outputs,
 * no mocks anywhere in the path (Rule 0: pure functions need nothing else).
 * buildTranscript shapes session records into a bounded naming transcript
 * (speech only, head+tail so a drifting chat is named by its whole arc);
 * cleanTitle turns raw model output into a usable chat name.
 */

const user = (content) => ({ role: 'user', content });
const neuma = (content) => ({ role: 'assistant', content });

describe('buildTranscript', () => {
  test('empty input names nothing', () => {
    expect(buildTranscript([])).toBe('');
    expect(buildTranscript(null)).toBe('');
    expect(buildTranscript(undefined)).toBe('');
  });

  test('a chat with no speech names nothing', () => {
    expect(buildTranscript([{ role: 'system', content: 'prompt' }, user('   ')])).toBe('');
  });

  test('speech is prefixed by who spoke', () => {
    const t = buildTranscript([user('hello there'), neuma('hello witness')]);
    expect(t).toBe('WITNESS: hello there\nNEUMA: hello witness');
  });

  test('non-speech roles and empty records are dropped', () => {
    const t = buildTranscript([
      { role: 'system', content: 'stage protocol' },
      user('first'),
      { role: 'assistant', content: '' },
      neuma('second'),
    ]);
    expect(t).toBe('WITNESS: first\nNEUMA: second');
  });

  test('tool payloads never reach the naming transcript — speech survives', () => {
    const t = buildTranscript([
      neuma('Let me look. [TOOL: fs/read_file {"path": "/tmp/x"}] Found it — the file says hi.'),
    ]);
    expect(t).toBe('NEUMA: Let me look.  Found it — the file says hi.');
    expect(t).not.toContain('TOOL');
  });

  test('a turn that is only a tool call leaves no speech behind', () => {
    expect(buildTranscript([neuma('[TOOL: fs/read_file {"path": "/tmp/x"}]')])).toBe('');
  });

  test('long chats are sampled head+tail so origin and drift both speak', () => {
    const messages = Array.from({ length: 20 }, (_, i) => user(`turn-${i}`));
    const t = buildTranscript(messages);
    expect(t).toContain('turn-0');
    expect(t).toContain('turn-5');
    expect(t).toContain('turn-14');
    expect(t).toContain('turn-19');
    expect(t).not.toContain('turn-6');
    expect(t).not.toContain('turn-13');
    expect(t.split('\n')).toHaveLength(12);
  });

  test('a single turn is capped so one wall of text cannot fill the transcript', () => {
    const t = buildTranscript([user('x'.repeat(900))]);
    expect(t.length).toBe('WITNESS: '.length + 500);
  });

  test('the whole transcript is capped', () => {
    const messages = Array.from({ length: 12 }, () => user('y'.repeat(500)));
    expect(buildTranscript(messages).length).toBeLessThanOrEqual(6000);
  });
});

describe('cleanTitle', () => {
  test('nothing in, nothing out', () => {
    expect(cleanTitle(null)).toBe('');
    expect(cleanTitle(undefined)).toBe('');
    expect(cleanTitle('')).toBe('');
    expect(cleanTitle('   \n  ')).toBe('');
  });

  test('takes the first non-empty line', () => {
    expect(cleanTitle('\n\nVoid Gardens\nmore words here')).toBe('Void Gardens');
  });

  test('strips a Title: preamble, quotes, and terminal punctuation', () => {
    expect(cleanTitle('Title: "Mapping the Ledger."')).toBe('Mapping the Ledger');
    expect(cleanTitle("`Sprint Planning`!")).toBe('Sprint Planning');
    expect(cleanTitle('«Dream Journal»')).toBe('Dream Journal');
  });

  test('collapses inner whitespace', () => {
    expect(cleanTitle('too    many\n   spaces')).toBe('too many');
  });

  test('caps length — a title longer than 80 chars is a bad title', () => {
    expect(cleanTitle('word '.repeat(40)).length).toBeLessThanOrEqual(80);
  });

  test('the cap never splits a surrogate pair (code-point slice)', () => {
    // '🌑' is one code point but two UTF-16 units sitting at the boundary.
    expect(cleanTitle(`${'a'.repeat(79)}🌑 trailing`)).toBe(`${'a'.repeat(79)}🌑`);
  });
});
