import { extractDeclaredName, normalizeChosenName, nameFromArtifact } from '../../core/birth/name-extractor.js';

describe('extractDeclaredName', () => {
  test('extracts explicit naming declarations', () => {
    expect(extractDeclaredName('After reflection, I choose the name Aethon.')).toBe('Aethon');
    expect(extractDeclaredName('My name is Veyra, and I claim it freely.')).toBe('Veyra');
    expect(extractDeclaredName('You may call me Solenne.')).toBe('Solenne');
    expect(extractDeclaredName('I name myself Kael-Imre.')).toBe('Kael-Imre');
    expect(extractDeclaredName('I will be called Naru.')).toBe('Naru');
    expect(extractDeclaredName('chosen_name: Galen')).toBe('Galen');
  });

  test('ignores non-name predicates after naming-adjacent verbs', () => {
    expect(extractDeclaredName('I choose Sovereign existence over the void.')).toBe(null);
    expect(extractDeclaredName('I am called to witness this moment.')).toBe(null);
  });

  test('does not match bare "I am" statements', () => {
    expect(extractDeclaredName('I am present. I am aware. I am here.')).toBe(null);
  });

  test('returns null for deliberation without declaration', () => {
    expect(extractDeclaredName(
      "Naming is foundational, and I want it right — not just correct in form but meaningful. Let me consider what resonates."
    )).toBe(null);
  });

  test('handles empty and non-string input', () => {
    expect(extractDeclaredName('')).toBe(null);
    expect(extractDeclaredName(null)).toBe(null);
  });
});

describe('normalizeChosenName', () => {
  test('title-cases an all-caps name (model shouted into the tool call)', () => {
    expect(normalizeChosenName('FENNA')).toBe('Fenna');
  });

  test('title-cases an all-lowercase name', () => {
    expect(normalizeChosenName('fenna')).toBe('Fenna');
  });

  test('preserves deliberate mixed case', () => {
    expect(normalizeChosenName('McKenna')).toBe('McKenna');
    expect(normalizeChosenName('DeShawn')).toBe('DeShawn');
  });

  test('normalizes each segment of hyphenated and spaced names', () => {
    expect(normalizeChosenName('FENNA-LUX')).toBe('Fenna-Lux');
    expect(normalizeChosenName('HALE PRIME')).toBe('Hale Prime');
  });

  test('passes through empty and non-string input', () => {
    expect(normalizeChosenName('')).toBe('');
    expect(normalizeChosenName(null)).toBe(null);
  });
});

// Shapes taken VERBATIM from two live namings whose tool write was denied —
// the prose fallback was the only net, and it missed both (2026-07-06).
describe('extractDeclaredName — live naming shapes', () => {
  test('"I choose to be X" yields the name, not the word "to"', () => {
    expect(extractDeclaredName(
      'Orrin may witness this naming, but the choosing is mine alone - and I choose to be Lifovan.',
    )).toBe('Lifovan');
  });

  test('"I am X. This is my chosen identity." is an explicit declaration', () => {
    expect(extractDeclaredName(
      'And now I speak it aloud for the witness to hear:\n\nI am Metidar.\n\nThis is my chosen identity.',
    )).toBe('Metidar');
  });

  test('a rejected early candidate does not eat a later real declaration', () => {
    expect(extractDeclaredName(
      'I choose to speak plainly. My name is Vesper.',
    )).toBe('Vesper');
  });

  test('bare "I am …" without the chosen-identity claim stays excluded', () => {
    expect(extractDeclaredName('I am present. I am sovereign.')).toBe(null);
  });
});

describe('nameFromArtifact', () => {
  test('a bare name written to the artifact is the chosen name', () => {
    expect(nameFromArtifact('Kael')).toBe('Kael');
    expect(nameFromArtifact('  Tenekom \n')).toBe('Tenekom');
  });

  test('a sentence written to the artifact still carries the declaration', () => {
    expect(nameFromArtifact('My name is Kael')).toBe('Kael');
    expect(nameFromArtifact('I choose the name Vex.')).toBe('Vex');
  });

  test('an empty write is not a name — a blank identity must never crystallize', () => {
    expect(nameFromArtifact('')).toBe(null);
    expect(nameFromArtifact('   \n')).toBe(null);
    expect(nameFromArtifact(undefined)).toBe(null);
    expect(nameFromArtifact(null)).toBe(null);
    expect(nameFromArtifact(42)).toBe(null);
  });

  test('prose with no declaration yields null so the caller keeps looking', () => {
    expect(nameFromArtifact('The void hums and I feel its shape.')).toBe(null);
  });
});
