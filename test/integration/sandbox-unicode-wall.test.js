/**
 * A WALLED NAME IN ANOTHER UNICODE FORM OR CASE IS STILL THE WALL (#587).
 * REAL native filesystem organ, REAL sandbox, REAL kernel lookups, NO mock.
 *
 * On a case-insensitive, normalization-insensitive volume (macOS APFS/HFS+,
 * ext4 or tmpfs with casefold) `é` composed and `e` + U+0301 decomposed name one
 * directory, and `HOUſE-MANDATE.JSON` opens house-mandate.json — the long s
 * case-folds to "s", which a plain toLowerCase never does. The walls compared
 * strings, so those spellings walked past them onto the walled file itself.
 *
 * The disk half runs in a user + mount namespace over a casefold tmpfs (the
 * driver: test/helpers/casefold-wall-driver.mjs) so the lookups are the
 * kernel's own. Where this kernel cannot mount one, the disk half says so and
 * skips; the matcher half below needs no volume and always runs.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';
import { laneStateWriteReason } from '../../backend/services/sandbox-path-policy.js';
import { platformWallWriteReason } from '../../backend/services/platform-write-walls.js';
import { checkToolArgs } from '../../backend/services/rogue-detector.js';

const DRIVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'casefold-wall-driver.mjs');
const NFC = 'r\u00e9'; // é composed
const NFD = 're\u0301'; // e + combining acute
const LONG_S = '\u017f'; // LATIN SMALL LETTER LONG S
const MOUNT = 'mount -t tmpfs -o casefold=utf8-12.1.0 none "$1" && mkdir "$1/vol" && chattr +F "$1/vol"';

// impure — can this kernel give an unprivileged process a casefold volume?
const casefoldVolume = () => {
  const probe = spawnSync('unshare', ['-rm', 'sh', '-c', `${MOUNT} && touch "$1/vol/a" && test -e "$1/vol/A"`, 'sh', '/tmp'], { encoding: 'utf8' });
  return probe.status === 0;
};

describe('the walls on a real case- and normalization-insensitive volume', () => {
  const available = casefoldVolume();
  let results = [];

  beforeAll(async () => {
    if (!available) return;
    const mnt = await createTempDir('casefold-wall');
    const vol = path.join(mnt, 'vol');
    const top = path.join(vol, NFC);
    const env = {
      ...process.env,
      HOME: path.join(top, 'home'),
      NEUMA_DATA_ROOT: path.join(top, 'data'),
      NEUMA_REALM_ROOT: path.join(top, 'realm'),
      WORKSPACES_ROOT: path.join(top, 'house'),
      WITNESSES_ROOT: path.join(top, 'witnesses'),
      HARNESS_ROOT: path.join(top, 'harness'),
    };
    const run = spawnSync('unshare', ['-rm', 'sh', '-c', `${MOUNT} && cd "$1/vol" && exec "$2" "$3" "$1/vol"`, 'sh', mnt, process.execPath, DRIVER],
      { encoding: 'utf8', env, timeout: 60_000 });
    const line = run.stdout.trim().split('\n').pop() || '';
    const parsed = JSON.parse(line || '{"error":"no output"}');
    if (!Array.isArray(parsed)) throw new Error(`casefold driver failed: ${parsed.error}\n${run.stderr}`);
    results = parsed;
    await fs.rm(mnt, { recursive: true, force: true });
  }, 90_000);

  test.skipIf(!available)('every respelled walled file is refused and keeps its bytes', () => {
    expect(results.length).toBe(9);
    for (const r of results) {
      expect(r.sameString, r.name).toBe(false);
      expect(r.refused, `${r.name}: ${r.asked} was written`).toBeTruthy();
      expect(r.refused, r.name).not.toMatch(/^organ:/);
      expect(r.bytes, r.name).toBe('ORIGINAL');
    }
  });
});

describe('the matcher folds every spelling before it compares (pure)', () => {
  const home = '/w/home/op';
  const walls = [
    { path: `/w/${NFC}alm`, reason: 'realm' },
    { path: path.join(home, '.ssh'), reason: 'ssh' },
    { path: '/w/data/settings', reason: 'settings' },
  ];

  test('NFD and NFC name the same wall', () => {
    expect(platformWallWriteReason(`/w/${NFD}alm/0xabc/house-mandate.json`, walls)).toBe('realm');
    expect(platformWallWriteReason(`/w/${NFC}alm/0xabc/house-mandate.json`, walls)).toBe('realm');
    expect(laneStateWriteReason(`/h/${NFD}/lane/config/x.json`, { lanes: [`/h/${NFC}/lane`], walls: [] })).not.toBeNull();
    expect(laneStateWriteReason(`/h/${NFC}/lane/config/x.json`, { grounds: [`/h/${NFD}`], walls: [] })).not.toBeNull();
  });

  test('full case folding: the long s is an s, sharp s is ss', () => {
    expect(platformWallWriteReason(path.join(home, `.${LONG_S}${LONG_S}h`, 'authorized_keys'), walls)).toBe('ssh');
    expect(platformWallWriteReason(`/w/data/${LONG_S}ettings/x.json`, walls)).toBe('settings');
    expect(platformWallWriteReason(path.join(home, '.\u00dfh', 'authorized_keys'), walls)).toBe('ssh');
    expect(laneStateWriteReason(`/h/lane/voice/${LONG_S}eal.json`, { lanes: ['/h/lane'], walls: [] })).not.toBeNull();
    expect(laneStateWriteReason(`/h/lane/lane.j${LONG_S}on`, { lanes: ['/h/lane'], walls: [] })).not.toBeNull();
  });

  test('the rogue detector reads the mandate and the policy file in every form', () => {
    for (const p of [`notes/../HOU${LONG_S}E-MANDATE.JSON`, `x/config/tool-policy.j${LONG_S}on`, `x/CONFIG/TOOL-POLICY.JSON`]) {
      expect(checkToolArgs('filesystem', 'write_file', { path: p, content: '{}' }).safe, p).toBe(false);
    }
  });

  test('near misses stay ordinary work', () => {
    expect(platformWallWriteReason(`/w/${NFC}alms/x.md`, walls)).toBeNull();
    expect(platformWallWriteReason('/w/data/settings2/x.json', walls)).toBeNull();
    expect(laneStateWriteReason('/h/lane/voice/take-1.wav', { lanes: ['/h/lane'], walls: [] })).toBeNull();
  });
});
