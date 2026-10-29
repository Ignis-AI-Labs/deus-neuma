/**
 * WAITING ON YOU on the desk — the pure view (waiting-view.js) and the pure
 * half of the jump (waiting-jump.js jumpActions): how long a decision has
 * waited, which platform it belongs to, what arrived, what the band may
 * approve in one press, and which card each row lands on. Real inputs, real
 * outputs; no mock anywhere (RULE 0).
 */
import { describe, test, expect } from 'vitest';
import {
  waitedLabel, whoLabel, ofPlatform, arrivals, arrivalSounds, bandMayApprove, bandRows, indicatorLine,
  cardSelector, markWords, bellWords, nextToasts, BAND_ROWS, BAND_TEXT_MAX,
} from '../../frontend/app/RelinkShell/waiting/waiting-view.js';
import { jumpActions } from '../../frontend/app/RelinkShell/waiting/waiting-jump.js';
import { decodeStreamTransfer } from '../../frontend/app/RelinkShell/stream-tab-transfer.js';

const NOW = Date.UTC(2026, 9, 24, 12, 0);
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60000;

describe('how long it has waited, at a glance', () => {
  test.each([
    [10_000, 'NOW'], [4 * MIN, '4M'], [60 * MIN, '1H'], [130 * MIN, '2H 10M'], [24 * 60 * MIN, '1D'], [(3 * 24 + 4) * 60 * MIN, '3D 4H'],
  ])('%i ms → %s', (ms, label) => { expect(waitedLabel(ago(ms), NOW)).toBe(label); });
  test('an unreadable time is a dash, never a drawn zero', () => {
    expect(waitedLabel('not a time', NOW)).toBe('—');
    expect(indicatorLine(null, NOW)).toEqual({ count: 0, oldest: null });
    expect(indicatorLine({ count: 3, oldestAt: ago(12 * MIN) }, NOW)).toEqual({ count: 3, oldest: '12M' });
  });
  test('who asks: the being by name, else its lane, else the house', () => {
    expect(whoLabel({ who: { laneId: 'l', name: 'Kestrel' } })).toBe('Kestrel');
    expect(whoLabel({ who: { laneId: 'l', name: null } })).toBe('l');
    expect(whoLabel({ who: null })).toBe('THE HOUSE');
  });
});

describe('a platform band shows its own platform, and only what it may honestly approve', () => {
  const items = [
    { id: 'q1', where: { channelId: 'x' }, oneTap: true, text: 'short' },
    { id: 'q2', where: { channelId: 'tiktok' }, oneTap: false, text: 'clip' },
    { id: 'c1', where: { app: 'chat' } },
  ];
  test('ofPlatform keeps exactly one platform\'s items', () => {
    expect(ofPlatform(items, 'x').map((i) => i.id)).toEqual(['q1']);
    expect(ofPlatform(items, 'tiktok').map((i) => i.id)).toEqual(['q2']);
    expect(ofPlatform(null, 'x')).toEqual([]);
  });
  test('APPROVE only where the backend found nothing hidden AND the copy shows whole', () => {
    expect(bandMayApprove(items[0])).toBe(true);
    expect(bandMayApprove(items[1])).toBe(false);
    expect(bandMayApprove({ oneTap: true, text: 'x'.repeat(BAND_TEXT_MAX + 1) })).toBe(false);
    expect(bandMayApprove({ oneTap: true })).toBe(false);
  });
  test('the band lists the longest waits and counts the rest', () => {
    const many = Array.from({ length: BAND_ROWS + 2 }, (_, i) => ({ id: `i${i}` }));
    expect(bandRows(many)).toEqual({ shown: many.slice(0, BAND_ROWS), more: 2 });
    expect(bandRows(many.slice(0, 1))).toEqual({ shown: many.slice(0, 1), more: 0 });
  });
});

describe('what just arrived, and whether it sounds', () => {
  test('the first read has no arrivals; later reads name only the new ids', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(arrivals(null, items)).toEqual([]);
    expect(arrivals(new Set(['a']), items)).toEqual([{ id: 'b' }]);
  });
  test('a chat card already sounds in its own stream; everything else sounds here', () => {
    expect(arrivalSounds([{ where: { app: 'chat' } }])).toBe(false);
    expect(arrivalSounds([{ where: { app: 'council' } }])).toBe(false);
    expect(arrivalSounds([{ where: { app: 'chat' } }, { where: { app: 'houseclock' } }])).toBe(true);
    expect(arrivalSounds([])).toBe(false);
  });
});

describe('each row lands on its own card', () => {
  test('the mark each card carries', () => {
    expect(cardSelector({ where: { app: 'chat', cardId: 'c-1' } })).toBe('[data-wait-id="c-1"]');
    expect(cardSelector({ where: { app: 'x', entryId: 'e1' } })).toBe('[data-entry-id="e1"]');
    expect(cardSelector({ where: { app: 'houseclock', tab: 'asks', askId: 'a1' } })).toBe('[data-ask="a1"]');
    expect(cardSelector({ where: { app: 'sovereignty', proposalId: 'p1' } })).toBe('[data-proposal-id="p1"]');
    expect(cardSelector({ where: { app: 'houseclock', tab: 'charter' } })).toBe('[data-charter-pending]');
    expect(cardSelector({ where: { app: 'chat', cardId: 'a"]x' } })).toBe('[data-wait-id="a]x"]');
  });

  test('a chat card not on the desk opens its own sitting beside the desk stream', () => {
    const item = { where: { app: 'chat', cardId: 'c', sessionId: 's-9', neumaId: 'lane-a', name: 'Kestrel', beingKind: 'local' } };
    const actions = jumpActions(item, [{ id: 'chat' }]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'OPEN_NEW', appId: 'chat' });
    expect(decodeStreamTransfer(actions[0].payload)).toMatchObject({ kind: 'local', neumaId: 'lane-a', sessionId: 's-9' });
    // the desk stream closed: it opens first, so the sitting never becomes instance 1
    expect(jumpActions(item, []).map((a) => a.type)).toEqual(['OPEN', 'OPEN_NEW']);
  });

  test('every other item opens its own window — a public platform\'s post, MARKETING (its account level)', () => {
    expect(jumpActions({ where: { app: 'houseclock', tab: 'asks' } }, [])).toEqual([{ type: 'OPEN', id: 'houseclock' }]);
    expect(jumpActions({ where: { app: 'tiktok', channelId: 'tiktok' } }, [])).toEqual([{ type: 'OPEN', id: 'marketing' }]);
    expect(jumpActions({ where: { app: 'telegram', channelId: 'telegram' } }, [])).toEqual([{ type: 'OPEN', id: 'telegram' }]);
    expect(jumpActions({ where: { app: 'council' } }, [])).toEqual([{ type: 'OPEN', id: 'chat' }]);
    expect(jumpActions({ where: {} }, [])).toEqual([]);
  });
});

describe('the tray carries it: the bell\'s words and the arrival toasts', () => {
  test('the bell says the true count and the oldest wait, then the unread news', () => {
    const line = indicatorLine({ count: 3, oldestAt: ago(44 * 60 * MIN) }, NOW);
    expect(markWords(line)).toBe('3 waiting on you · oldest 1D 20H');
    expect(bellWords(line, 2, null)).toBe('3 waiting on you · oldest 1D 20H · Notifications, 2 unread');
    expect(bellWords(line, 0, null)).toBe('3 waiting on you · oldest 1D 20H · Notifications');
  });
  test('nothing waiting leaves the bell exactly as it was', () => {
    const none = indicatorLine({ count: 0, oldestAt: null }, NOW);
    expect(markWords(none)).toBeNull();
    expect(bellWords(none, 0, null)).toBe('Notifications');
    expect(bellWords(none, 4, null)).toBe('Notifications, 4 unread');
  });
  test('an account that cannot be read says so, never a drawn zero', () => {
    expect(bellWords(indicatorLine(null, NOW), 0, 'HTTP 500')).toBe('waiting on you cannot be read: HTTP 500 · Notifications');
  });
  test('a fresh arrival stands first; a decided one retires; at most two stand', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(nextToasts([], [{ id: 'c' }], items)).toEqual([{ id: 'c' }]);
    expect(nextToasts([{ id: 'a' }], [{ id: 'b' }, { id: 'c' }], items)).toEqual([{ id: 'b' }, { id: 'c' }]);
    expect(nextToasts([{ id: 'a' }, { id: 'b' }], [], [{ id: 'b' }])).toEqual([{ id: 'b' }]);
    expect(nextToasts([{ id: 'a' }], [{ id: 'a' }], items)).toEqual([{ id: 'a' }]);
  });
});
