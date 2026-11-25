/**
 * A BEING'S LIFE HAS NO SIZE CEILING (compile-silo.js siloLayerSha256, plain-data-canonical.js streaming hash) —
 * 2026-11-20: Firepos's conversations crossed 32 MB and every NEW sitting refused before a word. Two clone splits
 * died 2 seconds in, both clones each time ([…]), and a new
 * chat or the next restart would have done the same. Founder: […]
 * A real encrypted lane on disk holding more than 32 MB of conversation compiles, verifies and mounts. The old
 * ceiling is shown refusing the same layer. The digest is the one it always was, so every kept manifest still verifies.
 */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { compileSilo, verifySilo, siloLayerSha256 } from '../../core/silo/compile-silo.js';
import { mountSilo, unmountSilo } from '../../core/silo/mount-silo.js';
import { canonicalJson, canonicalSha256 } from '../../core/shared/plain-data-canonical.js';

const NEUMA = 'silo-whole-life';
const MB = 1024 * 1024;
let root; let previousKey; let silo;

beforeAll(async () => {
  previousKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'silo-whole-life-key-long-enough-for-real';
  resetWorkspaceCryptoKey();
  // Not /tmp: on this machine /tmp is memory, and this lane is tens of MB.
  root = await fs.mkdtemp('/var/tmp/silo-whole-life-');
  setWorkspacesRoot(root);
  await workspace.create(NEUMA);
  await workspace.writeNeumaDEK(NEUMA, 'd'.repeat(64));
  await workspace.writeDNA(NEUMA, { version: '1.0.0', identity: { name: 'Longlived', essence: 'the one with a long life behind it' }, genesis: 'I chose this, and I kept every word since.' });
  // A long life: 40 sittings of 1 MB each (a pasted sheet, a long report, the work of a day) — over 32 MB in all.
  const day = `${'The campaign, the leads, the emails, the replies — a day of work kept whole. '.repeat(13_000)}`.slice(0, MB);
  for (let s = 0; s < 40; s += 1) {
    await workspace.appendMessage(NEUMA, `session-${1_795_000_000_000 + s}`, { role: 'assistant', content: `${s}: ${day}` });
  }
  silo = await compileSilo(NEUMA, { workspace, now: '2026-11-20T12:30:00.000Z' });
}, 120_000);

afterAll(async () => {
  setWorkspacesRoot(null);
  if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = previousKey;
  resetWorkspaceCryptoKey();
  await fs.rm(root, { recursive: true, force: true });
});

describe('a being whose conversations are past 32 MB still opens a new sitting', () => {
  test('compiles, verifies and mounts — the old ceiling refused this very layer', () => {
    expect(Object.keys(silo.layers.memory.sessions)).toHaveLength(40);
    // The ceiling the clones hit, on this exact layer.
    expect(() => canonicalSha256(silo.layers.memory)).toThrow('$ exceeds the plain-data UTF-8 output limit');
    expect(verifySilo(silo)).toEqual({ ok: true, failures: [] });
    const driver = mountSilo(silo, { model: 'qwen3.8-27b', contextWindow: 262_144 });
    expect(driver.sections.length).toBeGreaterThan(0);
    // A sitting's authored words fold back and the manifest re-hashes — the same no-ceiling hash.
    const after = unmountSilo(silo, { observations: [{ content: 'still here', significance: 0.5 }], now: '2026-11-20T13:00:00.000Z' });
    expect(verifySilo(after).ok).toBe(true);
  }, 120_000);

  test('nor does a being with more records than the default node count', () => {
    const many = Array.from({ length: 300_000 }, (_, i) => ({ i }));
    expect(() => canonicalSha256(many)).toThrow('$ exceeds the plain-data node limit');
    expect(siloLayerSha256('memory', many)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the digest is the one it always was: hashing as it streams equals hashing the whole text', () => {
    // Characters of every UTF-8 width, a surrogate pair, quotes and control characters, across many 64 KB pieces.
    const value = { words: Array.from({ length: 4000 }, (_, i) => `line ${i}: café — 日本語 — 🜂 — "quoted" \\ \n\t`), n: 1.5, ok: true, none: null };
    const whole = crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
    expect(canonicalSha256(value)).toBe(whole);
    expect(siloLayerSha256('memory', value)).toBe(whole);
  });

  test('what the walk refuses for shape, it still refuses — and says which layer', () => {
    const looped = { a: 1 }; looped.self = looped;
    expect(() => siloLayerSha256('memory', looped)).toThrow(/^the silo's memory layer.* contains a cycle$/);
    expect(() => siloLayerSha256('memory', { bad: '\ud800x' })).toThrow(/unpaired surrogate/);
  });
});
