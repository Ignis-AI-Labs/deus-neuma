// The CSO desk panel must RENDER — proven through a real react-dom/server
// render of the real component (no mocks). SSR never fires useEffect, so
// this is the panel's honest initial state: the four sections standing on
// empty data, nothing user-controlled near innerHTML.
//
// The panel's ui-sound import touches window at import time (sound-engine's
// preference listener) — stubbed at the same boundary the jsdom-less suite
// stubs every browser global (voice-sitting-shell.test.js precedent). Set
// BEFORE the import.
import { describe, it, expect, beforeAll } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let GuardianSection;
beforeAll(async () => {
  globalThis.window = globalThis.window || {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  };
  globalThis.Event = globalThis.Event || class Event { constructor(type) { this.type = type; } };
  globalThis.CustomEvent = globalThis.CustomEvent || class CustomEvent extends globalThis.Event {
    constructor(type, init) { super(type); this.detail = init?.detail; }
  };
  const store = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.localStorage = globalThis.localStorage || store;
  globalThis.sessionStorage = globalThis.sessionStorage || store;
  ({ GuardianSection } = await import('../../frontend/app/RelinkShell/GuardianSection.jsx'));
});

describe('GuardianSection — the CSO desk panel', () => {
  it('renders its four sections on first paint (no data yet, no crash)', () => {
    const html = renderToStaticMarkup(createElement(GuardianSection, { beings: [] }));
    expect(html).toContain('THE WATCH');
    expect(html).toContain('CSO'); // the seat section
    expect(html).toContain('THREAT'); // the ledger section
    expect(html).toContain('WATCH'); // the watch-list section
    expect(html).not.toContain('undefined');
  });

  it('first paint is the same honest loading state with beings in hand', () => {
    // The designate select renders only once the seat answer lands — SSR
    // never fires useEffect, so loaded-state markup is the live-fire's proof.
    const html = renderToStaticMarkup(createElement(GuardianSection, {
      beings: [{ neumaId: 'guardianlane', name: 'Bizulen' }],
    }));
    expect(html).toContain('THE CSO SEAT');
    expect(html).toContain('READING THE SEAT');
  });
});
