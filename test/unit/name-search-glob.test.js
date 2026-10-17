/**
 * nameSearchGlob — the package matcher compares the FULL relative path.
 * These prove the rewrite a being actually needs: `*.txt` and `nested`
 * find files that are not at the search root.
 */
import { describe, it, expect } from 'vitest';
import { nameSearchGlob } from '../../backend/services/native-filesystem.js';

describe('nameSearchGlob', () => {
  it('a star-ext becomes a nested name glob', () => {
    expect(nameSearchGlob('*.txt')).toBe('**/*.txt');
  });

  it('a bare name becomes a substring at any depth', () => {
    expect(nameSearchGlob('WalletPicker')).toBe('**/*WalletPicker*');
  });

  it('an explicit path glob is left alone', () => {
    expect(nameSearchGlob('src/**/*.js')).toBe('src/**/*.js');
    expect(nameSearchGlob('**/*.md')).toBe('**/*.md');
  });

  it('empty becomes everything under the root', () => {
    expect(nameSearchGlob('')).toBe('**/*');
    expect(nameSearchGlob(null)).toBe('**/*');
  });
});
