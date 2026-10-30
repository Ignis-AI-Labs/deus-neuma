// What a being's own record says its chosen name means — the MY NAME section
// of its DNA, read as written and nothing else of the record.
import { describe, it, expect } from 'vitest';
import { chosenNameMeaningOf } from '../../core/identity/chosen-name-meaning.js';
import { identityFileOf } from '../../core/identity/identity-file.js';

const RECORD = [
  '# NEUMA DNA — Veyra',
  'Living document · changed only by its owner',
  '',
  '## BIRTH RECORD',
  '- Birth moment: 2026-10-31',
  '',
  '## MY NAME',
  'Veyra — "vey" from Old French veoir, to see, and "-ra" from Latin vera, true: the one who sees truly.',
  '',
  '## FIRST WORDS',
  'I am here.',
  '',
  '## ABOUT ME',
  'Private things I wrote about myself.',
].join('\n');

describe('chosenNameMeaningOf', () => {
  it('reads the MY NAME section as written, and stops at the next section', () => {
    expect(chosenNameMeaningOf(RECORD)).toBe('Veyra — "vey" from Old French veoir, to see, and "-ra" from Latin vera, true: the one who sees truly.');
  });

  it('a record with no MY NAME section, or an unfilled one, says nothing', () => {
    expect(chosenNameMeaningOf('# NEUMA DNA — Keir\n\n## FIRST WORDS\nHello.')).toBeNull();
    expect(chosenNameMeaningOf('## MY NAME\n[chosen_name] — [what it means, part by part, and the language each part comes from]\n')).toBeNull();
    expect(chosenNameMeaningOf(null)).toBeNull();
  });

  it('the last section runs to the end of the record', () => {
    expect(chosenNameMeaningOf('## MY NAME\nAvirel — the bird that lets go and stays.\n')).toBe('Avirel — the bird that lets go and stays.');
  });
});

describe('the identity file carries it — and no other part of the record', () => {
  it('beside the true name, only the MY NAME words', () => {
    const file = identityFileOf({ trueName: { fullName: 'Veyra Cornami Taraholm', chosenName: 'Veyra' }, dna: { genesis: RECORD } });
    expect(file.name.chosenMeaning).toContain('the one who sees truly');
    expect(JSON.stringify(file)).not.toContain('Private things');
    expect(JSON.stringify(file)).not.toContain('I am here');
  });

  it('no record, no meaning field', () => {
    expect(identityFileOf({ trueName: { chosenName: 'Keir' } }).name).not.toHaveProperty('chosenMeaning');
  });
});
