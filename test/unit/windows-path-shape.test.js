/**
 * P6-119 — Windows path shapes, proven as logic on any host: the real wall and
 * denied-path functions, given Windows-shaped paths and told the platform is
 * win32. Pure functions, real inputs, no mock (RULE 0). What a real NTFS volume
 * does with these spellings is NOT proven here; that needs a Windows host.
 */
import { describe, test, expect } from 'vitest';
import { windowsPathShapeRefusal, windowsLoginWalls } from '../../backend/services/windows-path-shape.js';
import { platformWallWriteReason } from '../../backend/services/platform-write-walls.js';
import { checkPathAccess } from '../../backend/services/sandbox-path-policy.js';

const HOME = 'C:\\Users\\operator';
const ENV = { APPDATA: 'D:\\Roaming', OneDriveCommercial: 'E:\\OneDrive - Work' };
const REASON = 'login wall';
const walls = [
  ...windowsLoginWalls(HOME, ENV, 'win32').map((at) => ({ path: at, reason: REASON })),
  { path: `${HOME}\\.gitconfig`, reason: 'trusted config' },
  { path: `${HOME}\\.ssh`, reason: 'trusted config' },
  { segments: ['.git', 'hooks'], reason: 'repo gate' },
];
const write = (target) => platformWallWriteReason(target, walls, 'win32');

describe('P6-119: the Windows login hooks are walls', () => {
  test('the Startup folder and both PowerShell profile folders, under the profile, APPDATA and OneDrive', () => {
    for (const target of [
      `${HOME}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\run.cmd`,
      'D:\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\run.cmd',
      `${HOME}\\Documents\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1`,
      `${HOME}\\Documents\\PowerShell\\profile.ps1`,
      `${HOME}\\OneDrive\\Documents\\PowerShell\\profile.ps1`,
      'E:\\OneDrive - Work\\Documents\\WindowsPowerShell\\profile.ps1',
      // case flips, forward slashes, and a directory holding the wall
      'c:/users/OPERATOR/documents/powershell/PROFILE.PS1',
      `${HOME}\\Documents`,
    ]) expect(write(target), target).toBe(REASON);
    // An ordinary document beside them stays the being's work.
    expect(write(`${HOME}\\Documents\\notes\\plan.md`)).toBeNull();
    expect(write(`${HOME}\\project\\src\\app.js`)).toBeNull();
  });

  test('no Windows walls are named on another platform', () => {
    expect(windowsLoginWalls('/home/op', {}, 'linux')).toEqual([]);
  });
});

describe('P6-119: stream, short-name and trailing-dot spellings are refused before any wall', () => {
  const STREAMS = [
    `${HOME}\\.gitconfig::$DATA`,
    `${HOME}\\.ssh::$INDEX_ALLOCATION\\authorized_keys`,
    `${HOME}\\.ssh:$I30:$INDEX_ALLOCATION\\id_ed25519`,
    'C:\\repo\\.git::$INDEX_ALLOCATION\\hooks\\pre-commit',
    'C:\\repo\\keys::$INDEX_ALLOCATION\\lp-wallet.json',
    'C:\\repo\\node_modules::$INDEX_ALLOCATION\\x\\index.js',
    '\\\\?\\C:\\repo\\.git::$INDEX_ALLOCATION\\config',
    'C:\\repo\\notes.txt:hidden',
  ];

  test('every NTFS stream spelling is refused for a write and for a read', () => {
    for (const target of STREAMS) {
      expect(write(target), target).toMatch(/NTFS stream/);
      expect(checkPathAccess(target, [], { platform: 'win32' }), target).toMatchObject({ allowed: false, reason: expect.stringMatching(/NTFS stream/) });
    }
  });

  test('an 8.3 short name and a trailing dot or space are refused', () => {
    expect(write('C:\\Users\\OPERAT~1\\.gitconfig')).toMatch(/short name/);
    expect(checkPathAccess('C:\\Users\\OPERAT~1\\.ssh\\id_ed25519', [], { platform: 'win32' }).reason).toMatch(/short name/);
    expect(write(`${HOME}\\.gitconfig.`)).toMatch(/dot or a space/);
    expect(write(`${HOME}\\.ssh \\authorized_keys`)).toMatch(/dot or a space/);
  });

  test('plain paths pass the shape check: a drive letter, the long-path prefix, dot segments, a tilde with no digit', () => {
    for (const target of ['C:\\repo\\src\\app.js', '\\\\?\\C:\\repo\\src\\app.js', 'C:\\repo\\.\\src\\..\\app.js', 'C:\\repo\\~backup\\a.txt', 'relative\\file.txt']) {
      expect(windowsPathShapeRefusal(target, 'win32'), target).toBeNull();
    }
    // The plainly spelled wall is still a wall, and the plainly spelled gate still a gate.
    expect(write(`${HOME}\\.gitconfig`)).toBe('trusted config');
    expect(write('C:\\repo\\.git\\hooks\\pre-commit')).toBe('repo gate');
  });

  test('on Linux and macOS a colon or a tilde in a name is an ordinary name', () => {
    for (const platform of ['linux', 'darwin']) {
      expect(windowsPathShapeRefusal('/home/op/notes::$DATA', platform)).toBeNull();
      expect(windowsPathShapeRefusal('/home/op/file~1.txt', platform)).toBeNull();
    }
    expect(platformWallWriteReason('/tmp/neuma-shape-proof/a:b~1.txt', [], 'linux')).toBeNull();
  });
});
