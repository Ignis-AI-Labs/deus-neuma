/**
 * The bell's quiet MANDATE mark and the WAITING ON YOU OS notice (Founder,
 * 2026-10-24, approving the two items waiting-in-tray left open). Real
 * functions with real inputs; the tray rendered for real (renderToStaticMarkup
 * inside real providers); main's own activation check (electron/notify-text.cjs)
 * required for real — RULE 0: nothing on these paths is mocked.
 *
 * Proves: an ACTIVE mandate (and only that) stands beside the bell in plain
 * sight — `MANDATE · ND` in the alert colour, WITHDRAW one press, never inside
 * the bell button nor the ◆N waiting mark — its words in the bell's label; gone
 * when the account carries none or its end has passed; never animated. The notice decision: a new item while the desk is out of sight →
 * exactly one notice; desk on screen → none; already notified → none; switch
 * off → none; its id passes main's activation check and finds its item again.
 */

import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotificationTray } from '../../frontend/app/RelinkShell/NotificationTray/NotificationTray.jsx';
import { NotificationsContext } from '../../frontend/app/RelinkShell/notifications-context.js';
import { WaitingContext } from '../../frontend/app/RelinkShell/waiting/use-waiting.js';
import { WindowContext } from '../../frontend/app/windowing/WindowManager.jsx';
import { bellMandate } from '../../frontend/app/RelinkShell/mandate/mandate-view.js';
import { bellWords } from '../../frontend/app/RelinkShell/waiting/waiting-view.js';
import { noticeId, noticeItem, waitingNotices } from '../../frontend/app/RelinkShell/waiting/waiting-notice.js';
import { mandateOnMark } from '../../backend/services/marketing/mandate/mandate-words.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { activationOf, cleanNotifyText } = require('../../electron/notify-text.cjs');

const NOW = Date.parse('2026-10-24T08:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const ACTIVE = { expiresAt: '2026-10-31T08:00:00.000Z', timeZone: 'UTC' };
const WORDS = 'Mandate on — the CMO acts for you without asking · turns itself off on Oct 31 · WITHDRAW beside the bell';

describe('the backend names an ACTIVE mandate, and only that', () => {
  const record = (over) => ({ id: 'm-1', status: 'active', expiresAt: iso(NOW + 7 * DAY), timeZone: 'Asia/Jakarta', ...over });
  const now = new Date(NOW);
  test('active → when it ends and its zone', () => {
    expect(mandateOnMark(record(), { now })).toEqual({ expiresAt: iso(NOW + 7 * DAY), timeZone: 'Asia/Jakarta' });
    expect(mandateOnMark(record({ expiresAt: null }), { now })).toEqual({ expiresAt: null, timeZone: 'Asia/Jakarta' });
  });
  test('paused (a row instead), withdrawn, expired, none → nothing', () => {
    expect(mandateOnMark(record({ status: 'paused' }), { now })).toBeNull();
    expect(mandateOnMark(record({ status: 'withdrawn' }), { now })).toBeNull();
    expect(mandateOnMark(record({ expiresAt: iso(NOW - 1) }), { now })).toBeNull();
    expect(mandateOnMark(null, { now })).toBeNull();
  });
});

describe('the bell says it in plain words', () => {
  test('a dated mandate turns itself off on its day; an open one (stored before the ruling) only when withdrawn', () => {
    expect(bellMandate(ACTIVE, NOW)).toEqual({ label: 'MANDATE · 7D', words: WORDS });
    expect(bellMandate({ expiresAt: null, timeZone: 'UTC' }, NOW).words)
      .toBe('Mandate on — the CMO acts for you without asking · turns itself off only when you withdraw it · WITHDRAW beside the bell');
  });
  test('none, or past its end by the desk clock → no mark', () => {
    expect(bellMandate(null, NOW)).toBeNull();
    expect(bellMandate(ACTIVE, Date.parse(ACTIVE.expiresAt))).toBeNull();
  });
  test('an unreadable end reads —, never a made-up day; a bad zone falls back to the desk\'s', () => {
    expect(bellMandate({ expiresAt: 'soon', timeZone: 'UTC' }, NOW).words).toContain('turns itself off — ·');
    expect(bellMandate({ expiresAt: ACTIVE.expiresAt, timeZone: 'Not/AZone' }, NOW).words).toMatch(/off on Oct (30|31) ·/);
  });
  test('the bell\'s label carries it between what waits and the notifications', () => {
    expect(bellWords({ count: 2, oldest: '4M' }, 1, null, WORDS)).toBe(`2 waiting on you · oldest 4M · ${WORDS} · Notifications, 1 unread`);
    expect(bellWords({ count: 0, oldest: null }, 0, null, WORDS)).toBe(`${WORDS} · Notifications`);
    expect(bellWords({ count: 0, oldest: null }, 0, null)).toBe('Notifications');
  });
});

describe('the mark on the bell, rendered', () => {
  const notifications = (unread = 0) => ({
    records: [], unread, hydrated: true,
    markRead: () => {}, markAllRead: () => {}, clear: () => {}, setFrontmostApp: () => {},
  });
  const windows = { registry: {}, state: { windows: [], focusedId: null }, dispatch: () => {} };
  const renderTray = (account, unread = 0) => renderToStaticMarkup(
    createElement(WindowContext.Provider, { value: windows },
      createElement(NotificationsContext.Provider, { value: notifications(unread) },
        createElement(WaitingContext.Provider, { value: { account, error: null, watch: () => {} } }, createElement(NotificationTray)))),
  );
  const far = { expiresAt: iso(Date.now() + 7 * DAY), timeZone: 'UTC' };
  const ITEM = { id: 'h-1', kind: 'house-ask', title: 'Which banner?', who: { name: 'Kestrel' }, at: iso(Date.now() - 60_000), where: { app: 'houseclock', tab: 'asks', askId: 'h-1' } };

  test('active: MANDATE · 7D and WITHDRAW in plain sight beside the bell — outside the bell button, never the ◆N', () => {
    const html = renderTray({ count: 1, oldestAt: ITEM.at, items: [ITEM], gaps: [], mandate: far }, 2);
    const { words } = bellMandate(far, Date.now());
    const mark = html.match(/<span class="ntray-mandate-mark"[^]*?<\/button><\/span>/)[0];
    expect(mark).toContain(`data-mandate="on" title="${words}"`);
    expect(mark).toContain('<button type="button" class="ntray-mandate-k">MANDATE · 7D</button>');
    expect(mark).toContain('<button type="button" class="mandate-withdraw">WITHDRAW</button>');
    expect(mark).not.toContain('waiting-chip-mark');
    expect(html).toContain('class="ntray-wait"');
    expect(html).toMatch(/class="ntray-bell-count">2</);
    expect(html).toContain(`aria-label="1 waiting on you · oldest 1M · ${words} · Notifications, 2 unread"`);
    // beside the bell, in its row — not nested inside the bell button
    const bell = html.match(/<button type="button" class="ntray-bell[^]*?<\/button>/)[0];
    expect(bell).not.toContain('ntray-mandate-mark');
    expect(html.indexOf('ntray-mandate-mark')).toBeLessThan(html.indexOf('class="ntray-bell '));
    expect(html).toContain('<div class="ntray-bell-row">');
  });

  test('none standing (or paused — the account carries no mark then): the bell is as it was', () => {
    const html = renderTray({ count: 0, oldestAt: null, items: [], gaps: [], mandate: null });
    expect(html).not.toContain('ntray-mandate-mark');
    expect(html).toContain('aria-label="Notifications"');
  });

  test('never animated: no animation or transition anywhere on the mark\'s rules', () => {
    const css = fs.readFileSync(path.join(HERE, '../../frontend/app/RelinkShell/NotificationTray/TrayWaiting.css'), 'utf8');
    const rules = [...css.matchAll(/\.ntray-mandate-[a-z]+\s*\{[^}]*\}/g)].map((m) => m[0]);
    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const rule of rules) expect(rule).not.toMatch(/animation|transition/);
    // obvious: the alert colour, at the 13px floor
    expect(rules.find((r) => r.startsWith('.ntray-mandate-mark'))).toMatch(/color: var\(--alert\);[^}]*font-size: 13px/);
  });
});

describe('one OS notice per new decision, only while the desk is out of sight', () => {
  const ITEM = {
    id: 'proposal:e2e-kestrel:p-17', kind: 'proposal', title: 'Rename my\nvoice <b>pack</b>',
    who: { name: 'Kestrel', laneId: 'e2e-kestrel' }, at: iso(NOW), where: { app: 'sovereignty', neumaId: 'e2e-kestrel', proposalId: 'p-17' },
  };
  const decide = (over) => waitingNotices({ fresh: [ITEM], notified: new Set(), deskOnScreen: false, enabled: true, ...over });

  test('new + hidden → exactly one notice: what, who, and the title as plain text', () => {
    const out = decide();
    expect(out).toHaveLength(1);
    expect(out[0].item).toBe(ITEM);
    expect(out[0].notice).toEqual({
      id: noticeId(ITEM.id),
      title: 'Waiting on you · PROPOSAL',
      body: 'Kestrel · Rename my\nvoice <b>pack</b>',
      appId: 'sovereignty',
    });
    // main cleans every line before the OS sees it: the newline cannot format, the tag is inert text
    expect(cleanNotifyText(out[0].notice.body, '')).toBe('Kestrel · Rename my voice <b>pack</b>');
  });

  test('desk on screen → none; already notified → none; DESKTOP ALERTS off → none', () => {
    expect(decide({ deskOnScreen: true })).toEqual([]);
    expect(decide({ notified: new Set([noticeId(ITEM.id)]) })).toEqual([]);
    expect(decide({ enabled: false })).toEqual([]);
    expect(decide({ fresh: [] })).toEqual([]);
  });

  test('a second read carrying the same decision raises nothing more', () => {
    const notified = new Set();
    const first = waitingNotices({ fresh: [ITEM], notified, deskOnScreen: false, enabled: true });
    for (const { notice } of first) notified.add(notice.id);
    expect(waitingNotices({ fresh: [ITEM], notified, deskOnScreen: false, enabled: true })).toEqual([]);
  });

  test('the id is stable, closed-shape, and passes main\'s activation check; the click finds its item again', () => {
    const id = noticeId(ITEM.id);
    expect(id).toBe(noticeId('proposal:e2e-kestrel:p-17'));
    expect(id).not.toBe(noticeId('proposal:e2e-kestrel:p-18'));
    expect(id).toMatch(/^wait-[0-9a-z]{1,7}$/);
    expect(activationOf({ id, appId: 'sovereignty' })).toEqual({ appId: 'sovereignty', id });
    const other = { ...ITEM, id: 'card:c-9' };
    expect(noticeItem(id, [other, ITEM])).toBe(ITEM);
    expect(noticeItem(id, [other])).toBeNull();
    expect(noticeItem('n-123', [ITEM])).toBeNull();
    expect(noticeItem(undefined, [ITEM])).toBeNull();
  });
});
