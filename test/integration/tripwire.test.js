/**
 * The decoy tripwire, end to end on the real machine (RULE 0): real files
 * under a scratch home, the real inotifywait and the real atime eye, real
 * child processes that read a decoy, a real SIGSTOP read back from /proc,
 * and a real threat ledger on disk. Nothing stands in for anything.
 *
 * Linux only — the watch is Linux only. The scratch home lives under
 * /var/tmp (a disk filesystem that records access times), never the
 * operator's real home.
 *
 * NOT proven here: the operator card a new critical raises (the routes suite
 * drives the real filing path), and a reader that is not a child of this
 * process (its standing is proven pure in tripwire-findings.test.js).
 */
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { createTripwire } from '../../backend/services/security/tripwire/tripwire.js';
import { findInotifywait } from '../../backend/services/security/tripwire/decoy-watch.js';
import { createThreatLedger } from '../../backend/services/security/threat-ledger.js';

const linux = process.platform === 'linux';
const inotifywait = linux ? await findInotifywait() : null;

const procState = async (pid) => {
  const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2)[0];
};
const until = async (check, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('condition never held');
};
const exited = (child) => new Promise((resolve) => child.on('exit', resolve));

describe.skipIf(!linux)('decoy tripwire', () => {
  let root, home, ledger, wire;
  const children = [];
  const make = (opts = {}) => createTripwire({
    statePath: path.join(root, 'tripwire.json'), home, pollMs: 100, windowMs: 400,
    file: (finding) => ledger.ingest([finding]), ...opts,
  });
  const fileOf = async (id) => (await wire.status()).decoys.find((d) => d.id === id).files[0];

  beforeEach(async () => {
    root = await fs.mkdtemp('/var/tmp/neuma-tripwire-');
    home = path.join(root, 'home');
    await fs.mkdir(home);
    ledger = createThreatLedger({ path: path.join(root, 'threats.json') });
  });

  afterEach(async () => {
    await wire?.setEnabled(false).catch(() => {});
    for (const child of children.splice(0)) {
      try { process.kill(child.pid, 'SIGCONT'); } catch { /* already gone */ }
      child.kill('SIGKILL');
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  test('off by default; turned on, it plants every decoy and never touches a real app folder', async () => {
    await fs.mkdir(path.join(home, '.aws'));
    await fs.writeFile(path.join(home, '.aws', 'config'), '[default]\nregion = eu-west-1\n');
    wire = make();
    await wire.start();
    expect((await wire.status()).enabled).toBe(false);
    expect(await fs.readdir(home)).toEqual(['.aws']);

    await wire.setEnabled(true);
    const status = await wire.status();
    expect(status.enabled).toBe(true);
    expect(status.mode).toBe(inotifywait ? 'inotify' : 'atime');
    const byId = Object.fromEntries(status.decoys.map((d) => [d.id, d]));
    expect(byId.aws.status).toBe('skipped');
    expect(await fs.readdir(path.join(home, '.aws'))).toEqual(['config']);
    for (const id of ['solana', 'ethereum', 'electrum', 'exodus', 'bitcoin']) {
      expect(byId[id].status).toBe('planted');
      for (const file of byId[id].files) {
        const stat = await fs.stat(file);
        expect(stat.mode & 0o777).toBe(0o600);
        // Armed: the access time stands before the modify time, and the file looks old.
        expect(stat.atimeMs).toBeLessThan(stat.mtimeMs);
        expect(Date.now() - stat.mtimeMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
      }
    }
    // Reading a decoy is a hit, this test's own read included: the watch stands down first.
    wire.stop();
    expect(JSON.parse(await fs.readFile(path.join(home, '.config/solana/id.json'), 'utf8'))).toHaveLength(64);
  });

  test.skipIf(!inotifywait)('a program holding a decoy open is named, frozen, filed, and released on the operator\'s word', async () => {
    wire = make();
    await wire.setEnabled(true);
    const decoy = await fileOf('bitcoin');
    const reader = spawn('/usr/bin/tail', ['-f', decoy], { stdio: 'ignore' });
    children.push(reader);

    const entry = await until(async () => (await ledger.load())[0]);
    expect(entry.source).toBe('tripwire');
    expect(entry.severity).toBe('critical');
    expect(entry.title).toBe('A decoy wallet file was opened: Bitcoin wallet');
    expect(entry.summary).toContain(`(pid ${reader.pid})`);
    expect(entry.summary).toContain('tail');
    expect(entry.summary).toContain('**frozen**');
    expect(await procState(reader.pid)).toBe('T');

    const status = await wire.status();
    expect(status.frozen.map((f) => f.pid)).toEqual([reader.pid]);
    expect(status.lastIncident.title).toBe(entry.title);

    expect(await wire.release(reader.pid)).toBe(true);
    expect(await procState(reader.pid)).not.toBe('T');
    expect((await wire.status()).frozen).toEqual([]);
    expect(await wire.release(reader.pid)).toBe(false);
  });

  test.skipIf(!inotifywait)('a fast sweep is seen as one incident even when the reader is gone', async () => {
    wire = make();
    await wire.setEnabled(true);
    const files = [await fileOf('solana'), await fileOf('electrum'), await fileOf('ethereum')];
    const reader = spawn('/usr/bin/cat', files, { stdio: 'ignore' });
    await exited(reader);

    const entry = await until(async () => (await ledger.load())[0]);
    await wire.settled();
    expect(await ledger.load()).toHaveLength(1);
    expect(entry.title).toBe('3 decoy wallet files were opened in one sweep: Solana key, Electrum wallet, Ethereum keystore');
    expect(entry.severity).toBe('critical');
  });

  test('without inotifywait the access-time eye sees the read', async () => {
    wire = make({ inotifywait: null });
    await wire.setEnabled(true);
    expect((await wire.status()).mode).toBe('atime');
    const reader = spawn('/usr/bin/cat', [await fileOf('solana')], { stdio: 'ignore' });
    await exited(reader);

    const entry = await until(async () => (await ledger.load())[0]);
    expect(entry.title).toBe('A decoy wallet file was opened: Solana key');
    expect(entry.summary).toContain('The reader was not caught');
  });

  test('a deleted decoy is reported and planted again', async () => {
    wire = make();
    await wire.setEnabled(true);
    const decoy = await fileOf('solana');
    await fs.rm(decoy);

    const entry = await until(async () => (await ledger.load())[0]);
    expect(entry.title).toBe('A decoy wallet file was removed: Solana key');
    expect(entry.severity).toBe('high');
    await until(() => fs.stat(decoy).then(() => true, () => false));
  });

  test('a real app moving into a decoy folder retires the decoy and keeps the app\'s files', async () => {
    wire = make();
    await wire.setEnabled(true);
    const decoy = await fileOf('electrum');
    const mine = path.join(home, '.electrum', 'config');
    await fs.writeFile(mine, '{}');
    wire.stop();

    wire = make();
    await wire.start();
    const electrum = (await wire.status()).decoys.find((d) => d.id === 'electrum');
    expect(electrum.status).toBe('retired');
    expect(await fs.stat(decoy).then(() => true, () => false)).toBe(false);
    expect(await fs.readFile(mine, 'utf8')).toBe('{}');
  });

  test('turned off, every decoy and every folder it made is gone', async () => {
    await fs.mkdir(path.join(home, '.config', 'keep'), { recursive: true });
    wire = make();
    await wire.setEnabled(true);
    await wire.setEnabled(false);
    expect(await fs.readdir(home)).toEqual(['.config']);
    expect(await fs.readdir(path.join(home, '.config'))).toEqual(['keep']);
    const status = await wire.status();
    expect(status.enabled).toBe(false);
    expect(status.decoys.every((d) => d.status === 'none')).toBe(true);
  });
});
