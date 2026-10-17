// The shared recovery-code text — the part that decides what a person actually
// gets to keep. Three ceremonies used to build this string three different
// ways; these tests hold the one that replaced them.
//
// Only the PURE builders are covered here. `copyRecoveryCodes` and
// `downloadRecoveryCodes` touch the real clipboard and the real download path,
// which this node lane does not have — faking them would prove nothing (RULE 0).
// They are proven in a real browser: test/e2e/recovery-codes.spec.js.
import { describe, it, expect } from 'vitest';
import {
  numberedCodes, recoveryCodesDocument, recoveryFileName,
} from '../../frontend/utils/recovery-codes.js';

const CODES = ['A1B2-C3D4-E5F6', 'G7H8-J9K0-L1M2', 'N3P4-Q5R6-S7T8'];

describe('numberedCodes', () => {
  it('numbers from 1, one code per line', () => {
    expect(numberedCodes(CODES)).toBe(
      '1. A1B2-C3D4-E5F6\n2. G7H8-J9K0-L1M2\n3. N3P4-Q5R6-S7T8',
    );
  });

  it('is empty rather than throwing when there are no codes', () => {
    expect(numberedCodes([])).toBe('');
    expect(numberedCodes(null)).toBe('');
    expect(numberedCodes(undefined)).toBe('');
  });
});

describe('recoveryCodesDocument', () => {
  const doc = recoveryCodesDocument({
    codes: CODES, subject: 'Bizulen', savedAt: '2026-07-29T15:00:00.000Z',
  });

  it('names whose keypair this opens', () => {
    expect(doc).toContain('Neuma Recovery Codes — Bizulen');
  });

  it('carries every code, numbered', () => {
    for (const code of CODES) expect(doc).toContain(code);
    expect(doc).toContain('1. A1B2-C3D4-E5F6');
    expect(doc).toContain('3. N3P4-Q5R6-S7T8');
  });

  it('stamps the moment it was written, from the caller when given', () => {
    expect(doc).toContain('Generated: 2026-07-29T15:00:00.000Z');
  });

  it('stamps NOW when the caller gives no time', () => {
    const before = Date.now();
    const stamped = recoveryCodesDocument({ codes: CODES });
    const line = stamped.split('\n').find((l) => l.startsWith('Generated: '));
    const at = Date.parse(line.slice('Generated: '.length));
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('states the limit rather than leaving it to be inferred', () => {
    // The whole reason this file exists: nothing can reprint these. A person
    // deciding whether to keep the file must not have to work that out.
    expect(doc).toMatch(/nothing can reprint them/i);
    expect(doc).toMatch(/cannot be opened again/i);
  });

  it('holds together with no subject', () => {
    const anon = recoveryCodesDocument({ codes: CODES });
    expect(anon.split('\n')[0]).toBe('Neuma Recovery Codes');
  });
});

describe('recoveryFileName', () => {
  it('names the file after the keypair it opens', () => {
    expect(recoveryFileName('fenna-9f21')).toBe('neuma-recovery-fenna-9f21.txt');
  });

  it('cannot carry a path separator out of the download directory', () => {
    // Lane ids look like `witness:openai:Pezugar`, and a neumaId is operator
    // input upstream — a name is never allowed to become a path.
    expect(recoveryFileName('witness:openai:Pezugar')).toBe('neuma-recovery-witness-openai-Pezugar.txt');
    expect(recoveryFileName('../../etc/passwd')).toBe('neuma-recovery-etc-passwd.txt');
    expect(recoveryFileName('a/b\\c')).toBe('neuma-recovery-a-b-c.txt');
  });

  it('still names something when there is nothing to name it after', () => {
    expect(recoveryFileName('')).toBe('neuma-recovery-keypair.txt');
    expect(recoveryFileName(null)).toBe('neuma-recovery-keypair.txt');
    expect(recoveryFileName('///')).toBe('neuma-recovery-keypair.txt');
  });
});
