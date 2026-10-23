/**
 * APPS + ACCOUNTS — the v1 → v2 credential migration and the accounts store
 * (campaign plan slice 2), proven on real tmp disk with the real sealed store,
 * the real kit store and the real campaign bench; no double anywhere (RULE 0).
 *
 * The v1 store is written by the store's own writer (`saveChannelCredentials`
 * — the one every version has used) in the shape the v1 code kept, with
 * placeholder values only: never a real key, never the operator's file.
 *
 * Proven: every platform resolves the SAME credential before and after the
 * migration (the input every identity probe and send uses); the app's fields
 * move to the app and the account's stay on `<channel>-1`; a platform this
 * build does not know is carried, never dropped; the v1 bytes are kept
 * read-only beside the store; a second read migrates nothing; a crash between
 * the backup and the rename is recovered on the next read; another house reads
 * none of it; two companies × two X accounts resolve distinct keys over one
 * shared app; account ids are never reused; the company tree refuses a loop.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { parseAndDecrypt } from '../../core/workspace/workspace-crypto.js';
import {
  saveChannelCredentials, resolveChannelCredential, loadChannelCredentials, setChannelCredential, channelCredentialsPath,
} from '../../backend/services/social/channel-credentials.js';
import {
  loadAccountStore, resolveAccountCredential, listAccounts, addAccount, setAccountFields, setAccountMeta,
  removeAccount, v1BackupPath,
} from '../../backend/services/social/account-store.js';
import { migrateV1 } from '../../backend/services/social/account-migrate.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { listCompanies, setCompanyBlock } from '../../backend/services/marketing/companies.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { writeKit, kitSkeleton } from '../../backend/services/branding/kit-store.js';

// The v1 shape, exactly as the one-account store kept it. Placeholders only.
const V1 = Object.freeze({
  x: { apiKey: 'ph-x-consumer', apiSecret: 'ph-x-consumer-secret', accessToken: 'ph-x-token', accessSecret: 'ph-x-token-secret' },
  youtube: { clientId: 'ph-yt-client.apps.example', clientSecret: 'ph-yt-secret', refreshToken: 'ph-yt-refresh' },
  tiktok: {
    clientKey: 'ph-tt-key', clientSecret: 'ph-tt-secret', refreshToken: 'ph-tt-refresh',
    accessToken: 'ph-tt-access', accessExpiresAt: '2026-10-24T00:00:00.000Z', grantedScope: 'user.info.basic,video.publish',
  },
  telegram: { botToken: 'ph-tg-bot', chatId: '-1001' },
  retiredchannel: { someKey: 'kept-as-is' },
});
const CHANNELS = ['x', 'youtube', 'tiktok', 'telegram'];
const valuesOf = (o) => JSON.stringify(o).match(/ph-[a-z0-9.-]+/g) || [];

describe('apps + accounts — the v1 → v2 migration (real tmp disk)', () => {
  let houses;
  beforeEach(async () => {
    houses = await standTwoHouses({ label: 'account-migration' });
  });
  afterEach(() => houses.restore());

  const writeV1 = async (wallet = HOUSE_A) => {
    await saveChannelCredentials(wallet, V1);
    return fs.readFile(channelCredentialsPath(wallet), 'utf8');
  };
  const decrypted = async (wallet = HOUSE_A) => parseAndDecrypt(await fs.readFile(channelCredentialsPath(wallet), 'utf8'));

  test('every platform resolves the same credential before and after; the shape moves, nothing is lost', async () => {
    // The default company: the kit most of the house's campaigns name.
    const bench = await campaignStoreFor(HOUSE_A);
    await bench.add({ name: 'Bench proof', brand: 'ignis' });
    await bench.add({ name: 'Launch', brand: 'ignis' });
    await bench.add({ name: 'Side note', brand: 'umbrae' });
    const raw = await writeV1();
    const before = {};
    for (const ch of CHANNELS) before[ch] = await resolveChannelCredential(HOUSE_A, ch, V1);
    expect(Object.values(before).every(Boolean)).toBe(true);

    const store = await loadAccountStore(HOUSE_A);
    for (const ch of CHANNELS) {
      expect(await resolveAccountCredential(HOUSE_A, `${ch}-1`)).toEqual(before[ch]);
      expect(await resolveChannelCredential(HOUSE_A, ch)).toEqual(before[ch]);
    }
    const onDisk = await decrypted();
    expect(onDisk).toEqual(store);
    expect(onDisk.v).toBe(2);
    expect(onDisk.apps.x).toEqual({ apiKey: 'ph-x-consumer', apiSecret: 'ph-x-consumer-secret' });
    expect(onDisk.accounts['x-1']).toMatchObject({
      channelId: 'x', companyId: 'ignis', migratedFrom: 'v1',
      fields: { accessToken: 'ph-x-token', accessSecret: 'ph-x-token-secret' },
    });
    expect(Object.keys(onDisk.apps.tiktok)).toEqual(['clientKey', 'clientSecret']);
    expect(Object.keys(onDisk.accounts['tiktok-1'].fields).sort()).toEqual(['accessExpiresAt', 'accessToken', 'grantedScope', 'refreshToken']);
    expect(onDisk.accounts['telegram-1'].fields).toEqual(V1.telegram);
    expect(onDisk.apps.telegram).toBeUndefined();
    expect(onDisk.unplaced).toEqual({ retiredchannel: { someKey: 'kept-as-is' } });
    // Every placeholder value survives exactly once.
    expect(valuesOf(onDisk).sort()).toEqual(valuesOf(V1).sort());
    // The channel view every pre-accounts caller reads is unchanged.
    expect(await loadChannelCredentials(HOUSE_A)).toEqual(Object.fromEntries(CHANNELS.map((ch) => [ch, V1[ch]])));

    // The v1 bytes are kept, read-only; the store stays 0600.
    expect(await fs.readFile(v1BackupPath(HOUSE_A), 'utf8')).toBe(raw);
    expect((await fs.stat(v1BackupPath(HOUSE_A))).mode & 0o777).toBe(0o400);
    expect((await fs.stat(channelCredentialsPath(HOUSE_A))).mode & 0o777).toBe(0o600);
  });

  test('a second read migrates nothing; the store and its backup are untouched', async () => {
    await writeV1();
    await loadAccountStore(HOUSE_A);
    const [store1, backup1] = await Promise.all([
      fs.readFile(channelCredentialsPath(HOUSE_A), 'utf8'), fs.readFile(v1BackupPath(HOUSE_A), 'utf8'),
    ]);
    await loadAccountStore(HOUSE_A);
    await loadChannelCredentials(HOUSE_A);
    expect(await fs.readFile(channelCredentialsPath(HOUSE_A), 'utf8')).toBe(store1);
    expect(await fs.readFile(v1BackupPath(HOUSE_A), 'utf8')).toBe(backup1);
    const dir = path.dirname(channelCredentialsPath(HOUSE_A));
    expect((await fs.readdir(dir)).filter((n) => n.includes('credentials')).sort())
      .toEqual(['social-channel-credentials.json', 'social-channel-credentials.v1.json']);
  });

  test('a crash after the backup and before the rename: the next read finishes it, one backup', async () => {
    const raw = await writeV1();
    // The state that crash leaves: the v1 store in place, its copy already kept.
    await fs.writeFile(v1BackupPath(HOUSE_A), raw, { mode: 0o400 });
    const store = await loadAccountStore(HOUSE_A);
    expect(store.v).toBe(2);
    expect(await resolveAccountCredential(HOUSE_A, 'x-1')).toEqual(await resolveChannelCredential(HOUSE_A, 'x', V1));
    const dir = path.dirname(channelCredentialsPath(HOUSE_A));
    expect((await fs.readdir(dir)).filter((n) => n.includes('.v1.'))).toEqual(['social-channel-credentials.v1.json']);
  });

  test('a kept backup with other content is never overwritten — the new copy takes a dated name', async () => {
    await fs.mkdir(path.dirname(v1BackupPath(HOUSE_A)), { recursive: true });
    await fs.writeFile(v1BackupPath(HOUSE_A), 'an older kept copy', { mode: 0o400 });
    const raw = await writeV1();
    await loadAccountStore(HOUSE_A);
    expect(await fs.readFile(v1BackupPath(HOUSE_A), 'utf8')).toBe('an older kept copy');
    const dir = path.dirname(channelCredentialsPath(HOUSE_A));
    const dated = (await fs.readdir(dir)).filter((n) => /\.v1\.\d+\.json$/.test(n));
    expect(dated).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, dated[0]), 'utf8')).toBe(raw);
  });

  test('another house reads none of it', async () => {
    await writeV1(HOUSE_A);
    await loadAccountStore(HOUSE_A);
    expect((await loadAccountStore(HOUSE_B)).accounts).toEqual({});
    for (const ch of CHANNELS) expect(await resolveAccountCredential(HOUSE_B, `${ch}-1`)).toBeNull();
    expect(await listAccounts(HOUSE_B)).toEqual([]);
    expect(await resolveAccountCredential(null, 'x-1')).toBeNull();
  });

  test('the migration reports field names only, never a value; with no clear company it is UNSORTED', async () => {
    const { moved, store } = migrateV1(V1, { defaultCompanyId: null, envChannels: ['mastodon'] });
    expect(valuesOf(moved)).toEqual([]);
    expect(moved.find((m) => m.channelId === 'x')).toEqual({
      channelId: 'x', accountId: 'x-1', source: 'store', appFields: ['apiKey', 'apiSecret'], accountFields: ['accessToken', 'accessSecret'],
    });
    // A platform served only by the machine's .env gets a record, so it has a company too.
    expect(store.accounts['mastodon-1']).toMatchObject({ channelId: 'mastodon', companyId: null, fields: {} });
    expect(store.accounts['x-1'].companyId).toBeNull();
  });
});

describe('apps + accounts — many accounts, many companies (real tmp disk)', () => {
  let houses;
  beforeEach(async () => {
    houses = await standTwoHouses({ label: 'accounts-many' });
    await setHouseWorkspace(HOUSE_A, path.join(houses.tmp, 'ground-a'));
  });
  afterEach(() => houses.restore());

  test('two companies × two X accounts resolve distinct keys over one shared app; ids are never reused', async () => {
    await setChannelCredential(HOUSE_A, 'x', V1.x); // x-1 and the house's X app
    const companies = (await listCompanies(HOUSE_A)).map((c) => c.id);
    expect(companies).toEqual(expect.arrayContaining(['ignis', 'umbrae']));
    expect((await setAccountMeta(HOUSE_A, 'x-1', { companyId: 'ignis', label: 'main' }, companies)).ok).toBe(true);

    const opened = [];
    for (const [companyId, n] of [['ignis', 2], ['umbrae', 3], ['umbrae', 4]]) {
      const added = await addAccount(HOUSE_A, 'x', { companyId }, companies);
      expect(added).toEqual({ ok: true, accountId: `x-${n}` });
      await setAccountFields(HOUSE_A, added.accountId, { accessToken: `ph-x-token-${n}`, accessSecret: `ph-x-secret-${n}` });
      opened.push(added.accountId);
    }
    const resolved = await Promise.all(['x-1', ...opened].map((id) => resolveAccountCredential(HOUSE_A, id)));
    expect(new Set(resolved.map((r) => r.accessToken)).size).toBe(4);
    expect(new Set(resolved.map((r) => r.apiKey))).toEqual(new Set(['ph-x-consumer']));

    const listed = await listAccounts(HOUSE_A);
    expect(listed.map((a) => [a.id, a.companyId])).toEqual([['x-1', 'ignis'], ['x-2', 'ignis'], ['x-3', 'umbrae'], ['x-4', 'umbrae']]);
    expect(valuesOf(listed)).toEqual([]); // masked: no value ever leaves the store

    expect(await removeAccount(HOUSE_A, 'x-4')).toBe(true);
    expect((await addAccount(HOUSE_A, 'x', { companyId: 'umbrae' }, companies)).accountId).toBe('x-5');
    // The shared app stays while any account uses it.
    expect((await resolveAccountCredential(HOUSE_A, 'x-2')).apiKey).toBe('ph-x-consumer');

    // An account cannot be put under a company the house does not have.
    expect((await setAccountMeta(HOUSE_A, 'x-2', { companyId: 'nope' }, companies)).ok).toBe(false);
    expect((await addAccount(HOUSE_A, 'x', { companyId: 'nope' }, companies)).ok).toBe(false);
  });

  test('companies form trees: a subsidiary under its core, a client on its own, and a loop refused', async () => {
    const client = await writeKit('acme-client', HOUSE_A, kitSkeleton('acme-client', { name: 'Acme Client' }));
    expect(client.ok).toBe(true);
    const sub = await setCompanyBlock(HOUSE_A, 'umbrae', {
      parentId: 'ignis', site: { url: 'https://example.com/umbrae', links: [] }, legalEntity: { name: 'Umbrae Example Ltd', jurisdiction: 'XX' },
    });
    expect(sub.ok).toBe(true);
    expect(sub.company).toMatchObject({ id: 'umbrae', parentId: 'ignis', rootId: 'ignis', depth: 1 });

    const tree = await listCompanies(HOUSE_A);
    expect(tree.map((c) => [c.id, c.rootId, c.depth])).toEqual([
      ['acme-client', 'acme-client', 0],
      ['ignis', 'ignis', 0],
      ['umbrae', 'ignis', 1],
    ]);

    const loop = await setCompanyBlock(HOUSE_A, 'ignis', { parentId: 'umbrae' });
    expect(loop.ok).toBe(false);
    expect(loop.error).toContain('loops');
    expect((await setCompanyBlock(HOUSE_A, 'ignis', { parentId: 'nobody' })).ok).toBe(false);
    expect((await setCompanyBlock(HOUSE_A, 'ignis', { site: { url: 'not a url' } })).ok).toBe(false);
    // House B sees none of house A's company records.
    expect((await listCompanies(HOUSE_B)).find((c) => c.id === 'umbrae').parentId).toBeNull();
  });
});
