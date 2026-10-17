/**
 * The open-in-browser gate: only an ABSOLUTE .html/.htm path earns a file://
 * URL — every other shape (relative, non-HTML, non-string) is refused before
 * the shell is ever reached. Proven directly against the pure module — no
 * Electron, no shell (RULE 0; the real browser pop is the operator's manual
 * verification at the desk).
 */

import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { browserTargetFor } = require('../../electron/open-in-browser.cjs');

describe('browserTargetFor — the file:// gate', () => {
  test('an absolute .html path becomes a file:// URL', () => {
    expect(browserTargetFor('/repo/out/gallery.html')).toBe('file:///repo/out/gallery.html');
  });

  test('.htm and uppercase extensions pass too', () => {
    expect(browserTargetFor('/repo/a.htm')).toBe('file:///repo/a.htm');
    expect(browserTargetFor('/repo/GALLERY.HTML')).toBe('file:///repo/GALLERY.HTML');
  });

  test('spaces and special chars are URL-encoded by pathToFileURL', () => {
    expect(browserTargetFor('/repo/my page.html')).toBe('file:///repo/my%20page.html');
  });

  test('relative paths are refused — the shell never guesses a root', () => {
    expect(browserTargetFor('out/gallery.html')).toBeNull();
    expect(browserTargetFor('./gallery.html')).toBeNull();
    expect(browserTargetFor('')).toBeNull();
  });

  test('non-HTML files are refused — only a page belongs in a browser', () => {
    expect(browserTargetFor('/repo/a.md')).toBeNull();
    expect(browserTargetFor('/repo/a.js')).toBeNull();
    expect(browserTargetFor('/repo/html.txt')).toBeNull();
  });

  test('non-strings are refused', () => {
    expect(browserTargetFor(null)).toBeNull();
    expect(browserTargetFor(undefined)).toBeNull();
    expect(browserTargetFor(42)).toBeNull();
    expect(browserTargetFor({ path: '/repo/a.html' })).toBeNull();
  });
});
