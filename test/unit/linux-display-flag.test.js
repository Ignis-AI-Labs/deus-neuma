// Every Linux launch path keeps the desk on X11 / XWayland. Electron 44 fixes
// the display platform before main runs, so the flag must ride the launch
// itself; these read the real config and launcher sources (no mocks).
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { menuEntry } from '../../scripts/linux-menu-entry.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { LINUX_DISPLAY_FLAG } = createRequire(import.meta.url)('../../electron/display-flags.cjs');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// The sitting scripts that boot the real desk on the operator's screen.
const SITTINGS = [
  'council-sitting.mjs', 'council-two-houses-sitting.mjs', 'house-attune-electron.mjs', 'house-founding-sitting.mjs',
  'house-refine-watch.mjs', 'self-seal-sitting.mjs', 'sovereign-refine-sitting.mjs',
];

describe('the Linux display flag rides every launch path', () => {
  test('the flag is the X11 ozone platform', () => {
    expect(LINUX_DISPLAY_FLAG).toBe('--ozone-platform=x11');
  });

  test('the packaged desktop entry carries it, and keeps electron-builder\'s own --no-sandbox', () => {
    const config = yaml.load(read('electron-builder.yml'));
    expect(config.linux.executableArgs).toEqual(['--no-sandbox', LINUX_DISPLAY_FLAG]);
  });

  test('the rpm and deb menu entry starts neuma with it', () => {
    expect(menuEntry('d').split('\n')).toContain(`Exec=neuma ${LINUX_DISPLAY_FLAG} %U`);
    for (const script of ['scripts/build-rpm.mjs', 'scripts/build-deb.mjs']) {
      expect(read(script)).toContain('const desktop = menuEntry(pkg.description);');
    }
  });

  test('electron:dev passes it to the app', () => {
    const { scripts } = JSON.parse(read('package.json'));
    expect(scripts['electron:dev'].endsWith(`electron . ${LINUX_DISPLAY_FLAG}`)).toBe(true);
  });

  test.each(SITTINGS)('%s launches the desk with it', (script) => {
    expect(read(path.join('scripts', script))).toContain('`--user-data-dir=${userDataDir}`, displayFlags.LINUX_DISPLAY_FLAG]');
  });
});
