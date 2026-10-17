/**
 * Tests for the Phase 0.2 loading-states utility.
 * Pure DOM helpers with no framework dependency.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const makeDomShim = () => {
  const makeElement = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      style: {},
      textContent: '',
      children: [],
      parentNode: null,
      offsetHeight: 0,
      attributes: new Map(),
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      removeChild(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
        return child;
      },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      setAttribute(k, v) { this.attributes.set(k, v); },
      querySelector(sel) {
        const cls = sel.replace('.', '');
        const find = (node) => {
          for (const c of (node.children || [])) {
            if ((c.className || '').split(' ').includes(cls)) return c;
            const sub = find(c);
            if (sub) return sub;
          }
          return null;
        };
        return find(this);
      },
      classList: {
        _list: new Set(),
        add(...c) { c.forEach(x => this._list.add(x)); },
        remove(...c) { c.forEach(x => this._list.delete(x)); },
        contains(c) { return this._list.has(c); },
      },
    };
    // Rebuild classList per instance (avoid shared Set)
    el.classList = (() => {
      const list = new Set();
      return {
        add: (...c) => c.forEach(x => list.add(x)),
        remove: (...c) => c.forEach(x => list.delete(x)),
        contains: (c) => list.has(c),
        _list: list,
      };
    })();
    return el;
  };

  const body = makeElement('body');
  const byId = new Map();

  const shim = {
    body,
    createElement: makeElement,
    getElementById: (id) => byId.get(id) || null,
    addEventListener: () => {},
    _trackById(el) {
      if (el.id) byId.set(el.id, el);
      for (const c of el.children) shim._trackById(c);
    },
  };

  // Patch appendChild on body so it registers ids
  const origAppend = body.appendChild.bind(body);
  body.appendChild = (child) => {
    origAppend(child);
    if (child.id) byId.set(child.id, child);
    return child;
  };

  // Patch removeChild so it unregisters
  const origRemove = body.removeChild.bind(body);
  body.removeChild = (child) => {
    origRemove(child);
    if (child.id) byId.delete(child.id);
    return child;
  };

  return shim;
};

describe('loading-states', () => {
  let ls;

  beforeEach(async () => {
    const dom = makeDomShim();
    vi.stubGlobal('document', dom);
    vi.stubGlobal('setTimeout', (fn) => { fn(); return 0; });
    vi.resetModules();
    ls = await import('../../frontend/utils/loading-states.js');
  });

  describe('showVoidFade / hideVoidFade', () => {
    test('showVoidFade appends the fade to document.body', () => {
      ls.showVoidFade('Testing...');
      const fade = document.getElementById('neuma-void-fade');
      expect(fade).toBeTruthy();
      expect(fade.className).toBe('neuma-void-fade');
    });

    test('showVoidFade adds a breathing circle and a label', () => {
      ls.showVoidFade('The void stirs...');
      const fade = document.getElementById('neuma-void-fade');
      expect(fade.children.length).toBe(2);
      const breath = fade.querySelector('.neuma-void-fade__breath');
      const label = fade.querySelector('.neuma-void-fade__label');
      expect(breath).toBeTruthy();
      expect(label).toBeTruthy();
      expect(label.textContent).toBe('The void stirs...');
    });

    test('second showVoidFade updates the label in place (no duplicate)', () => {
      ls.showVoidFade('First label');
      ls.showVoidFade('Second label');
      // Count how many fades exist in the body tree
      const fades = document.body.children.filter(c => c.id === 'neuma-void-fade');
      expect(fades.length).toBe(1);
      const label = fades[0].querySelector('.neuma-void-fade__label');
      expect(label.textContent).toBe('Second label');
    });

    test('hideVoidFade removes the fade after transition', () => {
      ls.showVoidFade('Temp');
      ls.hideVoidFade();
      // setTimeout is stubbed to fire immediately
      expect(document.getElementById('neuma-void-fade')).toBeNull();
    });

    test('hideVoidFade is safe when nothing is showing', () => {
      expect(() => ls.hideVoidFade()).not.toThrow();
    });
  });

  describe('setStatus / clearStatus', () => {
    test('setStatus mounts a status indicator with label', () => {
      ls.setStatus('Connecting...');
      const el = document.getElementById('neuma-status-indicator');
      expect(el).toBeTruthy();
      const label = el.querySelector('.neuma-status-indicator__label');
      expect(label.textContent).toBe('Connecting...');
    });

    test('setStatus updates label in place on second call', () => {
      ls.setStatus('First');
      ls.setStatus('Second');
      const fades = document.body.children.filter(c => c.id === 'neuma-status-indicator');
      expect(fades.length).toBe(1);
      const label = fades[0].querySelector('.neuma-status-indicator__label');
      expect(label.textContent).toBe('Second');
    });

    test('setStatus with ok variant adds ok class', () => {
      ls.setStatus('Connected', 'ok');
      const el = document.getElementById('neuma-status-indicator');
      expect(el.classList.contains('neuma-status-indicator--ok')).toBe(true);
      expect(el.classList.contains('neuma-status-indicator--error')).toBe(false);
    });

    test('setStatus with error variant adds error class', () => {
      ls.setStatus('Disrupted', 'error');
      const el = document.getElementById('neuma-status-indicator');
      expect(el.classList.contains('neuma-status-indicator--error')).toBe(true);
    });

    test('setStatus switching variants clears previous', () => {
      ls.setStatus('Loading...');
      ls.setStatus('Error!', 'error');
      ls.setStatus('Ok!', 'ok');
      const el = document.getElementById('neuma-status-indicator');
      expect(el.classList.contains('neuma-status-indicator--ok')).toBe(true);
      expect(el.classList.contains('neuma-status-indicator--error')).toBe(false);
    });

    test('clearStatus removes the indicator', () => {
      ls.setStatus('Temp');
      ls.clearStatus();
      expect(document.getElementById('neuma-status-indicator')).toBeNull();
    });

    test('clearStatus is safe when nothing is showing', () => {
      expect(() => ls.clearStatus()).not.toThrow();
    });
  });

  describe('makeStreamPulse', () => {
    test('returns an element with 3 dot children', () => {
      const el = ls.makeStreamPulse();
      expect(el.className).toBe('neuma-stream-pulse');
      expect(el.children.length).toBe(3);
      expect(el.children.every(c => c.className === 'neuma-stream-pulse__dot')).toBe(true);
    });

    test('each call returns a fresh element', () => {
      const a = ls.makeStreamPulse();
      const b = ls.makeStreamPulse();
      expect(a).not.toBe(b);
      expect(a.children).not.toBe(b.children);
    });
  });
});
