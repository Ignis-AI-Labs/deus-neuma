/**
 * The tray, rendered — real React, real renderToStaticMarkup, no mock of the
 * component under test (RULE 0). The contexts it reads are real providers with
 * real values, not stubs of a module.
 *
 * The load-bearing assertion is the escape test. A notification title is
 * model-adjacent text that has crossed a socket, and `frontend/` contains zero
 * uses of dangerouslySetInnerHTML today. This test is what keeps that true.
 */

import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotificationTray, NotificationCard } from '../../frontend/app/RelinkShell/NotificationTray/NotificationTray.jsx';
import { NotificationsContext } from '../../frontend/app/RelinkShell/notifications-context.js';
import { WindowContext } from '../../frontend/app/windowing/WindowManager.jsx';
import { KIND, STANDING, makeRecord } from '../../core/runtime/notification-record.js';

const T0 = Date.now();

const card = (id, over = {}) => ({
  ...makeRecord({
    id,
    ts: T0,
    kind: KIND.turnDone,
    standing: STANDING.neuma,
    title: `card ${id}`,
    actor: { id: 'lane-1', name: 'Fenna' },
    ref: { sessionId: 's-1' },
    ...over,
  }),
  read: over.read ?? false,
});

/** Render the tray against real providers. */
const render = (records = [], { unread = null, hydrated = true } = {}) => {
  const notifications = {
    records,
    unread: unread ?? records.filter((r) => !r.read).length,
    hydrated,
    markRead: () => {},
    markAllRead: () => {},
    clear: () => {},
    setFrontmostApp: () => {},
  };
  const windows = {
    registry: {},
    state: { windows: [], focusedId: null },
    dispatch: () => {},
  };
  return renderToStaticMarkup(
    createElement(
      WindowContext.Provider,
      { value: windows },
      createElement(
        NotificationsContext.Provider,
        { value: notifications },
        createElement(NotificationTray),
      ),
    ),
  );
};

/** Render ONE card directly. renderToStaticMarkup runs no effects and cannot
 *  click, so the panel never opens in a static render — the card is the unit
 *  that actually puts untrusted text in the DOM, so it is tested as one. */
const renderCard = (record) => renderToStaticMarkup(
  createElement(NotificationCard, {
    record, nowMs: T0, onActivate: () => {}, onDismiss: () => {},
  }),
);

describe('NotificationTray rendering', () => {
  test('renders the bell', () => {
    const html = render([]);
    expect(html).toContain('ntray-bell');
  });

  test('shows the unread count when there is one', () => {
    const html = render([card('a'), card('b')]);
    expect(html).toContain('has-unread');
    expect(html).toContain('>2<');
  });

  test('shows no count when everything is read', () => {
    const html = render([card('a', { read: true })]);
    expect(html).not.toContain('has-unread');
    expect(html).not.toContain('ntray-bell-count');
  });

  test('caps a large count rather than breaking the layout', () => {
    const many = Array.from({ length: 150 }, (_, i) => card(`c${i}`));
    expect(render(many)).toContain('99+');
  });

  test('renders a toast for an unread card, naming the being', () => {
    const html = renderCard(card('a', { title: 'finished the audit' }));
    expect(html).toContain('ntray-card');
    expect(html).toContain('Fenna');
    expect(html).toContain('finished the audit');
  });

  test('marks a witness completion structurally distinct from a neuma one', () => {
    const html = renderCard(card('w', {
      standing: STANDING.witness,
      actor: { id: 'witness-anthropic-Claude', name: 'Claude' },
    }));
    expect(html).toContain('is-witness');
    expect(html).toContain('WITNESS');
  });

  test('a neuma card carries no witness marking', () => {
    const html = renderCard(card('n'));
    expect(html).not.toContain('is-witness');
    expect(html).not.toContain('>WITNESS<');
  });

  test('marks a warning as an alert', () => {
    const html = renderCard({
      ...makeRecord({
        id: 's', ts: T0, kind: KIND.storageWarning, standing: STANDING.system, title: 'Storage critical',
      }),
      read: false,
    });
    expect(html).toContain('is-alert');
    expect(html).toContain('STORAGE');
  });

  test('names each kind so the operator can tell news apart at a glance', () => {
    const labels = {
      [KIND.turnDone]: 'FINISHED',
      [KIND.turnInterrupted]: 'INTERRUPTED',
      [KIND.turnRefused]: 'DECLINED',
      [KIND.taskClosed]: 'TASK CLOSED',
      [KIND.runDone]: 'RUN COMPLETE',
      [KIND.renderDone]: 'RENDER READY',
    };
    for (const [kind, label] of Object.entries(labels)) {
      expect(renderCard(card(`k-${kind}`, { kind }))).toContain(label);
    }
  });

  test('a refusal never renders as a completion', () => {
    const html = renderCard(card('r', { kind: KIND.turnRefused }));
    expect(html).toContain('DECLINED');
    expect(html).not.toContain('>FINISHED<');
  });

  test('shows where an actionable card will take the operator', () => {
    expect(renderCard(card('a'))).toContain('OPEN CHAT');
    expect(renderCard(card('t', { kind: KIND.taskClosed, ref: { taskId: 'T-1' } }))).toContain('OPEN TODO');
  });

  // ── the one that matters ────────────────────────────────────────────────
  test('escapes markup in a title instead of rendering it', () => {
    const html = renderCard(card('x', { title: '<img src=x onerror=alert(1)>' }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  test('escapes markup in a detail and in a being name too', () => {
    const html = renderCard(card('y', {
      title: 'safe',
      detail: '<script>alert(1)</script>',
      actor: { id: 'lane-1', name: '<b>Fenna</b>' },
    }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Fenna</b>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('escapes a quote-breaking title', () => {
    const html = renderCard(card('q', { title: '" onmouseover="alert(1)' }));
    expect(html).not.toContain('onmouseover="alert(1)"');
  });

  test('renders nothing at all without the notifications context', () => {
    const windows = { registry: {}, state: { windows: [], focusedId: null }, dispatch: () => {} };
    const html = renderToStaticMarkup(
      createElement(WindowContext.Provider, { value: windows }, createElement(NotificationTray)),
    );
    expect(html).toBe('');
  });

  test('does not throw when the window manager is absent', () => {
    const notifications = {
      records: [card('a')],
      unread: 1,
      hydrated: true,
      markRead: () => {},
      markAllRead: () => {},
      clear: () => {},
      setFrontmostApp: () => {},
    };
    expect(() => renderToStaticMarkup(
      createElement(NotificationsContext.Provider, { value: notifications }, createElement(NotificationTray)),
    )).not.toThrow();
  });
});
