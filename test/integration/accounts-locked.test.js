/**
 * THE LOCKED KEYS FILE — a house's social keys file this desk's key cannot
 * open (sealed under another key, or damaged) is ACCOUNTS_LOCKED: a named
 * state, never an empty house, and never written over. Real routes over a
 * real signed-wallet session, the real sealed store on tmp disk (sealed under
 * a second key with the real crypto), the real queue and scheduler, the real
 * board store; no double (RULE 0); placeholder keys only.
 *
 * Proven: every read names the lock and the file's bytes never change; the
 * accounts answer keeps the house's companies; the channel board still lists
 * every platform, each LOCKED (never the env keys in its place); every write
 * is refused 423 in words; a send stops before any platform call with the
 * locked words, read as `locked` with KEYS LOCKED and TRY AGAIN; a saved
 * board panel on an account is kept, not dropped, and no layout is saved;
 * UNLOCK with a wrong key changes nothing, and with the old key brings every
 * account back — the locked bytes kept read-only beside it, every other store
 * the old key sealed moved too, plain files untouched, the key never echoed.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'path';
import process from 'process';
import fs from 'fs/promises';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { useServedHouse, SERVED_WALLET } from '../helpers/served-house.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { encryptEnvelope, deriveKeyFromSecret, parseAndDecrypt } from '../../core/workspace/workspace-crypto.js';
import accountRouter from '../../backend/routes/social-account-routes.js';
import channelRouter from '../../backend/routes/social-channel-routes.js';
import {
  channelCredentialsPath, loadAccountStore, listAccounts, addAccount, setAccountFields, isAccountsLocked, LOCKED_SEND_DETAIL,
} from '../../backend/services/social/account-store.js';
import { CHANNEL_CATALOG } from '../../backend/services/social/channel-registry.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { publishEntry } from '../../backend/services/social/post-scheduler.js';
import { sendFailureCause, canTryAgain } from '../../backend/services/social/send-failure.js';
import { restageFailed } from '../../backend/services/social/queue-retry.js';
import { boardHouseOf } from '../../backend/services/marketing/board-house.js';
import { settleBoard } from '../../backend/services/marketing/board-shape.js';
import { boardStoreFor } from '../../backend/services/marketing/board-store.js';
import { failedPostDoor } from '../../frontend/app/RelinkShell/doors/failed-post-door.js';

// A v2 store as the house kept it — sealed under ANOTHER key than this process holds.
const STORE = Object.freeze({
  v: 2,
  apps: { x: { apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' } },
  accounts: { 'x-1': { channelId: 'x', companyId: null, fields: { accessToken: 'ph-x-token', accessSecret: 'ph-x-token-secret' } } },
});
const OLD_KEY = 'another-desk-key-placeholder';
const sealElsewhere = async (wallet) => {
  await fs.mkdir(path.dirname(channelCredentialsPath(wallet)), { recursive: true, mode: 0o700 });
  await fs.writeFile(channelCredentialsPath(wallet),
    JSON.stringify(encryptEnvelope(STORE, { key: deriveKeyFromSecret(OLD_KEY) }), null, 2), { mode: 0o600 });
};
const ENV_KEYS = ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SECTOR_CREW_PATH',
  ...new Set(CHANNEL_CATALOG.flatMap((c) => c.fields.map((f) => f.env)))];

let auth;
let app;
let header;
let saved;
let tmp;

beforeAll(async () => {
  saved = { realm: getRealmRoot(), lanes: getWorkspacesRoot(), env: Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) };
  for (const k of ENV_KEYS) delete process.env[k];
  tmp = await createTempDir('accounts-locked');
  setRealmRoot(path.join(tmp, 'realm'));
  setWorkspacesRoot(path.join(tmp, 'lanes'));
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(tmp, 'queue.json');
  process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(tmp, 'bindings.json');
  process.env.NEUMA_SECTOR_CREW_PATH = path.join(tmp, 'sector-crew.json');
  auth = await fullAuth();
  await writeOwner(path.join(tmp, 'lanes'), 'core-cmo', auth.address);
  header = { Authorization: `Bearer ${auth.token}` };
  app = express();
  app.use(express.json());
  app.use('/api/v1/social-channels', accountRouter);
  app.use('/api/v1/social-channels', channelRouter);
});

afterAll(() => {
  setRealmRoot(saved.realm);
  setWorkspacesRoot(saved.lanes);
  for (const [k, v] of Object.entries(saved.env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(async () => {
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
  // The house opens one account under this desk's key, so the file and its dir stand; then the file is sealed elsewhere.
  await fs.rm(channelCredentialsPath(auth.address), { force: true });
  await addAccount(auth.address, 'x');
  await sealElsewhere(auth.address);
});

const api = (method, url, body) => {
  const r = request(app)[method](`/api/v1/social-channels${url}`).set(header);
  return body ? r.send(body) : r;
};
const bytes = () => fs.readFile(channelCredentialsPath(auth.address), 'utf8');

describe('the store — a file this desk cannot open is LOCKED, and never written over', () => {
  test('every read names the lock; every write refuses; the bytes stand', async () => {
    const before = await bytes();
    const read = await loadAccountStore(auth.address).catch((e) => e);
    expect(isAccountsLocked(read)).toBe(true);
    expect(read.message).toMatch(/can't be opened with the key this desk holds/);
    expect(isAccountsLocked(await listAccounts(auth.address).catch((e) => e))).toBe(true);
    expect(isAccountsLocked(await addAccount(auth.address, 'tiktok').catch((e) => e))).toBe(true);
    expect(isAccountsLocked(await setAccountFields(auth.address, 'x-1', { accessToken: 'ph-new' }).catch((e) => e))).toBe(true);
    expect(await bytes()).toBe(before);
  });

  test('a damaged file is locked too, in its own words', async () => {
    await fs.writeFile(channelCredentialsPath(auth.address), '{"_enc": 1, "iv": "trunc');
    const read = await loadAccountStore(auth.address).catch((e) => e);
    expect(isAccountsLocked(read)).toBe(true);
    expect(read.message).toMatch(/damaged/);
  });
});

describe('the routes — LOCKED by name, never a bare 500 and never an empty house', () => {
  test('the accounts answer keeps the companies and names the lock', async () => {
    const r = await api('get', '/accounts');
    expect(r.status).toBe(200);
    expect(r.body.accounts).toEqual([]);
    expect(Array.isArray(r.body.companies)).toBe(true);
    expect(r.body.locked.why).toMatch(/keys file can't be opened/);
  });

  test('the house check and the flight tests say LOCKED instead of checking nothing', async () => {
    const check = await api('get', '/accounts/house-check');
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ check: null, locked: { why: expect.stringMatching(/keys file/) } });
    const flights = await api('get', '/accounts/flight-test');
    expect(flights.status).toBe(200);
    expect(flights.body).toMatchObject({ tests: {}, locked: { why: expect.stringMatching(/keys file/) } });
  });

  test('the channel board still lists every platform, each LOCKED, even with env keys present', async () => {
    process.env.X_API_KEY = 'ph-env-x';
    try {
      const r = await api('get', '');
      expect(r.status).toBe(200);
      expect(r.body.channels.map((c) => c.id)).toEqual(CHANNEL_CATALOG.map((c) => c.id));
      expect(r.body.channels.every((c) => c.locked === true && c.configured === false)).toBe(true);
      expect(r.body.locked.why).toMatch(/keys file/);
    } finally {
      delete process.env.X_API_KEY;
    }
  });

  test('every write is refused 423 in words, and the file is untouched', async () => {
    const before = await bytes();
    const open = await api('post', '/accounts', { channelId: 'tiktok' });
    expect(open.status).toBe(423);
    expect(open.body.error).toMatch(/keys file can't be opened/);
    expect((await api('put', '/accounts/x-1/credentials', { fields: { accessToken: 'ph-new-token' } })).status).toBe(423);
    expect((await api('put', '/apps/x', { fields: { apiKey: 'ph-new-app' } })).status).toBe(423);
    expect((await api('put', '/x/credentials', { fields: { accessToken: 'ph-new-token' } })).status).toBe(423);
    expect(await bytes()).toBe(before);
  });
});

describe('a send under the lock — held before any platform call, in words that lead to the fix', () => {
  test('the post fails LOCKED; its door is KEYS LOCKED with TRY AGAIN; TRY AGAIN returns it to draft', async () => {
    const house = await useServedHouse();
    try {
      await sealElsewhere(SERVED_WALLET);
      const e = await postQueue.add({ channelId: 'x', accountId: 'x-1', text: 'held by the lock', queuedBy: SERVED_WALLET });
      await postQueue.approve(e.id, { decidedBy: SERVED_WALLET });
      const claimed = await postQueue.claimForSend(e.id);
      const outcome = await publishEntry(claimed.entry);
      expect(outcome).toEqual({ ok: false, detail: LOCKED_SEND_DETAIL });
      const failed = (await postQueue.load()).find((x) => x.id === e.id);
      expect(failed.status).toBe('failed');
      expect(sendFailureCause(failed)).toBe('locked');
      expect(canTryAgain(failed)).toBe(true);
      expect(failedPostDoor(failed)).toMatchObject({ cause: 'locked', label: 'KEYS LOCKED', again: true, door: { kind: 'keys', channelId: 'x' } });
      const copy = { ...failed };
      expect(restageFailed(copy, { by: SERVED_WALLET, at: '2026-10-26T00:00:00.000Z' })).toBeNull();
      expect(copy.status).toBe('draft');
    } finally {
      house.restore();
    }
  });

  test('a post refused for its keys may go back too; one refused for its words may not', () => {
    const keys = { status: 'failed', error: 'X credentials are not configured' };
    const words = { status: 'failed', error: 'HTTP 403: duplicate content' };
    expect(canTryAgain(keys)).toBe(true);
    expect(failedPostDoor({ ...keys, id: 'q1', channelId: 'x' })).toMatchObject({ label: 'FIX KEYS', again: true });
    expect(restageFailed({ ...words }, { by: SERVED_WALLET, at: 'now' })).toEqual({ error: expect.stringMatching(/revise it/) });
  });
});

describe('the board under the lock — a panel on an account is kept, and no layout is saved', () => {
  test('the house reads its accounts as unknown; a saved account panel is not dropped; a save is refused', async () => {
    const ctx = await boardHouseOf(auth.address, 'house');
    expect(ctx.accounts).toBeNull();
    expect(ctx.locked.why).toMatch(/keys file/);
    const panel = { id: 'p1', kind: 'platform', span: 6, scope: { platform: 'x', accountId: 'x-1' } };
    expect(settleBoard([panel], ctx).dropped).toEqual([]);
    const save = await (await boardStoreFor(auth.address)).save('house', [panel], { ...ctx, setBy: 'operator' });
    expect(save.ok).toBe(false);
    expect(save.reasons[0]).toMatch(/accounts can't be read/);
  });
});

describe('UNLOCK — the old key, once, and every account is back', () => {
  test('a wrong key changes nothing; the old key re-seals the house under this desk\'s key, the locked bytes kept', async () => {
    const realmDir = path.dirname(channelCredentialsPath(auth.address));
    const other = path.join(realmDir, 'office', 'sealed-store.json');
    const plain = path.join(realmDir, 'office', 'plain.json');
    await fs.mkdir(path.dirname(other), { recursive: true });
    await fs.writeFile(other, JSON.stringify(encryptEnvelope({ note: 'kept' }, { key: deriveKeyFromSecret(OLD_KEY) })));
    await fs.writeFile(plain, JSON.stringify({ plain: true }));
    const before = await bytes();

    const wrong = await api('post', '/accounts/unlock', { key: 'not-the-key' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/doesn't open the keys file — nothing was changed/);
    expect(await bytes()).toBe(before);
    expect((await api('post', '/accounts/unlock', {})).status).toBe(400);

    const right = await api('post', '/accounts/unlock', { key: OLD_KEY });
    expect(right.status).toBe(200);
    expect(right.body).toMatchObject({ unlocked: true, already: false });
    expect(right.body.moved).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(right.body)).not.toContain(OLD_KEY);

    const accounts = await api('get', '/accounts');
    expect(accounts.body.locked).toBeUndefined();
    expect(accounts.body.accounts.map((a) => a.id)).toEqual(['x-1']);
    expect(parseAndDecrypt(await fs.readFile(other, 'utf8'))).toEqual({ note: 'kept' });
    expect(JSON.parse(await fs.readFile(plain, 'utf8'))).toEqual({ plain: true });
    const kept = (await fs.readdir(realmDir)).filter((f) => /\.locked-.*\.json$/.test(f));
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(realmDir, kept[0]), 'utf8')).toBe(before);
    expect((await fs.stat(path.join(realmDir, kept[0]))).mode & 0o777).toBe(0o400);
    // Writes work again: the house can open a TikTok account.
    expect((await api('post', '/accounts', { channelId: 'tiktok' })).status).toBe(201);

    const again = await api('post', '/accounts/unlock', { key: OLD_KEY });
    expect(again.body).toMatchObject({ unlocked: true, already: true, moved: 0 });
    await fs.chmod(path.join(realmDir, kept[0]), 0o600);
    await fs.rm(path.join(realmDir, kept[0]));
  });
});

describe('START FRESH — the old key is gone: the locked file steps aside, the keys are pasted again', () => {
  test('the locked bytes are kept read-only; the house starts empty; new keys go in as x-1 and work', async () => {
    const realmDir = path.dirname(channelCredentialsPath(auth.address));
    const before = await bytes();
    const r = await api('post', '/accounts/start-fresh');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ fresh: true });
    const kept = (await fs.readdir(realmDir)).filter((f) => /\.locked-.*\.json$/.test(f));
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(realmDir, kept[0]), 'utf8')).toBe(before);
    expect((await fs.stat(path.join(realmDir, kept[0]))).mode & 0o777).toBe(0o400);

    const accounts = await api('get', '/accounts');
    expect(accounts.body.locked).toBeUndefined();
    expect(accounts.body.accounts).toEqual([]);
    const opened = await api('post', '/accounts', { channelId: 'x' });
    expect(opened.body).toEqual({ accountId: 'x-1' });
    expect((await api('put', '/accounts/x-1/credentials', { fields: { accessToken: 'ph-fresh-token' } })).status).toBe(200);
    expect((await api('post', '/accounts/start-fresh')).body.error).toMatch(/nothing is locked/);
    // The kept copy is the old seal, untouched (this desk's key cannot open it), should the old key ever turn up.
    expect(() => parseAndDecrypt(before)).toThrow();
    await fs.chmod(path.join(realmDir, kept[0]), 0o600);
    await fs.rm(path.join(realmDir, kept[0]));
  });
});
