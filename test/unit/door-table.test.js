/**
 * THE DOOR TABLE (show-dont-tell-audit.md pattern 4, slice SDT-2): every door
 * kind → the exact place it lands, its press (≤3 words) and its hover; a
 * failed post's door by why it failed; the hand-over only to a member of this
 * house who wrote the post. Pure functions, real inputs, no double (RULE 0).
 * The landings themselves are proven in real Chromium (sdt-doors-browser).
 */
import { describe, it, expect } from 'vitest';
import { doorPlan } from '../../frontend/app/RelinkShell/doors/door-plan.js';
import { doorLabel, doorPlace } from '../../frontend/app/RelinkShell/doors/door-words.js';
import { failedPostDoor, failedPostHandTo } from '../../frontend/app/RelinkShell/doors/failed-post-door.js';

const words = (label) => label.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

describe('door-plan — each kind lands on its exact place', () => {
  it('keys: Settings → API → Channel keys, the platform, the account row; + ACCOUNT reveals ADD ACCOUNT', () => {
    expect(doorPlan({ kind: 'keys' })).toEqual({ open: 'settings', settingsFocus: 'channel-keys', reveal: null });
    expect(doorPlan({ kind: 'keys', channelId: 'x', accountId: 'x-2' })).toMatchObject({ open: 'settings', settingsFocus: 'channel-keys/x/x-2', reveal: null });
    expect(doorPlan({ kind: 'keys', channelId: 'telegram', add: true })).toEqual({
      open: 'settings', settingsFocus: 'channel-keys/telegram', reveal: '[data-window-id="settings"] .cred-item.is-open .account-add',
    });
  });

  it('marketing: a tab (SEAT by default), a campaign page, or one account on ACCOUNTS — revealed inside MARKETING', () => {
    expect(doorPlan({ kind: 'marketing', tab: 'seat', reveal: '[data-cmo-row]' })).toEqual({
      open: 'marketing', landings: [{ app: 'marketing', item: { tab: 'seat', companyId: null } }], reveal: '[data-window-id="marketing"] [data-cmo-row]',
    });
    expect(doorPlan({ kind: 'marketing', campaignId: 'c1', tab: 'campaigns' }).landings).toEqual([{ app: 'marketing', item: { campaignId: 'c1' } }]);
    expect(doorPlan({ kind: 'marketing', tab: 'accounts', accountId: 'bluesky-1' })).toEqual({
      open: 'marketing',
      landings: [{ app: 'marketing', item: { tab: 'accounts', companyId: null } }, { app: 'social-check', item: { accountId: 'bluesky-1' } }],
      reveal: '[data-window-id="marketing"] .sc-card[data-account="bluesky-1"]',
    });
    expect(doorPlan({ kind: 'marketing' }).landings[0].item.tab).toBe('seat');
  });

  it('queue and chat: a waiting jump onto the card, the sitting; no session → the member\'s newest sitting', () => {
    // A public platform's post is on MARKETING's account level; COMMUNITY's on its own window.
    expect(doorPlan({ kind: 'queue', channelId: 'x', entryId: 'f1' })).toEqual({ jump: { where: { app: 'marketing', channelId: 'x', accountId: null, entryId: 'f1', section: 'posts' } } });
    expect(doorPlan({ kind: 'queue', channelId: 'x', accountId: 'x-2', entryId: 'f1' }).jump.where.accountId).toBe('x-2');
    expect(doorPlan({ kind: 'queue', channelId: 'telegram', entryId: 't1' })).toEqual({ jump: { where: { app: 'telegram', channelId: 'telegram', accountId: null, entryId: 't1', section: 'posts' } } });
    expect(doorPlan({ kind: 'chat', neumaId: 'kestrel', sessionId: 's1' })).toEqual({ jump: { where: { app: 'chat', neumaId: 'kestrel', sessionId: 's1', name: null } } });
    expect(doorPlan({ kind: 'chat', neumaId: 'kestrel', name: 'Kestrel' })).toEqual({ sitting: { neumaId: 'kestrel', name: 'Kestrel' } });
  });

  it('brand, standing and app keep their window\'s own idiom', () => {
    expect(doorPlan({ kind: 'brand', companyId: 'northwind', section: 'sources' })).toEqual({
      open: 'marketing', landings: [{ app: 'marketing', item: { companyId: 'northwind', tab: 'brand' } }], brandSection: { companyId: 'northwind', section: 'sources' },
    });
    expect(doorPlan({ kind: 'standing', channelId: 'x', drawer: 'crew' })).toEqual({
      open: 'marketing', landings: [{ app: 'marketing', item: { account: { channelId: 'x', accountId: null, companyId: null }, section: 'crew' } }],
    });
    expect(doorPlan({ kind: 'standing', channelId: 'telegram', drawer: 'holder' })).toEqual({ open: 'telegram', landings: [{ app: 'telegram', item: { section: 'holder' } }] });
    expect(doorPlan({ kind: 'app', app: 'legal', reveal: '.sec-watch' })).toEqual({ open: 'legal', reveal: '[data-window-id="legal"] .sec-watch' });
  });

  it('account: MARKETING\'s account level — that account, else the first on the platform under the company named', () => {
    expect(doorPlan({ kind: 'account', channelId: 'tiktok', accountId: 'tiktok-2', companyId: 'northwind' })).toEqual({
      open: 'marketing', landings: [{ app: 'marketing', item: { account: { channelId: 'tiktok', accountId: 'tiktok-2', companyId: 'northwind' } } }],
    });
    expect(doorPlan({ kind: 'account', channelId: 'x' }).landings[0].item).toEqual({ account: { channelId: 'x', accountId: null, companyId: null } });
  });

  it('a door that names no place is no door (null), never a guess', () => {
    for (const door of [null, {}, { kind: 'handle' }, { kind: 'queue', channelId: 'x' }, { kind: 'chat' }, { kind: 'standing' }, { kind: 'app' }, { kind: 'account' }]) {
      expect(doorPlan(door)).toBeNull();
    }
  });

  it('a hostile id never breaks out of its attribute selector', () => {
    expect(doorPlan({ kind: 'marketing', tab: 'accounts', accountId: 'x"] body [a="' }).reveal).toBe('[data-window-id="marketing"] .sc-card[data-account="x] body [a="]');
  });
});

describe('door-words — the press is at most three words; the hover says where', () => {
  it('names every kind, and a door\'s own label wins', () => {
    const doors = [
      [{ kind: 'keys' }, 'KEYS'], [{ kind: 'keys', add: true }, '+ ACCOUNT'], [{ kind: 'keys', connect: true }, 'CONNECT'],
      [{ kind: 'marketing', tab: 'seat' }, 'SEAT'], [{ kind: 'marketing', tab: 'accounts', accountId: 'x-1' }, 'ACCOUNTS'],
      [{ kind: 'marketing', tab: 'campaigns' }, 'CAMPAIGNS'], [{ kind: 'marketing', tab: 'seat', label: 'SEAT A CMO' }, 'SEAT A CMO'],
      [{ kind: 'app', app: 'security' }, 'SECURITY'], [{ kind: 'chat', neumaId: 'k' }, 'CHAT'], [{ kind: 'queue' }, 'QUEUE'],
      [{ kind: 'account', channelId: 'x' }, 'ACCOUNT'],
    ];
    for (const [door, label] of doors) {
      expect(doorLabel(door)).toBe(label);
      expect(words(doorLabel(door))).toBeLessThanOrEqual(3);
    }
    expect(doorPlace({ kind: 'marketing', tab: 'accounts', accountId: 'x-1' })).toBe('MARKETING → ACCOUNTS → x-1');
    expect(doorPlace({ kind: 'keys', channelId: 'telegram', add: true }, 'Telegram')).toBe('Settings → API → Channel keys → Telegram');
    expect(doorPlace({ kind: 'standing', channelId: 'x', accountId: 'x-1', drawer: 'crew' }, 'X')).toBe('MARKETING → X x-1 → STANDING → CREW');
    expect(doorPlace({ kind: 'standing', channelId: 'telegram', drawer: 'holder' }, 'Telegram')).toBe('Telegram → STANDING → HOLDER');
    expect(doorPlace({ kind: 'chat', neumaId: 'kestrel', name: 'Kestrel' })).toBe('Kestrel\'s chat — the newest sitting');
  });
});

describe('failed-post-door — the cause picks the door', () => {
  const failed = (over) => ({ id: 'f1', status: 'failed', channelId: 'x', accountId: 'x-1', error: '', ...over });

  it('keys refused → that account\'s keys row; the platform stumbled → TRY AGAIN; the words refused → REVISE', () => {
    // again: TRY AGAIN stands beside the door only where nothing went out (keys, retry)
    expect(failedPostDoor(failed({ error: 'Unauthorized', errorStatus: 401 }))).toEqual({ cause: 'keys', door: { kind: 'keys', channelId: 'x', accountId: 'x-1' }, label: 'FIX KEYS', again: true });
    expect(failedPostDoor(failed({ error: 'X credentials are not configured' })).cause).toBe('keys');
    expect(failedPostDoor(failed({ error: 'X answered HTTP 503' }))).toEqual({ cause: 'retry', door: { kind: 'queue', channelId: 'x', entryId: 'f1' }, label: 'TRY AGAIN', again: true });
    expect(failedPostDoor(failed({ error: 'Service Unavailable', errorStatus: 503 })).cause).toBe('retry');
    expect(failedPostDoor(failed({ error: 'You are not allowed to create a Tweet with duplicate content.', errorStatus: 403 })))
      .toEqual({ cause: 'content', door: { kind: 'queue', channelId: 'x', entryId: 'f1' }, label: 'REVISE', again: false });
    expect(failedPostDoor(failed({ error: 'the author is no longer on the crew of x-1, or x-1 has no holder — approval does not outlive membership' })))
      .toEqual({ cause: 'standing', door: { kind: 'standing', channelId: 'x', drawer: 'holder' }, label: 'HOLDER', again: false });
  });

  it('a send whose outcome is unknown, or anything else, has no door (its card says why); nor has a post that did not fail', () => {
    expect(failedPostDoor(failed({ error: 'publishing was interrupted; the outcome is unknown — check LinkedIn before retrying' }))).toBeNull();
    expect(failedPostDoor(failed({ error: 'fetch failed' }))).toBeNull();
    expect(failedPostDoor({ ...failed({ error: 'X answered HTTP 503' }), status: 'sent' })).toBeNull();
  });

  it('HAND TO only the member of this house who wrote a post refused for its words, the ask drafted with acts it has', () => {
    const roster = [{ neumaId: 'kestrel', name: 'Kestrel', participantKind: 'neuma' }, { neumaId: 'witness-x', name: 'Peer', participantKind: 'witness' }];
    const refused = failed({ error: 'duplicate content', errorStatus: 403, authorNeumaId: 'kestrel', campaignId: 'c1' });
    const handTo = failedPostHandTo(refused, roster);
    expect(handTo).toMatchObject({ neumaId: 'kestrel', name: 'Kestrel' });
    expect(handTo.prompt).toContain('queue_get f1');
    expect(handTo.prompt).toContain('social/queue on the same account and campaign');
    expect(handTo.prompt).toContain('I will decide the new card.');
    // Not this house's member, a witness, the operator's own post, or a failure that is not the words: no hand-over.
    expect(failedPostHandTo({ ...refused, authorNeumaId: 'stranger' }, roster)).toBeNull();
    expect(failedPostHandTo({ ...refused, authorNeumaId: 'witness-x' }, roster)).toBeNull();
    expect(failedPostHandTo({ ...refused, authorNeumaId: null }, roster)).toBeNull();
    expect(failedPostHandTo(failed({ error: 'X answered HTTP 503', authorNeumaId: 'kestrel' }), roster)).toBeNull();
  });
});
