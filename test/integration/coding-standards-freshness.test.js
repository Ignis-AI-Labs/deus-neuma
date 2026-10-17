/** Real checkout files and on-disk freshness receipts; no mocks, timers or provider substitutes. */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BUNDLE_ROOT, readStandardsBundle } from '../../backend/services/coding-standards/bundle.js';
import { checkStandardsFreshness, formatFreshness, CHECK_INTERVAL_MS } from '../../backend/services/coding-standards/freshness.js';

let root;
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'policy-freshness-')); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

const setup = async () => {
  const sourceRoot = await fs.mkdtemp(path.join(root, 'source-'));
  await fs.mkdir(path.join(sourceRoot, 'standards'));
  await fs.copyFile(path.join(BUNDLE_ROOT, 'source-manifest.json'), path.join(sourceRoot, 'standards.json'));
  const { manifest } = await readStandardsBundle();
  for (const name of Object.keys(manifest.files)) {
    await fs.copyFile(path.join(BUNDLE_ROOT, `${name}.md`), path.join(sourceRoot, 'standards', `${name}.md`));
  }
  return { sourceRoot, receiptPath: path.join(sourceRoot, 'receipt.json') };
};

const amend = async (sourceRoot) => fs.appendFile(path.join(sourceRoot, 'standards', 'BRANCHING.md'), '\nAdditional operator branch protocol.\n');

describe('weekly source freshness', () => {
  test('writes an accurate receipt and reuses it without rereading source documents', async () => {
    const options = await setup();
    const first = await checkStandardsFreshness(options);
    expect(first.status).toBe('current');
    expect(first.cached).toBe(false);
    const before = await fs.readFile(options.receiptPath, 'utf8');
    // A valid receipt is a dated observation. This missing file proves reuse performs no upstream policy reload.
    await fs.unlink(path.join(options.sourceRoot, 'standards', 'POLICY.md'));
    const again = await checkStandardsFreshness(options);
    expect(again.cached).toBe(true);
    expect(again.checkedAt).toBe(first.checkedAt);
    expect(formatFreshness(again)).toContain('Last checked');
    expect(await fs.readFile(options.receiptPath, 'utf8')).toBe(before);
    await expect(checkStandardsFreshness({ ...options, force: true })).rejects.toThrow();
    expect(await fs.readFile(options.receiptPath, 'utf8')).toBe(before);
  });

  test('forced check detects a change without a version bump and never imports it', async () => {
    const options = await setup();
    await checkStandardsFreshness(options);
    const before = await fs.readFile(path.join(BUNDLE_ROOT, 'BRANCHING.md'), 'utf8');
    await amend(options.sourceRoot);
    const report = await checkStandardsFreshness({ ...options, force: true });
    expect(report.status).toBe('review_needed');
    expect(report.upstreamVersion).toBe(report.installedVersion);
    expect(report.changedStandards).toEqual(['BRANCHING']);
    expect(report.routingChanged).toBe(false);
    expect(await fs.readFile(path.join(BUNDLE_ROOT, 'BRANCHING.md'), 'utf8')).toBe(before);
    expect(formatFreshness(report)).toContain('BRANCHING');
    expect(formatFreshness(report)).not.toContain('Additional operator branch protocol');
    const cached = await checkStandardsFreshness(options);
    expect(cached.status).toBe('review_needed');
    expect(cached.cached).toBe(true);
  });

  test('expired receipt triggers a fresh comparison', async () => {
    const options = await setup();
    const previous = await checkStandardsFreshness(options);
    await fs.writeFile(options.receiptPath, JSON.stringify({ ...previous,
      checkedAt: new Date(Date.now() - CHECK_INTERVAL_MS - 1000).toISOString() }));
    await amend(options.sourceRoot);
    const report = await checkStandardsFreshness(options);
    expect(report.status).toBe('review_needed');
    expect(report.cached).toBe(false);
  });

  test('torn and future-dated receipts cause a real recheck', async () => {
    const options = await setup();
    await fs.writeFile(options.receiptPath, '{broken');
    const first = await checkStandardsFreshness(options);
    expect(first.cached).toBe(false);
    await fs.writeFile(options.receiptPath, JSON.stringify({ ...first,
      checkedAt: new Date(Date.now() + CHECK_INTERVAL_MS).toISOString() }));
    expect((await checkStandardsFreshness(options)).cached).toBe(false);
  });

  test('different source path or installed digest cannot reuse a success receipt', async () => {
    const options = await setup();
    const first = await checkStandardsFreshness(options);
    await fs.writeFile(options.receiptPath, JSON.stringify({ ...first, installedDigest: '0'.repeat(64) }));
    expect((await checkStandardsFreshness(options)).cached).toBe(false);
    const second = await setup();
    await amend(second.sourceRoot);
    const report = await checkStandardsFreshness({ ...options, sourceRoot: second.sourceRoot });
    expect(report.status).toBe('review_needed');
    expect(report.cached).toBe(false);
  });

  test('routing changes are reported separately from unchanged policy bytes', async () => {
    const options = await setup();
    const file = path.join(options.sourceRoot, 'standards.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    manifest.core.reverse();
    await fs.writeFile(file, JSON.stringify(manifest));
    const report = await checkStandardsFreshness(options);
    expect(report.routingChanged).toBe(true);
    expect(report.changedStandards).toEqual([]);
    expect(report.status).toBe('review_needed');
  });

  test('missing source is unavailable, never a newly cached success', async () => {
    const receiptPath = path.join(root, 'missing-receipt.json');
    await expect(checkStandardsFreshness({ sourceRoot: path.join(root, 'missing-source'), receiptPath })).rejects.toThrow();
    await expect(fs.stat(receiptPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
