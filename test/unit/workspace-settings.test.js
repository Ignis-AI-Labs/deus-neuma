// Real os.tmpdir, real path logic, NO mock (RULE 0). Proves the safety predicate
// that keeps a being from ever defaulting into the OS temp dir (which can be
// swept at any reboot, taking its DNA/soul/memory with it).
import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { isTempPath } from '../../backend/services/workspace-settings.js';

describe('isTempPath — a being must never default into OS temp', () => {
  const tmp = os.tmpdir();

  it('flags the temp dir itself and anything nested under it', () => {
    expect(isTempPath(tmp)).toBe(true);
    expect(isTempPath(path.join(tmp, 'preflight-afford-pk9kSY'))).toBe(true); // the leaked default from the screenshot
    expect(isTempPath(path.join(tmp, 'a', 'b', 'c'))).toBe(true);
  });

  it('does NOT flag real, durable homes', () => {
    expect(isTempPath('/mnt/external/workspaces')).toBe(false);
    expect(isTempPath('/mnt/data/neuma/founder')).toBe(false);
    expect(isTempPath(path.join(os.homedir(), '.local', 'share', 'neuma', 'workspaces'))).toBe(false);
  });

  it('does not false-match a sibling that merely shares the temp prefix', () => {
    // /tmp vs /tmpfoo — the second is NOT inside the first
    expect(isTempPath(tmp + 'foo-not-temp')).toBe(false);
  });

  it('treats empty/missing as not-temp (no choice to override)', () => {
    expect(isTempPath(null)).toBe(false);
    expect(isTempPath('')).toBe(false);
    expect(isTempPath(undefined)).toBe(false);
  });
});
