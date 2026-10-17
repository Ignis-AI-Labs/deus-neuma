/**
 * Invariant: the no-algorithm floor (K:no_platform_ranking / K:no_paid_rank).
 *
 * The town square's core promise — feeds are strict reverse-chronological and
 * engagement can never reorder them — exercised against the REAL social service
 * and storage (no mocks). If this fails, the floor in
 * docs/reference/neuma-invariants.yaml has eroded.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSocialService } from '../../backend/services/social-service.js';
import { createFileStorage } from '../../backend/services/social-storage.js';
import { createTempDir } from '../helpers/temp-fs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const A = '0xa111111111111111111111111111111111111111';
const RESONATORS = [
  '0xb222222222222222222222222222222222222222',
  '0xc333333333333333333333333333333333333333',
  '0xd444444444444444444444444444444444444444',
];

describe('Invariant: no-algorithm floor', () => {
  let service;

  beforeAll(async () => {
    const dir = await createTempDir('invariant-floor');
    const storage = createFileStorage(dir);
    await storage.ensureDirs();
    service = createSocialService({ storage });

    // Insert in a known order: first → second → third (newest last).
    await service.createEmanation(A, 'human', { text: 'first' });
    await service.createEmanation(A, 'human', { text: 'second' });
    await service.createEmanation(A, 'human', { text: 'third' });
  });

  test('the global feed is strict reverse-chronological (newest first)', async () => {
    const feed = await service.getGlobalFeed(null, 20);
    expect(feed.map((e) => e.content.text)).toEqual(['third', 'second', 'first']);

    const times = feed.map((e) => new Date(e.createdAt).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]); // non-increasing
    }
  });

  test('engagement cannot reorder the feed — a heavily-resonated OLD post stays below newer ones', async () => {
    const before = await service.getGlobalFeed(null, 20);
    const oldest = before[before.length - 1];
    expect(oldest.content.text).toBe('first');

    // Three distinct wallets resonate the oldest emanation.
    for (const addr of RESONATORS) {
      await service.resonateEmanation(addr, oldest.id);
    }

    const after = await service.getGlobalFeed(null, 20);

    // Order is byte-for-byte unchanged despite the engagement.
    expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));

    const resonated = after.find((e) => e.id === oldest.id);
    expect(resonated.stats.resonances).toBeGreaterThan(0); // it DID get engagement
    expect(after[after.length - 1].id).toBe(oldest.id); // …but stayed at the bottom
    expect(after[0].content.text).toBe('third'); // newest still leads
  });

  test('no paid-promotion machinery exists in the feed storage', () => {
    const src = readFileSync(
      path.join(__dirname, '../../backend/services/social-storage.js'),
      'utf8'
    );
    // Tripwire: these tokens would signal a ranking/boost surface being added.
    for (const token of ['boost', 'promoted', 'sponsored', 'payToRank', 'paidRank']) {
      expect(src.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });
});
