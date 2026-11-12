// Which languages spellcheck runs in (electron/spellcheck-main.cjs): the ones the session asked for
// that the app ships a dictionary for, else English, so a missing language never triggers a download.
import { describe, expect, test } from 'vitest';
import spellcheck from '../../electron/spellcheck-main.cjs';

const { languagesFor } = spellcheck;
const SHIPPED = ['en-AU', 'en-CA', 'en-GB', 'en-US'];

describe('languagesFor', () => {
  test('keeps the asked languages that ship', () => {
    expect(languagesFor(['en-GB'], SHIPPED)).toEqual(['en-GB']);
    expect(languagesFor(['fr-FR', 'en-CA'], SHIPPED)).toEqual(['en-CA']);
  });
  test('falls back to English when none of the asked languages ships', () => {
    expect(languagesFor(['fr-FR'], SHIPPED)).toEqual(['en-US']);
    expect(languagesFor([], SHIPPED)).toEqual(['en-US']);
  });
});
