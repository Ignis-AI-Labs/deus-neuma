/**
 * The SOCIAL CHECK's pieces through a real react-dom render (no mock), over a
 * report the real rules built: an account is one card whose checks are
 * marks, never rows of text; only the focused card opens its fixes, each a
 * short title and a door; the @handle is fixed in place; HAND TO names the
 * member only where the rule says one can do it; the guided path numbers the
 * fixes; OPTIONAL stands folded and says so.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildHouseCheck } from '../../backend/services/social/house-check/house-check.js';
import { AccountCard, GuidedPath, OptionalGroup } from '../../frontend/app/RelinkShell/social-check/SocialCheckParts.jsx';
import { fixSteps } from '../../frontend/app/RelinkShell/social-check/social-check-view.js';

const NOW = Date.parse('2026-10-24T09:00:00Z');
const field = (key) => ({ key, label: key, set: true, source: 'store' });
const factsOf = ({ account = {}, ...over } = {}) => ({
  account: { id: 'x-1', channelId: 'x', channelName: 'X', companyId: 'umbrae', configured: true, label: '', fields: [field('accessToken')], expectedHandle: 'core_voice', platformUserId: null, ...account },
  house: 'house-a', now: NOW, envNames: {}, probe: { ok: true, account: { id: '101', name: 'core_voice' } },
  holder: { neumaId: 'kestrel', external: false, house: 'house-a', name: 'Kestrel' }, crew: [], meta: { grantedScope: '', tokenExpiresAt: '' },
  shared: { channelName: 'X', sameUser: [], sameKeys: [], otherTree: false, otherHouse: false, envOtherHouse: false },
  file: { exists: true, path: '/p', mode: 0o600, dirMode: 0o700 }, live: [],
  company: { id: 'umbrae', name: 'Umbrae', site: { url: 'https://example.com/umbrae' } }, campaigns: [], quota: null, ...over,
});
const REPORT = buildHouseCheck({
  accounts: [
    factsOf(),
    factsOf({
      account: { id: 'x-2', expectedHandle: null }, company: { id: 'umbrae', name: 'Umbrae', site: null },
      live: [{ id: 'aaaabbbbccccdddd', channelId: 'x', authorNeumaId: 'kestrel', text: 'Before the ruling.', status: 'draft', media: [{ path: '/tmp/card.png', alt: 'the card' }] }],
    }),
    // In use through its part in an active campaign alone: no keys, no holder.
    { ...factsOf({ account: { id: 'x-3', configured: false, fields: [{ ...field('accessToken'), set: false }] } }), holder: null, campaigns: ['launch'] },
  ],
  companies: [{ id: 'umbrae', name: 'Umbrae', parentId: null, rootId: 'umbrae', depth: 0 }],
  channels: [{ id: 'x', name: 'X' }, { id: 'bluesky', name: 'Bluesky' }],
  checkedAt: new Date(NOW).toISOString(),
  probed: true,
});
const rowOf = (id) => REPORT.accounts.find((a) => a.id === id);
const ACTS = { canOpen: true, onDoor: () => {}, onHand: () => {}, onRecord: () => {}, recording: null, handed: {} };
const card = (id, focused) => renderToStaticMarkup(createElement(AccountCard, { row: rowOf(id), companyName: 'Umbrae', focused, onPick: () => {}, acts: ACTS }));
const count = (html, re) => (html.match(re) || []).length;

describe('an account is one card of marks', () => {
  it('a clear account: its AccountMark (platform + @handle), ● and thirteen marks — not one sentence of text', () => {
    const html = card('x-1', false);
    // Off the desk the mark is only the mark; on it, the same mark is the door to the account level (browser test).
    expect(html).toMatch(/<span class="acm[^"]*" data-account-mark="x-1"[^>]*>.*<span class="acm-name">@core_voice<\/span><\/span>/);
    expect(html).toContain('<span class="sc-verdict is-clear" aria-hidden="true">●</span>');
    expect(count(html, /class="sc-check is-/g)).toBe(13);
    expect(count(html, /class="sc-check is-pass"/g)).toBe(10);
    expect(count(html, /class="sc-check is-na"/g)).toBe(3);
    // The words live on hover only: no fix list, and no check sentence as text.
    expect(html).not.toContain('sc-fixes');
    expect(html.replace(/ (title|aria-label)="[^"]*"/g, '')).not.toContain('Every key it needs is in place.');
    expect(html).toContain('title="Keys present — clear · Every key it needs is in place."');
  });

  it('a card that is not focused keeps its fixes folded into its marks', () => {
    const html = card('x-2', false);
    expect(html).toContain('sc-verdict is-fail');
    expect(count(html, /class="sc-check is-fail"/g)).toBe(3);
    expect(html).not.toContain('sc-fixes');
  });

  it('the focused card opens its fixes: titles, doors, the @handle in place, HAND TO only where the rule names a member', () => {
    const html = card('x-2', true);
    const titles = [...html.matchAll(/<span class="sc-fix-title"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(titles).toEqual(['Record the @handle', 'Mark the images', 'Add the company site']);
    expect(html).toContain('data-handle-for="x-2"');
    expect(html).toContain('value="core_voice"');
    expect(html).toContain('>QUEUE →</button>');
    expect(html).toContain('>SITE &amp; CODE →</button>');
    expect(count(html, /HAND TO KESTREL/g)).toBe(1);
  });

  it('keys are the operator\'s: the keys fix is a door, never a hand-over', () => {
    const html = card('x-3', true);
    expect(html).toContain('>Add the keys</span>');
    expect(html).toContain('>KEYS →</button>');
    expect(html).toContain('>Seat a holder</span>');
    expect(html).toContain('>HOLDER →</button>');
    expect(html).not.toContain('HAND TO');
  });

  it('with no desk to open them on, the doors stand disabled and say why', () => {
    const html = renderToStaticMarkup(createElement(AccountCard, { row: rowOf('x-3'), focused: true, onPick: () => {}, acts: { ...ACTS, canOpen: false } }));
    expect(html).toContain('disabled="" title="open the check from the desk to use its doors"');
  });
});

describe('the guided path and OPTIONAL', () => {
  it('numbers every fix across the accounts, each a door', () => {
    const html = renderToStaticMarkup(createElement(GuidedPath, { steps: fixSteps(REPORT), channelNames: REPORT.channelNames, onStep: () => {} }));
    const steps = [...html.matchAll(/<b class="sc-step-n">(\d+)<\/b><span class="sc-step-t">([^<]*)</g)].map((m) => `${m[1]} ${m[2]}`);
    expect(steps).toEqual(['1 Record the @handle', '2 Mark the images', '3 Add the company site', '4 Add the keys', '5 Seat a holder']);
    expect(count(html, /<button/g)).toBe(5);
  });

  it('OPTIONAL stands folded, its count kept, and says it is folded', () => {
    const html = renderToStaticMarkup(createElement(OptionalGroup, { optional: { accounts: ['x-9'], platforms: ['bluesky'] }, channelNames: REPORT.channelNames }));
    expect(html).toMatch(/^<details class="sc-optional">/);
    expect(html).toContain('OPTIONAL <b>2</b> · NOT COUNTED · FOLDED');
    expect(html).toContain('Bluesky');
    expect(renderToStaticMarkup(createElement(OptionalGroup, { optional: { accounts: [], platforms: [] }, channelNames: {} }))).toBe('');
  });
});
