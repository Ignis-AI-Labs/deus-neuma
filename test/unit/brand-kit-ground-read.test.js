/**
 * BRAND KITS — a failed house-ground read is said as failed (audit H3,
 * 2026-10-19). getHouseWorkspace answers a failed read with `unread` beside
 * root null; the editor must carry that through and never answer it with
 * […] and the SET THE GROUND form over a ground that
 * may stand. The pure mapping, then the real KitHeader rendered
 * (renderToStaticMarkup); no mocks.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { groundFromRead } from '../../frontend/app/RelinkShell/brandkits/brand-kits-view.js';

let KitHeader;
beforeAll(async () => {
  // The import graph's module-level browser facts — provisioned, never
  // exercised: a static render plays no sound and opens no picker.
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true };
  globalThis.localStorage = globalThis.localStorage ?? {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
  };
  ({ KitHeader } = await import('../../frontend/app/RelinkShell/brandkits/KitHeader.jsx'));
});

const UNREAD = 'Could not read the house ground: 500';

describe('groundFromRead', () => {
  test('a set ground is known, with its root', () => {
    expect(groundFromRead({ root: '/house', repos: [] })).toEqual({ known: true, root: '/house', unread: null });
  });
  test('an unset ground is known, with no root and no failure', () => {
    expect(groundFromRead({ root: null, repos: [] })).toEqual({ known: true, root: null, unread: null });
  });
  test('a failed read keeps its words, never reads as unset', () => {
    expect(groundFromRead({ root: null, repos: [], unread: UNREAD })).toEqual({ known: true, root: null, unread: UNREAD });
  });
});

const header = (ground) => renderToStaticMarkup(createElement(KitHeader, {
  kits: [], totals: { total: 0, ready: 0 }, open: null, detail: null, draft: null, dirty: false,
  saving: false, notice: null, ground, onOpen: () => {}, onNew: () => {}, onSave: () => {}, onGround: () => {}, onRetryGround: () => {},
}));

describe('KitHeader — the ground band says what the read found', () => {
  test('a failed read says it could not read, with RETRY, and offers no SET form', () => {
    const html = header({ known: true, root: null, unread: UNREAD });
    expect(html).toContain('COULD NOT READ THE HOUSE GROUND');
    expect(html).toContain(UNREAD);
    expect(html).toContain('RETRY');
    expect(html).not.toContain('SET THE GROUND');
    expect(html).not.toContain('No house ground is set');
  });
  test('an unset ground still offers SET THE GROUND', () => {
    const html = header({ known: true, root: null, unread: null });
    expect(html).toContain('SET THE GROUND');
    expect(html).not.toContain('COULD NOT READ');
  });
  test('a set ground shows neither band', () => {
    const html = header({ known: true, root: '/house', unread: null });
    expect(html).not.toContain('SET THE GROUND');
    expect(html).not.toContain('COULD NOT READ');
  });
});
