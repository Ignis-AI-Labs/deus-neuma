/**
 * The hard-link law knows every folder a secret may stand in that a being
 * can reach — not only the organ's own roots: a live connection's FOCUS
 * GROUND and a GRANTED root, each a checkout of its own nested inside an
 * opened folder that is not one (so neither the opened folder's one-level
 * read nor its git listing sees the nested secrets). The registries are the
 * platform's own: filesystem-focus-owners.js (live focus owners) and
 * filesystem-granted-roots.js (the organ's granted roots).
 *
 * Each case first shows the twin READS while its checkout is unknown — the
 * exposure — then that it is refused once the focus or grant stands.
 * REAL organ, sandbox, git, hard links. No mock.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { standHouse, plant, hardlink, marker, textOf } from '../helpers/secret-hardlink-kit.js';
import { setRoots } from '../../backend/services/user-files.js';
import { trackFilesystemFocus } from '../../backend/services/filesystem-focus-owners.js';
import { filesystemGrantedRoots } from '../../backend/services/filesystem-granted-roots.js';

// impure — a nested checkout holding an ignored env file deep down and a key under keys/.
const checkout = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  await fs.writeFile(path.join(dir, '.gitignore'), '.env*\n');
  const env = { mark: marker('deepEnv') };
  env.file = await plant(path.join(dir, 'services', 'api', 'config', '.env'), `API_TOKEN=${env.mark}\n`);
  const key = { mark: marker('nestedKey') };
  key.file = await plant(path.join(dir, 'tools', 'keys', 'signer.json'), `{"seed":"${key.mark}"}\n`);
  return { env, key };
};

describe('a twin of a secret in a focus ground or a granted root is refused', () => {
  let house;
  let opened;
  const connection = { toolWorkspace: null, ws: { readyState: 1 } };

  beforeAll(async () => {
    house = await standHouse('secret-hardlink-reach', 'hardlinkreach');
    opened = path.join(house.roots.tmp, 'opened');
    await fs.mkdir(opened, { recursive: true });
    setRoots([opened]);
  });

  afterAll(async () => {
    connection.ws.readyState = 3;
    filesystemGrantedRoots.clear();
    setRoots([]);
    await house.restore();
  });

  const twinsOf = async (secrets, tag) => Promise.all(Object.values(secrets).map(async (s, i) => ({
    ...s, twin: await hardlink(s.file, path.join(house.lane, 'files', tag, `notes-${i}.txt`)),
  })));

  test('a live connection\'s focus ground', async () => {
    const ground = path.join(opened, 'focused-repo');
    const twins = await twinsOf(await checkout(ground), 'focus');
    for (const t of twins) expect(textOf(await house.call('fs', 'read', { path: t.twin }))).toContain(t.mark);
    connection.toolWorkspace = ground;
    trackFilesystemFocus(connection);
    for (const t of twins) await expect(house.call('fs', 'read', { path: t.twin }), t.file).rejects.toThrow(/hard link/i);
  });

  test('a granted read or write root', async () => {
    const granted = path.join(opened, 'granted-repo');
    const twins = await twinsOf(await checkout(granted), 'grant');
    for (const t of twins) expect(textOf(await house.call('fs', 'read', { path: t.twin }))).toContain(t.mark);
    filesystemGrantedRoots.add(granted);
    for (const t of twins) await expect(house.call('fs', 'read', { path: t.twin }), t.file).rejects.toThrow(/hard link/i);
  });
});
