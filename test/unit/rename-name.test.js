import { expect, test } from 'vitest';
import { assertRenameName } from '../../backend/services/rename-name.js';

test.each(['linux', 'darwin'])('POSIX filename bytes remain valid on %s', platform => {
  for (const name of [' leading.txt', 'trailing ', 'trailing.', 'trailing space .txt']) {
    expect(() => assertRenameName(name, platform)).not.toThrow();
  }
});

test('Windows refuses trailing spaces and dots, not leading or interior spaces', () => {
  for (const name of ['name ', 'name.', 'name. ']) {
    expect(() => assertRenameName(name, 'win32')).toThrow('Windows cannot store a name ending in a space or a dot.');
  }
  for (const name of [' leading.txt', 'trailing space .txt', 'plain.txt']) {
    expect(() => assertRenameName(name, 'win32')).not.toThrow();
  }
});

test.each(['linux', 'darwin', 'win32'])('empty or whitespace-only names are refused on %s', platform => {
  for (const name of ['', '   ', '\t']) expect(() => assertRenameName(name, platform)).toThrow('empty or whitespace-only');
});
