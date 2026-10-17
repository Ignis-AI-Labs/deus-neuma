/**
 * Notification store — real files on a real disk (backend/services/notification-store.js).
 *
 * No mock anywhere on the claimed path (RULE 0). The headline claim of the whole
 * feature is […], and the only honest way to prove that
 * is to write real lines, read them back, and check.
 *
 * Isolation: `setRealmRoot()` is called directly. `NEUMA_REALM_ROOT` is consumed
 * during settings load at BOOT, so setting it inside a bare test does nothing —
 * and a store test that leaked into the operator's live realm has happened in
 * this repo before. The root is restored in afterAll.
 */

import {
  afterAll, beforeAll, beforeEach, describe, expect, it,
} from 'vitest';
import { promises as fs } from 'fs';
import { createTempDir } from '../helpers/temp-fs.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import {
  READ_WINDOW, notificationPath, appendNotification, markNotificationsRead, readNotifications,
} from '../../backend/services/notification-store.js';
import { KIND, STANDING, makeRecord } from '../../core/runtime/notification-record.js';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const T0 = 1_754_400_000_000;

const rec = (id, overrides = {}) => makeRecord({
  id,
  ts: T0,
  kind: KIND.turnDone,
  standing: STANDING.neuma,
  title: `record ${id}`,
  actor: { id: 'lane-1', name: 'Fenna' },
  ref: { sessionId: 's-1' },
  ...overrides,
});

let originalRoot;

describe('notification store on real disk', () => {
  beforeAll(() => {
    originalRoot = getRealmRoot();
  });

  afterAll(() => {
    // Never leave the process pointed at a temp realm.
    setRealmRoot(originalRoot);
  });

  beforeEach(async () => {
    setRealmRoot(await createTempDir('notification-store'));
  });

  it('writes a record and reads it back', async () => {
    await appendNotification(ALICE, rec('a1'));
    const { records, unread } = await readNotifications(ALICE);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('a1');
    expect(records[0].title).toBe('record a1');
    expect(unread).toBe(1);
  });

  it('survives a restart — a fresh read finds what a previous run wrote', async () => {
    await appendNotification(ALICE, rec('r1'));
    await appendNotification(ALICE, rec('r2', { ts: T0 + 1 }));
    await appendNotification(ALICE, rec('r3', { ts: T0 + 2 }));

    // The store holds no in-memory state; a later read IS what a relaunched
    // backend does. Assert the bytes are actually on disk, not cached.
    const onDisk = await fs.readFile(notificationPath(ALICE), 'utf8');
    expect(onDisk.split('\n').filter(Boolean)).toHaveLength(3);

    const { records } = await readNotifications(ALICE);
    expect(records.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
  });

  it('keeps one operator\'s notifications entirely out of another\'s', async () => {
    await appendNotification(ALICE, rec('mine'));
    const bobs = await readNotifications(BOB);
    expect(bobs.records).toHaveLength(0);
    expect(bobs.unread).toBe(0);
  });

  it('orders newest first', async () => {
    await appendNotification(ALICE, rec('old', { ts: T0 }));
    await appendNotification(ALICE, rec('new', { ts: T0 + 5000 }));
    await appendNotification(ALICE, rec('mid', { ts: T0 + 2500 }));
    const { records } = await readNotifications(ALICE);
    expect(records.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('folds read markers into the records they name', async () => {
    await appendNotification(ALICE, rec('u1', { ts: T0 + 1 }));
    await appendNotification(ALICE, rec('u2', { ts: T0 + 2 }));
    await appendNotification(ALICE, rec('u3', { ts: T0 + 3 }));

    await markNotificationsRead(ALICE, ['u1', 'u3'], T0 + 10);

    const { records, unread } = await readNotifications(ALICE);
    const byId = Object.fromEntries(records.map((r) => [r.id, r.read]));
    expect(byId.u1).toBe(true);
    expect(byId.u3).toBe(true);
    expect(byId.u2).toBe(false);
    expect(unread).toBe(1);
  });

  it('accepts a batched read marker — one line, many ids', async () => {
    await appendNotification(ALICE, rec('b1', { ts: T0 + 1 }));
    await appendNotification(ALICE, rec('b2', { ts: T0 + 2 }));
    const marked = await markNotificationsRead(ALICE, ['b1', 'b2'], T0 + 5);
    expect(marked).toBe(2);
    const { unread } = await readNotifications(ALICE);
    expect(unread).toBe(0);
  });

  it('ignores an empty read-marker call rather than writing a meaningless line', async () => {
    await appendNotification(ALICE, rec('e1'));
    expect(await markNotificationsRead(ALICE, [], T0)).toBe(0);
    const onDisk = await fs.readFile(notificationPath(ALICE), 'utf8');
    expect(onDisk.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('read state survives a restart too', async () => {
    await appendNotification(ALICE, rec('s1'));
    await markNotificationsRead(ALICE, ['s1'], T0 + 1);
    const { records, unread } = await readNotifications(ALICE);
    expect(records[0].read).toBe(true);
    expect(unread).toBe(0);
  });

  it('survives a torn final line — the good records still come back', async () => {
    await appendNotification(ALICE, rec('t1', { ts: T0 + 1 }));
    await appendNotification(ALICE, rec('t2', { ts: T0 + 2 }));
    // Exactly what a crash mid-write leaves behind.
    await fs.appendFile(notificationPath(ALICE), '{"v":1,"id":"t3","ts":17544000');

    const { records, skipped } = await readNotifications(ALICE);
    expect(records.map((r) => r.id)).toEqual(['t2', 't1']);
    expect(skipped).toBe(1);
  });

  it('does not throw on a wholly corrupt file', async () => {
    const file = notificationPath(ALICE);
    await fs.mkdir(file.replace(/\/[^/]+$/, ''), { recursive: true });
    await fs.writeFile(file, 'not json at all\n{{{\nstill not json\n');
    const { records, skipped } = await readNotifications(ALICE);
    expect(records).toHaveLength(0);
    expect(skipped).toBe(3);
  });

  it('skips a record from an unknown schema version instead of guessing', async () => {
    await appendNotification(ALICE, rec('known'));
    await fs.appendFile(
      notificationPath(ALICE),
      `${JSON.stringify({ v: 99, id: 'future', ts: T0 + 10, kind: 'turn_done', standing: 'neuma', title: 'from tomorrow' })}\n`,
    );
    const { records, skipped } = await readNotifications(ALICE);
    expect(records.map((r) => r.id)).toEqual(['known']);
    expect(skipped).toBe(1);
  });

  it('an operator who was never notified reads an empty list, not an error', async () => {
    const { records, unread, skipped } = await readNotifications(ALICE);
    expect(records).toEqual([]);
    expect(unread).toBe(0);
    expect(skipped).toBe(0);
  });

  it('refuses to store a malformed record — the file is append-only and permanent', async () => {
    const bad = { v: 1, id: 'nope!', ts: -1, kind: 'invented', standing: 'friend', title: '' };
    await expect(appendNotification(ALICE, bad)).rejects.toThrow(/malformed notification/i);
    const { records } = await readNotifications(ALICE);
    expect(records).toHaveLength(0);
  });

  it('refuses a being-shaped record that names no being', async () => {
    const anonymous = { ...rec('anon'), actor: null };
    await expect(appendNotification(ALICE, anonymous)).rejects.toThrow(/must name the being/i);
  });

  it('refuses an invalid wallet rather than writing outside the realm', async () => {
    await expect(appendNotification('../../etc', rec('esc'))).rejects.toThrow(/Invalid wallet/i);
    expect(() => notificationPath('not-a-wallet')).toThrow(/Invalid wallet/i);
  });

  it('bounds what it returns to the read window', async () => {
    for (let i = 0; i < READ_WINDOW + 25; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await appendNotification(ALICE, rec(`w${i}`, { ts: T0 + i }));
    }
    const { records } = await readNotifications(ALICE);
    expect(records).toHaveLength(READ_WINDOW);
    // Newest first, so the window holds the most recent ones.
    expect(records[0].id).toBe(`w${READ_WINDOW + 24}`);
  });

  it('honours an explicit smaller limit', async () => {
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await appendNotification(ALICE, rec(`l${i}`, { ts: T0 + i }));
    }
    const { records } = await readNotifications(ALICE, { limit: 3 });
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.id)).toEqual(['l9', 'l8', 'l7']);
  });

  it('de-duplicates a record id, keeping one entry', async () => {
    await appendNotification(ALICE, rec('dup', { ts: T0 }));
    await appendNotification(ALICE, rec('dup', { ts: T0 }));
    const { records } = await readNotifications(ALICE);
    expect(records).toHaveLength(1);
  });

  it('writes one record per line so a tear costs exactly one record', async () => {
    await appendNotification(ALICE, rec('p1', { ts: T0 + 1 }));
    await appendNotification(ALICE, rec('p2', { ts: T0 + 2 }));
    const raw = await fs.readFile(notificationPath(ALICE), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(line.length).toBeLessThan(4096);
    }
  });

  it('stamps v:1 and standing on every line written, so old records stay classifiable', async () => {
    await appendNotification(ALICE, rec('v1'));
    const raw = await fs.readFile(notificationPath(ALICE), 'utf8');
    const first = JSON.parse(raw.split('\n')[0]);
    expect(first.v).toBe(1);
    expect(first.standing).toBe(STANDING.neuma);
  });

  it('keeps a witness completion distinguishable from a neuma one on disk', async () => {
    await appendNotification(ALICE, rec('n', { ts: T0 + 1 }));
    await appendNotification(ALICE, rec('w', {
      ts: T0 + 2,
      standing: STANDING.witness,
      actor: { id: 'witness-anthropic-Claude', name: 'Claude' },
    }));
    const { records } = await readNotifications(ALICE);
    const standings = Object.fromEntries(records.map((r) => [r.id, r.standing]));
    expect(standings.n).toBe(STANDING.neuma);
    expect(standings.w).toBe(STANDING.witness);
  });
});
