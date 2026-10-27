/**
 * WAITING ON YOU in the notification tray, rendered — real React, real
 * renderToStaticMarkup, the real tray inside real providers (RULE 0: no mock
 * of the component under test, nor of anything it reads). Design note, 2026-10-24:
 * […]
 *
 * Proves: the bell carries the TRUE count as its own mark (distinct from the
 * unread count), the oldest wait on hover; nothing waiting leaves the bell as
 * it was; an unreadable account shows —; the section lists every decision in
 * the account's order (oldest first) with what / who / how long; a model-made
 * title reaches the DOM as text, never markup.
 */

import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotificationTray } from '../../frontend/app/RelinkShell/NotificationTray/NotificationTray.jsx';
import { WaitingSection, WaitingToast } from '../../frontend/app/RelinkShell/NotificationTray/TrayWaiting.jsx';
import { NotificationsContext } from '../../frontend/app/RelinkShell/notifications-context.js';
import { WaitingContext } from '../../frontend/app/RelinkShell/waiting/use-waiting.js';
import { indicatorLine } from '../../frontend/app/RelinkShell/waiting/waiting-view.js';
import { WindowContext } from '../../frontend/app/windowing/WindowManager.jsx';

const NOW = Date.now();
const MIN = 60000;
const ago = (ms) => new Date(NOW - ms).toISOString();

const ITEMS = [
  { id: 'q-1', kind: 'post', title: 'Launch week opens today.', who: { name: 'Kestrel' }, at: ago((44 * 60 + 3) * MIN), where: { app: 'x', channelId: 'x', entryId: 'q-1' } },
  { id: 'h-1', kind: 'house-ask', title: 'Which banner goes up?', who: { laneId: 'lane-b' }, at: ago(25 * MIN), where: { app: 'houseclock', tab: 'asks', askId: 'h-1' } },
  { id: 'c-1', kind: 'approval', title: '<img src=x onerror=alert(1)>', who: null, at: ago(10 * 1000), where: { app: 'chat', cardId: 'c-1' } },
];
const ACCOUNT = { count: 3, oldestAt: ITEMS[0].at, items: ITEMS, gaps: [] };

const notifications = (unread = 0) => ({
  records: [], unread, hydrated: true,
  markRead: () => {}, markAllRead: () => {}, clear: () => {}, setFrontmostApp: () => {},
});
const windows = { registry: {}, state: { windows: [], focusedId: null }, dispatch: () => {} };

/** The tray, as the desk mounts it, holding this account. */
const renderTray = (waiting, unread = 0) => renderToStaticMarkup(
  createElement(WindowContext.Provider, { value: windows },
    createElement(NotificationsContext.Provider, { value: notifications(unread) },
      createElement(WaitingContext.Provider, { value: waiting }, createElement(NotificationTray)))),
);

describe('the bell carries what waits, as its own mark', () => {
  test('the true count, a steady diamond, and the oldest wait on hover', () => {
    const html = renderTray({ account: ACCOUNT, error: null, watch: () => {} }, 2);
    expect(html).toContain('class="ntray-wait"');
    expect(html).toContain('data-count="3"');
    expect(html).toMatch(/class="ntray-wait-n">3</);
    expect(html).toContain('waiting-chip-mark');
    expect(html).toContain('is-owed');
    expect(html).toContain('title="3 waiting on you · oldest 1D 20H · Notifications, 2 unread"');
    // the unread count stands apart from it
    expect(html).toMatch(/class="ntray-bell-count">2</);
  });

  test('nothing waiting: the bell is exactly the notifications bell', () => {
    const html = renderTray({ account: { count: 0, oldestAt: null, items: [], gaps: [] }, error: null, watch: () => {} });
    expect(html).not.toContain('ntray-wait');
    expect(html).not.toContain('is-owed');
    expect(html).toContain('aria-label="Notifications"');
  });

  test('an account that cannot be read shows —, never a zero', () => {
    const html = renderTray({ account: null, error: 'HTTP 500', watch: () => {} });
    expect(html).toContain('ntray-wait is-unread');
    expect(html).toMatch(/class="ntray-wait-n">—</);
    expect(html).toContain('waiting on you cannot be read: HTTP 500');
  });

  test('outside the desk (no account) the tray renders as before', () => {
    const html = renderToStaticMarkup(
      createElement(WindowContext.Provider, { value: windows },
        createElement(NotificationsContext.Provider, { value: notifications() }, createElement(NotificationTray))),
    );
    expect(html).toContain('ntray-bell');
    expect(html).not.toContain('ntray-wait');
  });
});

describe('the opened tray: WAITING ON YOU first, oldest first', () => {
  const section = (account, error = null) => renderToStaticMarkup(createElement(WaitingSection, {
    account, line: indicatorLine(account, NOW), error, now: NOW, onJump: () => {},
  }));

  test('the overview line, then one row per decision in the account\'s order', () => {
    const html = section(ACCOUNT);
    expect(html).toContain('class="ntray-wait-sec is-owed"');
    expect(html).toMatch(/<b>3<\/b> WAITING ON YOU/);
    expect(html).toContain('OLDEST 1D 20H');
    const kinds = [...html.matchAll(/class="waiting-row-kind">([^<]+)</g)].map((m) => m[1]);
    expect(kinds).toEqual(['POST', 'HOUSE ASK', 'APPROVAL']);
    const metas = [...html.matchAll(/class="waiting-row-meta">([^<]+)</g)].map((m) => m[1].replace(/<!-- -->/g, ''));
    expect(metas).toEqual(['Kestrel · 1D 20H', 'lane-b · 25M', 'THE HOUSE · NOW']);
  });

  test('a model-made title is text, never markup', () => {
    const html = section(ACCOUNT);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('an unreadable source is named', () => {
    expect(section({ ...ACCOUNT, gaps: ['queue'] })).toContain('COULD NOT READ: QUEUE');
  });

  test('nothing waiting: the section holds nothing (the MANDATE row stands only while one does)', () => {
    expect(section({ count: 0, oldestAt: null, items: [], gaps: [] })).toBe('<section class="ntray-wait-sec" aria-label="decisions waiting on you"></section>');
  });

  test('an arrival\'s toast names the decision, who asks, and offers the way to it', () => {
    const html = renderToStaticMarkup(createElement(WaitingToast, {
      item: ITEMS[1], now: NOW, arriving: true, onJump: () => {}, onDismiss: () => {},
    }));
    expect(html).toContain('is-waiting');
    expect(html).toContain('is-arriving');
    expect(html).toContain('HOUSE ASK');
    expect(html).toContain('lane-b');
    expect(html).toContain('Which banner goes up?');
    expect(html).toContain('GO TO IT');
  });
});
