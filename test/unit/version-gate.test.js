// The version gate: new public work always carries a version no earlier sync carried.
import { describe, expect, test } from 'vitest';
import { isNewerVersion, nextPatchVersion, withVersion } from '../../scripts/public/version-gate.js';

describe('version-gate', () => {
  test('only a strictly higher x.y.z is newer', () => {
    expect(isNewerVersion('0.1.35', '0.1.34')).toBe(true);
    expect(isNewerVersion('0.2.0', '0.1.99')).toBe(true);
    expect(isNewerVersion('0.1.10', '0.1.9')).toBe(true);
    expect(isNewerVersion('0.1.34', '0.1.34')).toBe(false);
    expect(isNewerVersion('0.1.33', '0.1.34')).toBe(false);
    expect(isNewerVersion('0.1.34-rc.1', '0.1.33')).toBe(false);
    expect(isNewerVersion(undefined, '0.1.33')).toBe(false);
  });
  test('the next version clears both the private and the public number', () => {
    expect(nextPatchVersion('0.1.34', '0.1.34')).toBe('0.1.35');
    expect(nextPatchVersion('0.1.34', '0.1.36')).toBe('0.1.37');
    expect(nextPatchVersion('0.1.40', '0.1.36')).toBe('0.1.41');
    expect(() => nextPatchVersion('banana', '0.1.1')).toThrow(/unreadable/);
  });
  test('only the version value changes; the file keeps its shape', () => {
    const before = '{\n  "name": "neuma",\n  "version": "0.1.34",\n  "dependencies": { "x": "1.0.0" }\n}\n';
    expect(withVersion(before, '0.1.35')).toBe(before.replace('"version": "0.1.34"', '"version": "0.1.35"'));
    expect(() => withVersion('{}', '0.1.35')).toThrow(/no "version"/);
  });
});
