// What a person reads when the model setup cannot finish: plain words ending in one act, the
// technical cause apart. Pure functions, real inputs (RULE 0).
import { describe, test, expect } from 'vitest';
import { isFinal, plainFailure, setupFailure } from '../../backend/services/managed-ollama-errors.js';

describe('setup failures in plain words', () => {
  test('a named failure reads as one sentence ending in TRY AGAIN; its cause is the detail', () => {
    const said = plainFailure(setupFailure('DOWNLOAD_NETWORK', 'the Ollama download stopped: terminated'));
    expect(said.error).toBe('The download stopped before it finished. Check the internet connection, then press TRY AGAIN; it picks up where it stopped.');
    expect(said.detail).toBe('the Ollama download stopped: terminated');
  });
  test('the checksum failure a person saw is said without the word checksum', () => {
    const said = plainFailure(setupFailure('DOWNLOAD_DAMAGED', 'ollama-linux-amd64.tar.zst did not hash to its pinned SHA-256 after 3 downloads'));
    expect(said.error).not.toMatch(/checksum|SHA/i);
    expect(said.error).toMatch(/TRY AGAIN\.$/);
    expect(said.detail).toMatch(/SHA-256/);
  });
  test('an unnamed error (a raw fs error) still reads plainly, the raw text as the detail only', () => {
    const raw = Object.assign(new Error("ENOENT: no such file or directory, rename 'a.tmp' -> 'a'"), { code: 'ENOENT' });
    expect(plainFailure(raw)).toEqual({ error: 'Setting up the model did not finish. Press TRY AGAIN.', detail: raw.message });
  });
  test('a failure carrying its own words keeps them, with no detail repeating them', () => {
    const words = 'This disk needs about 4.3 GB free and has 1.0 GB. Free some space, then press TRY AGAIN.';
    expect(plainFailure(setupFailure('DISK_SPACE', words, words))).toEqual({ error: words, detail: null });
  });
  test('what a retry cannot mend is final; a dropped connection is not', () => {
    for (const code of ['UNSUPPORTED', 'DISK_SPACE', 'DOWNLOAD_DAMAGED']) expect(isFinal(setupFailure(code, 'x'))).toBe(true);
    for (const code of ['DOWNLOAD_NETWORK', 'PULL_FAILED', 'SERVER_START', 'MODEL_SILENT']) expect(isFinal(setupFailure(code, 'x'))).toBe(false);
    expect(isFinal(new Error('plain'))).toBe(false);
  });
});
