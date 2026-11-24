// PR20 H-09: Darwin path law, exercised as logic on any host. A real APFS
// firmlink is not available on Linux, so actual macOS inode behavior remains host-proof owed.
import { describe, expect, test } from 'vitest';
import { macFirmlinkRefusal } from '../../backend/services/wall-spelling.js';
import { platformWallWriteReason } from '../../backend/services/platform-write-walls.js';
import { checkPathAccess } from '../../backend/services/sandbox-path-policy.js';

describe('PR20 H-09: macOS firmlink spellings are refused before every wall', () => {
  test.each([
    '/System/Volumes',
    '/System/Volumes/Data/Users/operator/.zshrc',
    '/system/volumes/data/Users/operator/Library/LaunchAgents/planted.plist',
    '/System/Volumes/Data/Users/operator/.neuma/data/settings/tool-policy.json',
  ])('%s is refused for reads and writes on Darwin', (target) => {
    expect(macFirmlinkRefusal(target, 'darwin')).toContain('/System/Volumes');
    expect(platformWallWriteReason(target, [], 'darwin')).toContain('/System/Volumes');
    expect(checkPathAccess(target, [], { platform: 'darwin' })).toMatchObject({ allowed: false, reason: expect.stringContaining('/System/Volumes') });
  });

  test('ordinary macOS paths and non-Darwin path law are unchanged', () => {
    expect(macFirmlinkRefusal('/Users/operator/project/file.txt', 'darwin')).toBeNull();
    expect(macFirmlinkRefusal('/System/Volumes/Data/Users/operator/file.txt', 'linux')).toBeNull();
    expect(checkPathAccess('/Users/operator/project/file.txt', [], { platform: 'darwin' }).allowed).toBe(true);
    expect(platformWallWriteReason('/Users/operator/project/file.txt', [], 'darwin')).toBeNull();
  });
});
