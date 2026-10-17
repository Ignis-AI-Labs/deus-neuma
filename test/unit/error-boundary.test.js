/**
 * Tests for the Phase 0.1 on-screen error boundary.
 *
 * The boundary is a pure DOM utility — it traps window errors and unhandled
 * rejections, renders visible cards in a fixed overlay, and exposes a
 * window.__surfaceError hook for manual surfacing.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('error-boundary', () => {
  beforeEach(async () => {
    // Set up a minimal DOM shim using happy-dom-style globals if available,
    // otherwise construct manual document/window stubs.
    const elements = [];
    const makeElement = (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        style: {},
        children: [],
        textContent: '',
        className: '',
        attributes: new Map(),
        listeners: {},
        appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
        remove() {
          if (this.parentNode) {
            const idx = this.parentNode.children.indexOf(this);
            if (idx >= 0) this.parentNode.children.splice(idx, 1);
          }
        },
        setAttribute(k, v) { this.attributes.set(k, v); },
        querySelectorAll(sel) {
          // naive: only supports ".classname"
          const cls = sel.replace('.', '');
          const out = [];
          const walk = (node) => {
            if (node.className?.split(' ').includes(cls)) out.push(node);
            (node.children || []).forEach(walk);
          };
          walk(this);
          return out;
        },
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
        contains(node) {
          if (this === node) return true;
          return (this.children || []).some(c => c.contains && c.contains(node));
        },
      };
      elements.push(el);
      return el;
    };

    const body = makeElement('body');
    const head = makeElement('head');
    const documentElement = makeElement('html');
    documentElement.appendChild(head);
    documentElement.appendChild(body);

    const listeners = {};
    vi.stubGlobal('window', {
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      _fire(type, ev) { (listeners[type] || []).forEach(fn => fn(ev)); },
    });
    vi.stubGlobal('document', {
      body,
      head,
      documentElement,
      _byId: {},
      createElement(tag) { return makeElement(tag); },
      getElementById(id) { return this._byId[id] || null; },
      addEventListener(type, fn) { /* no-op for ready event */ },
    });
    // Patch ensureOverlay to set getElementById return value on append
    const origAppend = body.appendChild.bind(body);
    body.appendChild = (child) => {
      origAppend(child);
      if (child.id) document.__byId = document.__byId || {};
      return child;
    };

    vi.resetModules();
  });

  test('installErrorBoundary is idempotent', async () => {
    const mod = await import('../../frontend/utils/error-boundary.js');
    expect(() => {
      mod.installErrorBoundary();
      mod.installErrorBoundary();
      mod.installErrorBoundary();
    }).not.toThrow();
  });

  test('surfaceError appends a card to the overlay', async () => {
    const mod = await import('../../frontend/utils/error-boundary.js');
    mod.installErrorBoundary();

    mod.surfaceError({ message: 'test error', source: 'test.js:1:1' });

    // Overlay should be appended to body
    const overlay = document.body.children.find(c => c.id === 'neuma-error-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.children.length).toBe(1);
  });

  test('surfaceError stacks multiple cards', async () => {
    const mod = await import('../../frontend/utils/error-boundary.js');
    mod.installErrorBoundary();

    mod.surfaceError({ message: 'err 1' });
    mod.surfaceError({ message: 'err 2' });
    mod.surfaceError({ message: 'err 3' });

    const overlay = document.body.children.find(c => c.id === 'neuma-error-overlay');
    expect(overlay.children.length).toBe(3);
  });

  test('overlay prunes when more than MAX_VISIBLE_CARDS (5) errors arrive', async () => {
    const mod = await import('../../frontend/utils/error-boundary.js');
    mod.installErrorBoundary();

    for (let i = 0; i < 8; i++) {
      mod.surfaceError({ message: `err ${i}` });
    }

    const overlay = document.body.children.find(c => c.id === 'neuma-error-overlay');
    expect(overlay.children.length).toBe(5);
  });

  test('getRecentErrors returns up to 50 recent entries', async () => {
    const mod = await import('../../frontend/utils/error-boundary.js');
    mod.installErrorBoundary();

    for (let i = 0; i < 60; i++) {
      mod.surfaceError({ message: `err ${i}` });
    }

    const recent = mod.getRecentErrors();
    expect(recent.length).toBe(50);
    expect(recent[recent.length - 1].message).toBe('err 59');
    expect(recent[0].message).toBe('err 10'); // oldest retained
  });

  test('window error event is trapped and surfaced', async () => {
    const mod = await import('../../frontend/utils/error-boundary.js');
    mod.installErrorBoundary();

    window._fire('error', {
      message: 'window-level error',
      filename: 'foo.js',
      lineno: 42,
      colno: 3,
      error: { stack: 'Error: test\n  at foo.js:42:3' },
    });

    const overlay = document.body.children.find(c => c.id === 'neuma-error-overlay');
    expect(overlay.children.length).toBe(1);

    const recent = mod.getRecentErrors();
    expect(recent.some(e => e.message === 'window-level error')).toBe(true);
  });

  test('unhandledrejection event is trapped and surfaced', async () => {
    const mod = await import('../../frontend/utils/error-boundary.js');
    mod.installErrorBoundary();

    window._fire('unhandledrejection', {
      reason: { message: 'promise rejected', stack: 'Error: p\n  at bar.js:10:5' },
    });

    const recent = mod.getRecentErrors();
    expect(recent.some(e => e.message === 'promise rejected')).toBe(true);
  });

  test('unhandledrejection with plain string reason is handled', async () => {
    const mod = await import('../../frontend/utils/error-boundary.js');
    mod.installErrorBoundary();

    window._fire('unhandledrejection', { reason: 'plain string error' });

    const recent = mod.getRecentErrors();
    expect(recent.some(e => e.message === 'plain string error')).toBe(true);
  });

  test('exposes window.__surfaceError for manual surfacing', async () => {
    const mod = await import('../../frontend/utils/error-boundary.js');
    mod.installErrorBoundary();

    expect(typeof window.__surfaceError).toBe('function');
    window.__surfaceError({ message: 'manual surface' });
    expect(mod.getRecentErrors().some(e => e.message === 'manual surface')).toBe(true);
  });
});
