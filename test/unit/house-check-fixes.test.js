/**
 * THE HOUSE SOCIAL CHECK's fixes as data (SHOW, DON'T TELL, 2026-10-24): each
 * failing check carries `fix: { title, words, door, handTo? }` — a short
 * title, the sentence it always said, the door that lands on the exact place,
 * and a hand-over only where a member of THIS house can do the fix with an
 * act it already files. Pure: the real rules over real fact objects, no
 * double anywhere (RULE 0). Also the desk's guided path over those fixes and
 * the being's words.
 */
import { describe, it, expect } from 'vitest';
import { checkAccount } from '../../backend/services/social/house-check/check-rules.js';
import { buildHouseCheck } from '../../backend/services/social/house-check/house-check.js';
import { formatHouseCheckForBeing } from '../../backend/services/social/house-check/house-check-words.js';
import { fixSteps, doorLabel, doorPlace, fixesOf } from '../../frontend/app/RelinkShell/social-check/social-check-view.js';

const NOW = Date.parse('2026-10-24T09:00:00Z');
const field = (key, over = {}) => ({ key, label: key, set: true, source: 'store', ...over });
const accountOf = (over = {}) => ({
  id: 'x-1', channelId: 'x', channelName: 'X', companyId: 'ignis', configured: true, label: '',
  fields: [field('accessToken'), field('accessSecret')], expectedHandle: 'core_voice', platformUserId: null, ...over,
});
const factsOf = ({ account = {}, ...over } = {}) => ({
  account: accountOf(account),
  house: 'house-a',
  now: NOW,
  envNames: { accessToken: 'X_ACCESS_TOKEN', accessSecret: 'X_ACCESS_SECRET' },
  probe: { ok: true, account: { id: '101', name: 'core_voice' } },
  holder: { neumaId: 'kestrel', external: false, house: 'house-a', name: 'Kestrel' },
  crew: [],
  meta: { grantedScope: '', tokenExpiresAt: '' },
  shared: { channelName: 'X', sameUser: [], sameKeys: [], otherTree: false, otherHouse: false, envOtherHouse: false },
  file: { exists: true, path: '/house/keys.json', mode: 0o600, dirMode: 0o700 },
  live: [],
  company: { id: 'ignis', name: 'Ignis', site: { url: 'https://example.com' } },
  campaigns: [],
  quota: null,
  ...over,
});
const checkOf = (facts, id) => checkAccount(facts).find((c) => c.id === id);
// A being's post staged before the AI disclosure moved into metadata (2026-10-30): its image's alt text unmarked.
const BARE = [{ id: 'aaaabbbbccccdddd', channelId: 'x', authorNeumaId: 'kestrel', text: 'Written before the ruling.', status: 'draft', media: [{ path: '/tmp/card.png', alt: 'the card' }] }];

describe('every failing check names its fix as data', () => {
  it('a clear account owes nothing: no check carries a fix', () => {
    const checks = checkAccount(factsOf());
    expect(checks.every((c) => c.verdict === 'pass' || c.verdict === 'na')).toBe(true);
    expect(checks.filter((c) => c.fix)).toEqual([]);
  });

  it('keys: pasted keys land on the account\'s row; sign-in keys on its CONNECT', () => {
    const pasted = checkOf(factsOf({ account: { configured: false, fields: [field('accessToken', { set: false })] } }), 'keys');
    expect(pasted.verdict).toBe('fail');
    expect(pasted.fix).toEqual({ title: 'Add the keys', words: 'Add them in Settings → API → Channel keys → X.', door: { kind: 'keys', channelId: 'x', accountId: 'x-1' } });
    const signIn = checkOf(factsOf({ account: { configured: false, fields: [field('accessToken', { set: false, connect: true })] } }), 'keys');
    expect(signIn.fix).toMatchObject({ title: 'Connect the account', door: { kind: 'keys', accountId: 'x-1', connect: true } });
    expect(signIn.fix.handTo).toBeUndefined();
  });

  it('live and right-account: replace the keys, record the @handle in place (seeded with what answered), or fix keys or handle', () => {
    const live = checkOf(factsOf({ probe: { ok: false, status: 401, detail: 'Unauthorized' } }), 'live');
    expect(live.fix).toMatchObject({ title: 'Replace the keys', door: { kind: 'keys', accountId: 'x-1' } });
    const none = checkOf(factsOf({ account: { expectedHandle: null } }), 'right-account');
    expect(none.fix).toMatchObject({ title: 'Record the @handle', door: { kind: 'handle', accountId: 'x-1', channelId: 'x', seen: 'core_voice' } });
    expect(none.fix.words).toBe('Record its expected @handle in the house social check.');
    const unseen = checkOf(factsOf({ account: { expectedHandle: null }, probe: { ok: false } }), 'right-account');
    expect(unseen.fix.door.seen).toBeNull();
    const renamed = checkOf(factsOf({ account: { expectedHandle: 'old_name' } }), 'right-account');
    expect(renamed.fix).toMatchObject({ title: 'Fix the keys or @handle', door: { kind: 'handle', seen: 'core_voice' } });
    const swapped = checkOf(factsOf({ account: { platformUserId: '999' } }), 'right-account');
    expect(swapped.fix).toMatchObject({ title: 'Use the right account', door: { kind: 'keys', accountId: 'x-1' } });
  });

  it('company: pick it on the account\'s row; a company with no kit opens the house\'s brand kits', () => {
    const unsorted = checkOf(factsOf({ account: { companyId: null }, company: null }), 'company');
    expect(unsorted.fix).toMatchObject({ title: 'Pick its company', door: { kind: 'keys', accountId: 'x-1' } });
    expect(unsorted.fix.door.connect).toBeUndefined();
    const noKit = checkOf(factsOf({ account: { companyId: 'ghost' }, company: null }), 'company');
    expect(noKit.fix).toMatchObject({ title: 'Create the brand kit', door: { kind: 'brand', companyId: null, section: null } });
  });

  it('holder and crew: the platform\'s STANDING, on the holder or the crew drawer — the operator\'s seat, never handed', () => {
    for (const holder of [null, { neumaId: 'witness-x-Sorrel', external: true, house: null }, { neumaId: 'beta', external: false, house: 'house-b' }]) {
      const c = checkOf(factsOf({ holder }), 'holder');
      expect(c.fix.door).toEqual({ kind: 'standing', channelId: 'x', accountId: 'x-1', drawer: 'holder' });
      expect(c.fix.handTo).toBeUndefined();
    }
    expect(checkOf(factsOf({ holder: null }), 'holder').fix.title).toBe('Seat a holder');
    const crew = checkOf(factsOf({ crew: [{ neumaId: 'beta', external: false, house: 'house-b' }] }), 'crew');
    expect(crew.fix).toMatchObject({ title: 'Release from the crew', door: { kind: 'standing', drawer: 'crew' } });
  });

  it('scopes, token, sharing and the keys file: each lands in Channel keys (the file on the section, not a row)', () => {
    const tiktok = factsOf({ account: { id: 'tiktok-1', channelId: 'tiktok', channelName: 'TikTok', fields: [field('accessToken', { connect: true })] } });
    expect(checkOf(tiktok, 'scopes').fix).toMatchObject({ title: 'Grant every permission', door: { kind: 'keys', accountId: 'tiktok-1', connect: true } });
    const linkedin = factsOf({
      account: { id: 'linkedin-1', channelId: 'linkedin', channelName: 'LinkedIn' },
      meta: { grantedScope: '', tokenExpiresAt: new Date(NOW + 2 * 864e5).toISOString() },
    });
    expect(checkOf(linkedin, 'token').fix).toMatchObject({ title: 'Renew the token', door: { kind: 'keys', accountId: 'linkedin-1' } });
    const shared = checkOf(factsOf({ shared: { channelName: 'X', sameUser: ['x-2'], sameKeys: [], otherTree: false, otherHouse: false, envOtherHouse: false } }), 'not-shared');
    expect(shared.fix).toMatchObject({ title: 'Remove the duplicate', door: { kind: 'keys', accountId: 'x-1' } });
    const env = checkOf(factsOf({ shared: { channelName: 'X', sameUser: [], sameKeys: [], otherTree: false, otherHouse: false, envOtherHouse: true } }), 'not-shared');
    expect(env.fix.title).toBe('Store the house\'s own keys');
    const file = checkOf(factsOf({ file: { exists: true, path: '/p', mode: 0o644, dirMode: 0o755 } }), 'file');
    expect(file.fix).toMatchObject({ title: 'Lock the keys file', door: { kind: 'keys', channelId: null, accountId: null } });
  });

  it('site: MARKETING → that company → BRAND → SITE & CODE; with no CMO seated it is never handed', () => {
    const site = checkOf(factsOf({ company: { id: 'umbrae', name: 'Umbrae', site: null } }), 'site');
    expect(site.fix).toEqual({
      title: 'Add the company site', words: 'Add its site in MARKETING → Umbrae → BRAND → SITE & CODE.',
      door: { kind: 'brand', companyId: 'umbrae', section: 'sources' },
    });
  });

  it('site: handed to the house\'s seated CMO, who proposes it (marketing/company-links) and the operator approves', () => {
    const cmo = { neumaId: 'osprey', external: false, house: 'house-a', name: 'Osprey' };
    const site = checkOf(factsOf({ company: { id: 'umbrae', name: 'Umbrae', site: null }, cmo }), 'site');
    expect(site.fix.handTo).toMatchObject({ neumaId: 'osprey', name: 'Osprey', role: 'cmo' });
    expect(site.fix.handTo.prompt).toContain('propose it with marketing/company-links (company: umbrae');
    // Another house's CMO is no CMO here.
    expect(checkOf(factsOf({ company: { id: 'umbrae', name: 'Umbrae', site: null }, cmo: { ...cmo, house: 'house-b' } }), 'site').fix.handTo).toBeUndefined();
  });

  it('quota: the platform\'s queue, where the posts are spread', () => {
    const quota = checkOf(factsOf({ quota: { problems: ['15 posts a day is the app\'s limit; the plan has 18 on 2026-10-25.'], words: '' } }), 'quota');
    expect(quota.fix).toMatchObject({ title: 'Spread the posts', door: { kind: 'queue', channelId: 'x', accountId: 'x-1', entryId: null } });
  });
});

describe('the disclosure fix — the one a member can do', () => {
  it('lands on the first unmarked post, and hands to the holder: update its media with queue_update, the words untouched', () => {
    const c = checkOf(factsOf({ live: BARE }), 'disclosure');
    expect(c.fix.title).toBe('Mark the images');
    expect(c.fix.door).toEqual({ kind: 'queue', channelId: 'x', accountId: 'x-1', entryId: 'aaaabbbbccccdddd' });
    expect(c.fix.handTo).toMatchObject({ neumaId: 'kestrel', name: 'Kestrel', role: 'holder' });
    expect(c.fix.handTo.prompt).toContain('aaaabbbbccccdddd');
    expect(c.fix.handTo.prompt).toContain('x-1');
    expect(c.fix.handTo.prompt).toContain('queue_update');
    expect(c.fix.handTo.prompt).toContain('The words stay as they are.');
    expect(c.fix.handTo.prompt).toContain('I will decide each card.');
  });

  it('is the operator\'s alone when no holder of THIS house can stage: none, a witness, another house\'s lane, or no keys', () => {
    for (const over of [
      { holder: null },
      { holder: { neumaId: 'witness-x-Sorrel', external: true, house: null } },
      { holder: { neumaId: 'beta', external: false, house: 'house-b', name: 'Beta' } },
      { account: { configured: false } },
    ]) {
      const c = checkOf(factsOf({ live: BARE, ...over }), 'disclosure');
      expect(c.verdict).toBe('fail');
      expect(c.fix.handTo).toBeUndefined();
    }
  });
});

describe('the guided path and the being\'s words over the fixes', () => {
  const report = () => buildHouseCheck({
    accounts: [
      factsOf({ company: { id: 'umbrae', name: 'Umbrae', site: null }, account: { companyId: 'umbrae', expectedHandle: null }, file: { exists: true, path: '/p', mode: 0o644, dirMode: 0o700 } }),
      factsOf({ company: { id: 'umbrae', name: 'Umbrae', site: null }, account: { id: 'x-2', companyId: 'umbrae' }, file: { exists: true, path: '/p', mode: 0o644, dirMode: 0o700 }, live: BARE }),
    ],
    companies: [{ id: 'umbrae', name: 'Umbrae', parentId: null, rootId: 'umbrae', depth: 0 }],
    channels: [{ id: 'x', name: 'X' }, { id: 'bluesky', name: 'Bluesky' }],
    checkedAt: new Date(NOW).toISOString(),
    probed: true,
  });

  it('numbers every fix once: one site step and one keys-file step for both accounts, the rest per account, in reading order', () => {
    const steps = fixSteps(report());
    expect(steps.map((s) => [s.n, s.title, s.accounts])).toEqual([
      [1, 'Record the @handle', ['x-1']],
      [2, 'Lock the keys file', ['x-1', 'x-2']],
      [3, 'Add the company site', ['x-1', 'x-2']],
      [4, 'Mark the images', ['x-2']],
    ]);
    expect(steps[3].handTo).toMatchObject({ neumaId: 'kestrel' });
    expect(steps.slice(0, 3).every((s) => s.handTo === null)).toBe(true);
  });

  it('a door says where it lands in a word or two, and in full on hover', () => {
    expect(doorLabel({ kind: 'keys', connect: true })).toBe('CONNECT');
    expect(doorLabel({ kind: 'keys' })).toBe('KEYS');
    expect(doorLabel({ kind: 'brand', section: 'sources' })).toBe('SITE & CODE');
    expect(doorLabel({ kind: 'standing', drawer: 'crew' })).toBe('CREW');
    expect(doorLabel({ kind: 'queue' })).toBe('QUEUE');
    expect(doorPlace({ kind: 'keys', channelId: 'x', accountId: 'x-2' })).toBe('Settings → API → Channel keys → x-2');
    expect(doorPlace({ kind: 'brand', companyId: 'umbrae', section: 'sources' })).toBe('MARKETING → umbrae → BRAND → SITE & CODE');
    // A public platform's STANDING is on MARKETING's account level (slice 6); COMMUNITY's on its own window.
    expect(doorPlace({ kind: 'standing', channelId: 'x', drawer: 'holder' }, 'X')).toBe('MARKETING → X → STANDING → HOLDER');
    expect(doorPlace({ kind: 'standing', channelId: 'discord', drawer: 'holder' }, 'Discord')).toBe('Discord → STANDING → HOLDER');
  });

  it('only failing checks open as fixes; the report names every platform', () => {
    const r = report();
    expect(fixesOf(r.accounts[0]).map((c) => c.id)).toEqual(['right-account', 'file', 'site']);
    expect(r.channelNames).toEqual({ x: 'X', bluesky: 'Bluesky' });
  });

  it('the being reads the same fix in words', () => {
    const words = formatHouseCheckForBeing(report());
    expect(words).toContain('FAIL Company site on record — Umbrae has no site on record, so there is nothing for a bio link to point to. FIX: Add its site in MARKETING → Umbrae → BRAND → SITE & CODE.');
    expect(words).not.toContain('[object Object]');
  });
});
