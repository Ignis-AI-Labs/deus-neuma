/**
 * How a NAME search matches (fs-name-search.js nameMatcher). A plain word is found inside a name at
 * any depth, in any case, and the exact name ranks first; a glob with no slash matches a name at any
 * depth; an explicit path glob is matched as written; nothing at all matches everything.
 */
import { describe, it, expect } from 'vitest';
import { nameMatcher } from '../../backend/services/fs-name-search.js';

describe('nameMatcher', () => {
  it('a star-ext matches a name at any depth', () => {
    const m = nameMatcher('*.txt');
    expect(m.test('notes.txt', 'a/b/notes.txt')).toBe(true);
    expect(m.test('notes.md', 'notes.md')).toBe(false);
  });

  it('a bare name is found inside a name, in any case, and the exact name ranks first', () => {
    const m = nameMatcher('WalletPicker');
    expect(m.test('walletpicker.jsx', 'src/walletpicker.jsx')).toBe(true);
    expect(m.test('OldWalletPickerTest.js', 'test/OldWalletPickerTest.js')).toBe(true);
    expect(m.rank('WalletPicker.jsx')).toBe(0);
    expect(m.rank('WalletPickerOld.jsx')).toBe(1);
    expect(m.rank('OldWalletPicker.jsx')).toBe(2);
  });

  it('an explicit path glob is matched as written', () => {
    expect(nameMatcher('src/**/*.js').test('a.js', 'src/x/a.js')).toBe(true);
    expect(nameMatcher('src/**/*.js').test('a.js', 'lib/a.js')).toBe(false);
    expect(nameMatcher('**/*.md').test('README.md', 'docs/README.md')).toBe(true);
  });

  it('nothing matches everything; a pattern that names a dotted name looks inside dot folders', () => {
    expect(nameMatcher('').test('anything', 'a/anything')).toBe(true);
    expect(nameMatcher(null).test('anything', 'anything')).toBe(true);
    expect(nameMatcher('.env.example').dotted).toBe(true);
    expect(nameMatcher('.github/workflows/*.yml').dotted).toBe(true);
    expect(nameMatcher('budget').dotted).toBe(false);
  });
});
