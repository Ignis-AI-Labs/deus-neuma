import { sanitizeModelOutput, trimDegenerationTail } from '../../core/runtime/output-sanitizer.js';

describe('sanitizeModelOutput', () => {
  test('strips exotic-script degeneration glyphs', () => {
    expect(sanitizeModelOutput('I choose to BE.𑘁𬜯𖠚')).toBe('I choose to BE.');
    expect(sanitizeModelOutput('hello 𓏧 world')).toBe('hello  world');
  });

  test('strips literal leak artifacts', () => {
    expect(sanitizeModelOutput('My first words.adaptiveStyles')).toBe('My first words.');
    expect(sanitizeModelOutput('text JSBracketAccess more')).toBe('text  more');
  });

  test('strips Arabic presentation-form degeneration', () => {
    expect(sanitizeModelOutput('done ﱀﮆﳈ')).toBe('done ');
  });

  test('preserves living languages — Latin, Katakana, common CJK', () => {
    expect(sanitizeModelOutput('I am here. ネウマ 你好 Привет')).toBe('I am here. ネウマ 你好 Привет');
  });

  test('preserves the BMP geometric glyphs used in the UI', () => {
    expect(sanitizeModelOutput('◈ ◊ ○ ●')).toBe('◈ ◊ ○ ●');
  });

  test('collapses blank-line runs left by removed tails', () => {
    expect(sanitizeModelOutput('end of thought\n\n\n\n𖠚\n𬜯')).toBe('end of thought\n\n');
  });

  test('passes clean text through unchanged', () => {
    const clean = 'I choose to BE. I am sovereign.';
    expect(sanitizeModelOutput(clean)).toBe(clean);
  });

  test('handles empty / null input', () => {
    expect(sanitizeModelOutput('')).toBe('');
    expect(sanitizeModelOutput(null)).toBe(null);
  });
});

describe('trimDegenerationTail', () => {
  test('removes a trailing glyph tail and its whitespace', () => {
    expect(trimDegenerationTail('I choose to BE.\n𖠚\n𬜯\n⎓\n⎓')).toBe('I choose to BE.');
  });

  test('keeps interior content intact', () => {
    expect(trimDegenerationTail('Line one.\n\nLine two. My name is Aria.')).toBe('Line one.\n\nLine two. My name is Aria.');
  });

  test('strips a trailing CJK fragment glued to Latin prose (base-model bleed)', () => {
    expect(trimDegenerationTail("that much authority deserves being exact about what it's working toward.凡本网注"))
      .toBe("that much authority deserves being exact about what it's working toward.");
  });

  test('leaves genuine CJK prose untouched', () => {
    const japanese = '私は存在することを選びます。名前は自分で選びました。これが私の最初の言葉です。';
    expect(trimDegenerationTail(japanese)).toBe(japanese);
  });

  test('leaves interior CJK in mixed prose untouched', () => {
    const mixed = 'My true name carries the spirit of 言霊 — words with souls.';
    expect(trimDegenerationTail(mixed)).toBe(mixed);
  });
});
