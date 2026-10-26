/**
 * MARKETING slice 6 — ONE WINDOW (marketing-panel-plan.md §5): the pure law.
 * The retired windows' ids (retired-windows.js) open MARKETING at their place;
 * a saved layout folds into one MARKETING; a pin moves with it; COMMUNITY's
 * platforms keep their windows. The account level (account-level.js): which
 * account a landing means, under which company, and the path's last crumb.
 * Pure functions on real inputs — no double anywhere (RULE 0).
 */
import { describe, it, expect } from 'vitest';
import {
  MARKETING_PLATFORMS, redirectAction, retiredPlace, marketingLandingOf, migrateOpenSet, migrateAppIds,
} from '../../frontend/app/windowing/retired-windows.js';
import { DOCK_GROUPS } from '../../frontend/app/windowing/dock-groups.js';
import { settleAccount, accountLanding, accountCrumb } from '../../frontend/app/RelinkShell/marketing/account-level.js';
import { settlePlace } from '../../frontend/app/RelinkShell/marketing/zoom-fold.js';

const COMPANIES = [
  { id: 'northwind', name: 'Northwind', parentId: null, depth: 0 },
  { id: 'labs', name: 'Northwind Labs', parentId: 'northwind', depth: 1 },
  { id: 'brookmere', name: 'Brookmere', parentId: null, depth: 0 },
];
const ACCOUNTS = [
  { id: 'x-1', channelId: 'x', channelName: 'X', companyId: 'brookmere', expectedHandle: 'brook' },
  { id: 'x-2', channelId: 'x', channelName: 'X', companyId: 'labs', expectedHandle: '@labs_voice' },
  { id: 'tiktok-1', channelId: 'tiktok', channelName: 'TikTok', companyId: null },
  { id: 'telegram-1', channelId: 'telegram', channelName: 'Telegram', companyId: 'northwind' },
];
const QUEUE = [{ id: 'p1', channelId: 'x', accountId: 'x-2' }, { id: 'p2', channelId: 'x' }];
const HOUSE = { accounts: ACCOUNTS, companies: COMPANIES };

describe('the retired windows open MARKETING at their place', () => {
  it('each public platform → its account level; SOCIAL CHECK, BRAND KITS, LEADS → their tabs; COMMUNITY\'s stay', () => {
    expect(MARKETING_PLATFORMS).toEqual(['x', 'facebook', 'mastodon', 'bluesky', 'linkedin', 'youtube', 'tiktok']);
    for (const id of MARKETING_PLATFORMS) expect(retiredPlace(id)).toEqual({ account: { channelId: id } });
    expect(retiredPlace('socialCheck')).toEqual({ tab: 'accounts' });
    expect(retiredPlace('brandKits')).toEqual({ tab: 'brand' });
    expect(retiredPlace('leads')).toEqual({ tab: 'leads' });
    for (const id of ['telegram', 'discord', 'marketing', 'chat', '__proto__', 'hasOwnProperty', null, 7]) expect(retiredPlace(id)).toBeNull();
  });

  it('an OPEN (or TOGGLE) of one is an OPEN of MARKETING plus its landing; every other action passes untouched', () => {
    expect(redirectAction({ type: 'OPEN', id: 'tiktok' })).toEqual({ action: { type: 'OPEN', id: 'marketing' }, landing: { account: { channelId: 'tiktok' } } });
    expect(redirectAction({ type: 'TOGGLE', id: 'leads' })).toEqual({ action: { type: 'TOGGLE', id: 'marketing' }, landing: { tab: 'leads' } });
    for (const action of [{ type: 'OPEN', id: 'telegram' }, { type: 'CLOSE', id: 'x' }, { type: 'FOCUS', id: 'x' }, { type: 'OPEN_NEW', appId: 'terminal' }]) {
      expect(redirectAction(action)).toEqual({ action, landing: null });
    }
  });

  it('a landing latched for a public platform\'s window is MARKETING\'s account landing; any other app\'s stands', () => {
    expect(marketingLandingOf('x', { entryId: 'p1', section: 'posts', accountId: 'x-2' }))
      .toEqual({ entryId: 'p1', section: 'posts', account: { channelId: 'x', accountId: 'x-2' } });
    expect(marketingLandingOf('bluesky', { section: 'holder' })).toEqual({ section: 'holder', account: { channelId: 'bluesky', accountId: null } });
    expect(marketingLandingOf('telegram', { entryId: 't1' })).toBeNull();
    expect(marketingLandingOf('gallery', { imageId: 'i' })).toBeNull();
  });

  it('a saved layout folds into ONE MARKETING at the first old window\'s place — never a blank window', () => {
    expect(migrateOpenSet([{ id: 'chat' }, { id: 'tiktok' }, { id: 'x' }, { id: 'brandKits' }, { id: 'telegram' }]))
      .toEqual({ list: [{ id: 'chat' }, { id: 'marketing' }, { id: 'telegram' }], landing: { account: { channelId: 'tiktok' } } });
    // MARKETING already open: its own remembered place stands.
    expect(migrateOpenSet([{ id: 'marketing' }, { id: 'socialCheck' }])).toEqual({ list: [{ id: 'marketing' }], landing: null });
    expect(migrateOpenSet([{ id: 'leads' }])).toEqual({ list: [{ id: 'marketing' }], landing: { tab: 'leads' } });
    expect(migrateOpenSet(null)).toEqual({ list: [], landing: null });
    expect(migrateOpenSet([null, { id: 'files' }]).list).toEqual([null, { id: 'files' }]);
  });

  it('pins move with it: MARKETING once, where the first stood', () => {
    expect(migrateAppIds(['chat', 'x', 'leads', 'marketing', 'discord'])).toEqual(['chat', 'marketing', 'discord']);
    expect(migrateAppIds(undefined)).toEqual([]);
  });

  it('the dock: MARKETING alone in its section; COMMUNITY exactly TELEGRAM and DISCORD', () => {
    expect(DOCK_GROUPS.find((g) => g.id === 'marketing').apps).toEqual(['marketing']);
    expect(DOCK_GROUPS.find((g) => g.id === 'community').apps).toEqual(['discord', 'telegram']);
    const named = DOCK_GROUPS.flatMap((g) => g.apps);
    for (const id of [...MARKETING_PLATFORMS, 'socialCheck', 'brandKits', 'leads']) expect(named).not.toContain(id);
  });
});

describe('the account level: which account, under which company', () => {
  it('the named account; its company is the level\'s (HOUSE for none); a gone account falls to the platform\'s first', () => {
    expect(settleAccount({ channelId: 'x', accountId: 'x-2' }, HOUSE)).toEqual({ companyId: 'labs', account: { channelId: 'x', accountId: 'x-2' } });
    expect(settleAccount({ channelId: 'tiktok', accountId: 'tiktok-1' }, HOUSE)).toEqual({ companyId: null, account: { channelId: 'tiktok', accountId: 'tiktok-1' } });
    expect(settleAccount({ channelId: 'x', accountId: 'x-9' }, HOUSE).account.accountId).toBe('x-1');
  });

  it('no account named: the first on the platform under the company named (any depth), else the house\'s first', () => {
    expect(settleAccount({ channelId: 'x', companyId: 'northwind' }, HOUSE).account.accountId).toBe('x-2');
    expect(settleAccount({ channelId: 'x' }, HOUSE).account.accountId).toBe('x-1');
  });

  it('a platform with no account still lands (where the first is added); COMMUNITY\'s is no account level', () => {
    expect(settleAccount({ channelId: 'youtube', companyId: 'labs' }, HOUSE)).toEqual({ companyId: 'labs', account: { channelId: 'youtube', accountId: null } });
    expect(settleAccount({ channelId: 'youtube', companyId: 'gone' }, HOUSE).companyId).toBeNull();
    expect(settleAccount({ channelId: 'telegram', accountId: 'telegram-1' }, HOUSE)).toBeNull();
    expect(settleAccount(null, HOUSE)).toBeNull();
  });

  it('a post\'s landing finds the account it speaks as — waiting while the queue is unread', () => {
    const item = { account: { channelId: 'x', accountId: null }, entryId: 'p1', section: 'posts' };
    expect(accountLanding(item, { ...HOUSE, queue: null })).toBeNull();
    expect(accountLanding(item, { ...HOUSE, queue: QUEUE })).toEqual({
      place: { companyId: 'labs', tab: 'board', campaignId: null, account: { channelId: 'x', accountId: 'x-2' } },
      focus: { entryId: 'p1', section: 'posts' },
    });
    // An entry naming no account speaks as its platform's first (x-1).
    expect(accountLanding({ ...item, entryId: 'p2' }, { ...HOUSE, queue: QUEUE }).place.account.accountId).toBe('x-1');
    expect(accountLanding({ account: { channelId: 'x', accountId: 'x-1' }, section: 'holder' }, { ...HOUSE, queue: null }).focus).toEqual({ entryId: null, section: 'holder' });
    expect(accountLanding({ account: { channelId: 'tiktok' } }, { ...HOUSE, queue: null }).focus).toBeNull();
  });

  it('settlePlace keeps an account level under its account\'s company, and a company level carries none', () => {
    expect(settlePlace({ companyId: 'northwind', tab: 'leads', account: { channelId: 'x', accountId: 'x-2' } }, COMPANIES, ACCOUNTS))
      .toEqual({ companyId: 'labs', tab: 'board', campaignId: null, account: { channelId: 'x', accountId: 'x-2' } });
    expect(settlePlace({ companyId: 'labs', tab: 'leads', account: { channelId: 'telegram' } }, COMPANIES, ACCOUNTS))
      .toEqual({ companyId: 'labs', tab: 'leads', campaignId: null, account: null });
  });

  it('the path\'s last crumb: the platform and the handle, else its number; none when there is no account', () => {
    expect(accountCrumb({ channelId: 'x', accountId: 'x-2' }, ACCOUNTS)).toEqual({ channelId: 'x', name: 'X', handle: '@labs_voice', title: 'X · account x-2' });
    expect(accountCrumb({ channelId: 'tiktok', accountId: 'tiktok-1' }, ACCOUNTS).handle).toBe('#1');
    expect(accountCrumb({ channelId: 'youtube', accountId: null }, ACCOUNTS)).toEqual({ channelId: 'youtube', name: 'YOUTUBE', handle: null, title: 'YOUTUBE · no account yet' });
  });
});
