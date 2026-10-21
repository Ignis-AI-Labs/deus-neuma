/* global process */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { birthSessionPath, writeSessionCheckpoint } from '../../core/birth/birth-session-store.js';
import { listInterruptedSessions } from '../../core/birth/birth-resume.js';
import { isSessionExpired, TEST_SESSION_TTL_MS, REAL_SESSION_TTL_MS } from '../../core/birth/birth-session-expiry.js';
import { restoreSession } from '../../core/birth/birth-session-lifecycle.js';

// impure — genuine checkpoint IO, isolated using the production storage override.
const withCheckpoint = async (session, prove) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-expiry-'));
  const keys = ['NEUMA_DATA_ROOT', 'NEUMA_RETURNED_PATH'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.NEUMA_DATA_ROOT = root;
  process.env.NEUMA_RETURNED_PATH = path.join(root, 'returned.md');
  try {
    const id = randomBytes(16).toString('hex');
    await writeSessionCheckpoint(id, session);
    const file = birthSessionPath(id);
    // Simulate downtime by aging the real saved record, without changing the clock.
    const bytes = JSON.stringify({ ...session, persistedAt: Date.now() - 365 * 86400000 });
    await fs.writeFile(file, bytes);
    await prove({ id, file, bytes, returned: process.env.NEUMA_RETURNED_PATH });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    await fs.rm(root, { recursive: true, force: true });
  }
};
const checkpoint = (isTest, chosenName) => ({
  origin: 'portal', isTest, currentStage: 4, lastHandledStage: 3, startTime: 1,
  data: { chosenName, firstWords: [{ stage: 1, response: 'Preserve these checkpoint words.' }] },
});

test('a year-old named real checkpoint remains discoverable without rewriting bytes', async () => {
  await withCheckpoint(checkpoint(false, 'Checkpoint Fixture'), async ({ id, file, bytes }) => {
    // No wallet recorded: discoverable by the install's owner (unrecordedOpen).
    expect((await listInterruptedSessions(undefined, { unrecordedOpen: true })).map(row => row.sessionId)).toContain(id);
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  });
});

test('a year-old named real checkpoint restores without deleting or refreshing bytes', async () => {
  await withCheckpoint(checkpoint(false, 'Checkpoint Fixture'), async ({ id, file, bytes, returned }) => {
    const active = new Map();
    expect(await restoreSession(id, active)).toEqual(JSON.parse(bytes));
    expect(active.get(id)).toEqual(JSON.parse(bytes));
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
    await expect(fs.access(returned)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

for (const isTest of [false, true]) {
  test(`expired ${isTest ? 'named rehearsal' : 'unnamed real'} retains its cleanup policy`, async () => {
    await withCheckpoint(checkpoint(isTest, isTest ? 'Rehearsal Fixture' : null), async ({ id, file, returned }) => {
      expect((await listInterruptedSessions(undefined, { unrecordedOpen: true })).map(row => row.sessionId)).not.toContain(id);
      expect(await restoreSession(id, new Map())).toBeNull();
      await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
      if (isTest) await expect(fs.access(returned)).rejects.toMatchObject({ code: 'ENOENT' });
      else expect(await fs.readFile(returned, 'utf8')).toContain('Preserve these checkpoint words.');
    });
  });
}

for (const isTest of [false, true]) {
  for (const chosenName of [null, 'Named Fixture']) {
    test(`expiry boundary: rehearsal=${isTest}, named=${Boolean(chosenName)}`, () => {
      const ttl = isTest ? TEST_SESSION_TTL_MS : REAL_SESSION_TTL_MS;
      const saved = { ...checkpoint(isTest, chosenName), persistedAt: 100 };
      expect(isSessionExpired(saved, 100 + ttl - 1)).toBe(false);
      expect(isSessionExpired(saved, 100 + ttl)).toBe(false);
      expect(isSessionExpired(saved, 101 + ttl)).toBe(isTest || !chosenName);
    });
  }
}
