/** Actual disposable Git repositories; no command replacement or live clones. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { fixtureGit, commitFixture } from '../helpers/harness-git-kit.js';
import { syncAlgorithmRepos } from '../../scripts/x-algorithm-sync.mjs';

const oldStamp = '{"syncedAt":"2026-01-01T00:00:00.000Z"}\n';
describe('algorithm sync preserves Git work and truthful recency', () => {
  let root, origin, ground, stampPath;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'algorithm-sync-'));
    origin = path.join(root, 'origin'); ground = path.join(root, 'ground');
    stampPath = path.join(root, 'stamp.json');
    await fs.mkdir(origin);
    await fixtureGit(origin, ['init', '--quiet', '--initial-branch=dev']);
    await commitFixture(origin, 'base.txt', 'base\n');
    await fixtureGit(root, ['clone', '--quiet', origin, ground]);
    await fs.writeFile(stampPath, oldStamp);
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const sync = () => syncAlgorithmRepos({ repos: { ranking: ground }, stampPath });
  const refused = async () => {
    const before = await fixtureGit(ground, ['rev-parse', 'HEAD']);
    const result = await sync();
    expect(result.ok).toBe(false);
    expect(result.ranking.error).toBeTruthy();
    expect(await fs.readFile(stampPath, 'utf8')).toBe(oldStamp);
    expect(await fixtureGit(ground, ['rev-parse', 'HEAD'])).toBe(before);
  };
  it('fast-forwards a clean dev clone and stamps its actual full HEAD', async () => {
    const head = await commitFixture(origin, 'next.txt', 'next\n');
    const result = await sync();
    expect(result).toMatchObject({ ok: true, ranking: { head, changed: true } });
    expect(JSON.parse(await fs.readFile(stampPath, 'utf8'))).toMatchObject({ ranking: { head } });
    expect(await fs.readFile(path.join(ground, 'next.txt'), 'utf8')).toBe('next\n');
  });
  it('preserves the old stamp when the remote cannot be fetched', async () => {
    await fs.rename(origin, path.join(root, 'unavailable'));
    await refused();
  });
  it('preserves dirty files and refuses integration', async () => {
    await fs.writeFile(path.join(ground, 'base.txt'), 'operator edits\n');
    await refused();
    expect(await fs.readFile(path.join(ground, 'base.txt'), 'utf8')).toBe('operator edits\n');
  });
  it('refuses unpublished local commits', async () => {
    await commitFixture(ground, 'private.txt', 'unpublished\n');
    await refused();
  });
  it('refuses another branch even when clean', async () => {
    await fixtureGit(ground, ['switch', '-c', 'personal']);
    await refused();
  });
  it('refuses rewritten remote history rather than merging it', async () => {
    await fixtureGit(origin, ['checkout', '--orphan', 'replacement']);
    await fixtureGit(origin, ['rm', '-rf', '.']);
    await commitFixture(origin, 'replacement.txt', 'different root\n');
    await fixtureGit(origin, ['branch', '-f', 'dev', 'HEAD']);
    await refused();
  });
});
