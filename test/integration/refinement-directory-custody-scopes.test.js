/**
 * Directory custody across sequential scopes and across a real rename — REAL
 * pinned directories on real disk, no mock, stub, or spy anywhere (RULE 0).
 *
 * Two defects lived here undetected because nothing in the tree had ever
 * opened a third directory scope on one owner, nor driven a rename CAS to
 * completion: `leave` decremented the cursor without dropping the closed
 * entry, and both post-rename CAS checks compared a pre-rename observation
 * against a post-rename one, which a ctime bump makes impossible to satisfy.
 *
 * The root is created under the operator's home rather than the shared temp
 * dir: pinDirectoryCustody pins every ancestor and refuses a world-writable
 * one, and /tmp is 1777. Production's house root has the same protected chain.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  pinDirectoryCustody,
  syncDirectoryCustody,
} from '../../backend/services/refinement-directory-custody.js';

const STAT_FIELDS = Object.freeze([
  'dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink', 'mtimeNs', 'ctimeNs',
]);

describe('refinement directory custody — sequential scopes and renames', () => {
  let root;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.homedir(), '.neuma-test-custody-'));
    await fs.chmod(root, 0o700);
  });

  afterEach(async () => {
    await fs.chmod(root, 0o700).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });

  it('re-enters after two balanced scopes — held stays a stack, not a graveyard', async () => {
    await fs.mkdir(path.join(root, 'alpha'), { mode: 0o700 });
    await fs.mkdir(path.join(root, 'beta'), { mode: 0o700 });
    await fs.writeFile(path.join(root, 'alpha', 'alpha.marker'), 'a', { mode: 0o600 });
    await fs.writeFile(path.join(root, 'beta', 'beta.marker'), 'b', { mode: 0o600 });
    const owner = await pinDirectoryCustody(root, 'scope custody');
    const namesHere = async () => (await owner.list({
      maximumEntries: 8, maximumNameBytes: 1024,
    })).entries.map(({ name }) => name);
    try {
      // Two balanced scopes used to park the cursor on a closed entry, so the
      // third enter refused. Three is the shape every real refinement flow has.
      // The markers make it an assertion about WHICH directory the cursor is
      // on, not merely that enter did not throw.
      await owner.enter({ name: 'alpha', mode: 0o700, label: 'alpha' });
      expect(await namesHere()).toEqual(['alpha.marker']);
      await owner.leave();
      await owner.enter({ name: 'beta', mode: 0o700, label: 'beta' });
      expect(await namesHere()).toEqual(['beta.marker']);
      await owner.leave();
      await owner.enter({ name: 'alpha', mode: 0o700, label: 'alpha' });
      expect(await namesHere()).toEqual(['alpha.marker']);
      await owner.leave();
      await owner.enter({ name: 'beta', mode: 0o700, label: 'beta' });
      expect(await namesHere()).toEqual(['beta.marker']);
      await owner.leave();
      expect((await namesHere()).sort()).toEqual(['alpha', 'beta']);
    } finally {
      await owner.close();
    }
  });

  it('publishes a sealed directory across a rename that moves ctime alone', async () => {
    // The measurement the CAS is built on: rename preserves every identity
    // field except ctime, which it must change — so a pre-rename stat is never
    // comparable to a post-rename one and the check re-observes the descriptor.
    const moved = path.join(root, 'moved');
    await fs.mkdir(path.join(root, 'probe'), { mode: 0o700 });
    const before = await fs.lstat(path.join(root, 'probe'), { bigint: true });
    await fs.rename(path.join(root, 'probe'), moved);
    const after = await fs.lstat(moved, { bigint: true });
    expect(STAT_FIELDS.filter((field) => before[field] !== after[field])).toEqual(['ctimeNs']);
    await fs.rm(moved, { recursive: true, force: true });

    await fs.mkdir(path.join(root, 'staged'), { mode: 0o700 });
    await fs.writeFile(path.join(root, 'staged', 'artifact.bin'), 'sealed bytes', { mode: 0o400 });
    await fs.chmod(path.join(root, 'staged'), 0o500);
    const owner = await pinDirectoryCustody(root, 'publish custody');
    try {
      expect(await owner.publishDirectory({ sourceName: 'staged', targetName: 'published' }))
        .toBe(true);
    } finally {
      await owner.close();
    }
    expect(await fs.readFile(path.join(root, 'published', 'artifact.bin'), 'utf8'))
      .toBe('sealed bytes');
    await expect(fs.lstat(path.join(root, 'staged'))).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.chmod(path.join(root, 'published'), 0o700);
  });

  it('refuses to publish a directory that was never sealed', async () => {
    await fs.mkdir(path.join(root, 'unsealed'), { mode: 0o700 });
    const owner = await pinDirectoryCustody(root, 'publish custody');
    try {
      await expect(owner.publishDirectory({ sourceName: 'unsealed', targetName: 'published' }))
        .rejects.toThrow(/staged directory is not sealed/);
    } finally {
      await owner.close();
    }
    expect((await fs.lstat(path.join(root, 'unsealed'))).isDirectory()).toBe(true);
  });

  it('holds a pinned chain through unrelated activity in a shared ancestor', async () => {
    // The invariant a pinned chain MUST hold in production: the store sits under
    // a directory other processes write to all day (~/.neuma/data, or /tmp for a
    // temp store). Verifying an ancestor by full identity — nlink/mtime/ctime
    // included — meant ONE unrelated mkdtemp beside it refused every later
    // operation on the chain, permanently, because ctime only moves forward.
    // This is invisible in isolation and only appears when anything else moves,
    // which is why it survived review. Custody is dev/ino/mode/uid/gid.
    const store = path.join(root, 'store');
    await fs.mkdir(store, { mode: 0o700 });
    const owner = await pinDirectoryCustody(store, 'ancestor custody');
    try {
      await expect(syncDirectoryCustody(owner)).resolves.toBe(true);
      const unrelated = await fs.mkdtemp(path.join(root, 'someone-else-'));
      await expect(syncDirectoryCustody(owner)).resolves.toBe(true);
      await fs.rm(unrelated, { recursive: true, force: true });
      await expect(syncDirectoryCustody(owner)).resolves.toBe(true);
      // A REAL custody violation on that same ancestor is still refused.
      await fs.chmod(root, 0o755);
      await expect(syncDirectoryCustody(owner))
        .rejects.toThrow(/held directory identity changed/);
    } finally {
      await fs.chmod(root, 0o700).catch(() => {});
      await owner.close();
    }
  });
});
