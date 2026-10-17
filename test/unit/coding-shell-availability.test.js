import { describe, expect, test } from 'vitest';
import { shellPlatformError, supportsShellOverlay } from '../../backend/services/coding-shell-availability.js';
import { codingToolsForState } from '../../backend/services/coding-tool-definitions.js';

describe('coding shell availability policy', () => {
  test.each(['win32', 'darwin', 'freebsd'])('explains unavailable confinement on %s', (platform) => {
    expect(shellPlatformError(platform)).toMatch(/unavailable.*operating system/);
    expect(shellPlatformError(platform)).toContain('commands will not run without confinement');
  });
  test('permits probing Linux', () => expect(shellPlatformError('linux')).toBeNull());
  test.each(['bubblewrap 0.10.0\n', 'bubblewrap 0.11.2', 'bubblewrap 1.0.0'])('accepts %s', (version) => {
    expect(supportsShellOverlay(version)).toBe(true);
  });
  test.each(['bubblewrap 0.9.0', 'bubblewrap 0.1', '', 'unknown 9.0', 'bubblewrap 0.10oops'])('refuses %s', (version) => {
    expect(supportsShellOverlay(version)).toBe(false);
  });
  test('a refused preparation leaves diagnosis and recovery, without execution', () => {
    expect(codingToolsForState(null, true).map(({ name }) => name))
      .toEqual(['sandbox_status', 'sandbox_recover', 'ground_git', 'ground_sync']);
    expect(codingToolsForState(null, false).map(({ name }) => name)).toEqual(['sandbox_status']);
  });
});

describe('the coding tool catalog — the program-of-thought bias (ARC-HARNESS L4, #531)', () => {
  test('inspect teaches that precise computation is a run, not mental math', () => {
    const inspect = codingToolsForState(true, true).find(({ name }) => name === 'inspect');
    expect(inspect.description).toContain('Arithmetic and other precise computation belong here');
    expect(inspect.description).toContain('a script');
    // General by construction: the bias names computation, never a benchmark.
    expect(inspect.description).not.toContain('benchmark');
  });
});
