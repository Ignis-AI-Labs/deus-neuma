// Social channels — registry, encrypted credential store, and the per-channel
// neuma bindings that make each platform a single-holder position.
// RULE 0: real disk, real AES-256-GCM (DNA_ENCRYPTION_KEY from test/setup.js),
// pure functions with real inputs and outputs — no mocks anywhere.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import {
  CHANNEL_CATALOG, getChannel, resolveChannelCredentials, maskChannelCredentials,
} from '../../backend/services/social/channel-registry.js';
import {
  channelCredentialsPath, loadChannelCredentials, setChannelCredential,
  removeChannelCredential, mergeChannelCredential, resolveChannelCredential,
} from '../../backend/services/social/channel-credentials.js';
import {
  createChannelBindings, canNeumaPost,
} from '../../backend/services/social/channel-bindings.js';
import { POSTERS, posterFor } from '../../backend/services/social/poster-registry.js';
import { telegramSendRequest } from '../../backend/services/social/telegram-poster.js';
import { discordMessageRequest } from '../../backend/services/social/discord-poster.js';
import { facebookFeedRequest } from '../../backend/services/social/facebook-poster.js';
import { normalizeInstanceUrl, postToMastodon } from '../../backend/services/social/mastodon-poster.js';
import { blueskyPostRecord, isSecureServiceUrl, postToBluesky } from '../../backend/services/social/bluesky-poster.js';

// Every catalog field's env var — cleared so a developer's own .env (live X
// keys are expected on this box) can't leak into resolution and flake a test.
const ENV_KEYS = [...new Set(CHANNEL_CATALOG.flatMap((c) => c.fields.map((f) => f.env)))];
// Account keys are a house's own (house-positions.js): one test house, its
// realm on temp disk.
const HOUSE = `0x${'1'.repeat(40)}`;
let savedEnv;
let dir;
let priorRealm;

beforeEach(async () => {
  savedEnv = { PATH_OVR: process.env.NEUMA_SOCIAL_CREDENTIALS_PATH };
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  dir = await createTempDir(`social-channels-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(dir, 'social-channel-credentials.json');
  priorRealm = getRealmRoot();
  setRealmRoot(path.join(dir, 'realm'));
});

afterEach(() => {
  setRealmRoot(priorRealm);
  if (savedEnv.PATH_OVR === undefined) delete process.env.NEUMA_SOCIAL_CREDENTIALS_PATH;
  else process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = savedEnv.PATH_OVR;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('channel registry (pure)', () => {
  test('every catalog entry has a poster and vice versa', () => {
    expect(CHANNEL_CATALOG.map((c) => c.id).sort()).toEqual(Object.keys(POSTERS).sort());
    for (const c of CHANNEL_CATALOG) expect(typeof posterFor(c.id)).toBe('function');
    expect(posterFor('myspace')).toBeNull();
  });

  test('getChannel finds by id and returns null for unknown', () => {
    expect(getChannel('x')?.name).toBe('X (Twitter)');
    expect(getChannel('nope')).toBeNull();
  });

  test('resolveChannelCredentials applies store > env > fallback per field', () => {
    const bluesky = getChannel('bluesky');
    const resolved = resolveChannelCredentials(
      bluesky,
      { appPassword: 'stored-pass' },
      { BLUESKY_IDENTIFIER: 'herald.bsky.social', BLUESKY_APP_PASSWORD: 'env-pass' },
    );
    expect(resolved).toEqual({
      service: 'https://bsky.social',      // declared fallback
      identifier: 'herald.bsky.social',     // env
      appPassword: 'stored-pass',           // store wins over env
    });
  });

  test('a partial credential set resolves to null — never a half-working channel', () => {
    const telegram = getChannel('telegram');
    expect(resolveChannelCredentials(telegram, { botToken: 'bot123' }, {})).toBeNull();
    expect(resolveChannelCredentials(telegram, undefined, {})).toBeNull();
  });

  test('maskChannelCredentials never carries a value, only presence + source', () => {
    const masked = maskChannelCredentials(getChannel('telegram'), { botToken: 'bot-secret' }, { TELEGRAM_CHAT_ID: '@ch' });
    expect(JSON.stringify(masked)).not.toContain('bot-secret');
    expect(masked.configured).toBe(true);
    expect(masked.fields).toEqual([
      { key: 'botToken', label: 'Bot Token', secret: true, set: true, source: 'store' },
      { key: 'chatId', label: 'Channel / Chat ID', secret: false, set: true, source: 'env' },
    ]);
  });
});

describe('mergeChannelCredential (pure)', () => {
  const telegram = getChannel('telegram');

  test('keeps only declared fields and merges over existing', () => {
    expect(mergeChannelCredential(telegram, { botToken: 'old' }, { chatId: '@c', bogus: 'x' }))
      .toEqual({ botToken: 'old', chatId: '@c' });
  });

  test('an empty-string value clears a stored field; an empty entry collapses to null', () => {
    expect(mergeChannelCredential(telegram, { botToken: 'old', chatId: '@c' }, { botToken: '' }))
      .toEqual({ chatId: '@c' });
    expect(mergeChannelCredential(telegram, { botToken: 'old' }, { botToken: '' })).toBeNull();
  });
});

describe('channel credential store (real disk + crypto)', () => {
  test('set → sealed envelope on disk → load round-trips → resolve exposes raw values', async () => {
    await setChannelCredential(HOUSE, 'telegram', { botToken: 'bot-abc', chatId: '@herald' });
    const raw = await fs.readFile(channelCredentialsPath(HOUSE), 'utf8');
    expect(raw).not.toContain('bot-abc');                 // sealed, never plaintext
    expect(JSON.parse(raw)).toHaveProperty('ct');
    expect(await loadChannelCredentials(HOUSE)).toEqual({ telegram: { botToken: 'bot-abc', chatId: '@herald' } });
    expect(await resolveChannelCredential(HOUSE, 'telegram'))
      .toEqual({ botToken: 'bot-abc', chatId: '@herald' });
  });

  test('store file lands 0600 in a 0700 dir', async () => {
    await setChannelCredential(HOUSE, 'discord', { botToken: 'bot-abc', channelId: '123' });
    const fileMode = (await fs.stat(channelCredentialsPath(HOUSE))).mode & 0o777;
    const dirMode = (await fs.stat(path.dirname(channelCredentialsPath(HOUSE)))).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });

  test('env fills a field the store lacks; store wins where both exist', async () => {
    process.env.TELEGRAM_CHAT_ID = '@env-chat';
    await setChannelCredential(HOUSE, 'telegram', { botToken: 'bot-abc' });
    expect(await resolveChannelCredential(HOUSE, 'telegram'))
      .toEqual({ botToken: 'bot-abc', chatId: '@env-chat' });
  });

  test('unknown channel id is rejected before anything persists', async () => {
    await expect(setChannelCredential(HOUSE, 'myspace', { key: 'v' })).rejects.toThrow('Unknown channel');
  });

  test('remove deletes the entry and reports whether one existed', async () => {
    await setChannelCredential(HOUSE, 'mastodon', { instanceUrl: 'mastodon.social', accessToken: 't' });
    expect(await removeChannelCredential(HOUSE, 'mastodon')).toBe(true);
    expect(await removeChannelCredential(HOUSE, 'mastodon')).toBe(false);
    expect(await resolveChannelCredential(HOUSE, 'mastodon')).toBeNull();
  });

  test('missing store means "nothing yet"; a corrupt store surfaces, never wipes', async () => {
    expect(await loadChannelCredentials(HOUSE)).toEqual({});
    await fs.mkdir(path.dirname(channelCredentialsPath(HOUSE)), { recursive: true });
    await fs.writeFile(channelCredentialsPath(HOUSE), 'not-an-envelope');
    await expect(loadChannelCredentials(HOUSE)).rejects.toThrow();
  });
});

describe('channel bindings (real disk, default deny)', () => {
  const makeStore = () =>
    createChannelBindings({ path: path.join(dir, 'bindings.json') });

  test('bind → bindingFor → unbind round-trips on real disk', async () => {
    const store = makeStore();
    expect(await store.bindingFor('x')).toBeNull();
    const bound = await store.bind('x', { neumaId: 'hazel', boundBy: '0xEli' });
    expect(bound.neumaId).toBe('hazel');
    expect(bound.boundBy).toBe('0xEli');
    expect(typeof bound.boundAt).toBe('string');
    expect((await store.bindingFor('x'))?.neumaId).toBe('hazel');
    expect(await store.unbind('x')).toBe(true);
    expect(await store.unbind('x')).toBe(false);
    expect(await store.bindingFor('x')).toBeNull();
  });

  test('bindings land 0600 in a 0700 dir — this store never leaves settings loose', async () => {
    const bindingsDir = path.join(dir, 'bindings-mode');
    const store = createChannelBindings({ path: path.join(bindingsDir, 'bindings.json') });
    await store.bind('x', { neumaId: 'hazel', boundBy: '0xEli' });
    const fileMode = (await fs.stat(path.join(bindingsDir, 'bindings.json'))).mode & 0o777;
    const dirMode = (await fs.stat(bindingsDir)).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });

  test('rebinding replaces the previous holder — one neuma per channel', async () => {
    const store = makeStore();
    await store.bind('telegram', { neumaId: 'hazel', boundBy: '0xEli' });
    await store.bind('telegram', { neumaId: 'cedar', boundBy: '0xEli' });
    const bindings = await store.load();
    expect(bindings.telegram.neumaId).toBe('cedar');
    expect(Object.keys(bindings)).toEqual(['telegram']);
  });

  test('unknown channel and malformed neumaId are rejected', async () => {
    const store = makeStore();
    await expect(store.bind('myspace', { neumaId: 'hazel', boundBy: '0x' })).rejects.toThrow('Unknown channel');
    await expect(store.bind('x', { neumaId: '../escape', boundBy: '0x' })).rejects.toThrow('Invalid neumaId');
    await expect(store.bind('x', { neumaId: '', boundBy: '0x' })).rejects.toThrow('Invalid neumaId');
  });

  test('canNeumaPost fails closed: only the exact bound neuma passes', () => {
    const bindings = { x: { neumaId: 'hazel' } };
    expect(canNeumaPost(bindings, 'x', 'hazel')).toBe(true);
    expect(canNeumaPost(bindings, 'x', 'cedar')).toBe(false);   // no cross-routing
    expect(canNeumaPost(bindings, 'telegram', 'hazel')).toBe(false); // unbound channel = no one
    expect(canNeumaPost(bindings, 'x', null)).toBe(false);
    expect(canNeumaPost(bindings, 'x', '')).toBe(false);
    expect(canNeumaPost({}, 'x', 'hazel')).toBe(false);
  });
});

describe('poster pure cores', () => {
  test('telegramSendRequest builds the Bot API call', () => {
    expect(telegramSendRequest({ botToken: 'b123', chatId: '@herald' }, 'hello')).toEqual({
      url: 'https://api.telegram.org/botb123/sendMessage',
      body: { chat_id: '@herald', text: 'hello' },
    });
  });

  test('discordMessageRequest builds the bot create-message call, token in the header only', () => {
    const req = discordMessageRequest({ botToken: 'bot-tok', channelId: '42' }, 'hello');
    expect(req).toEqual({
      url: 'https://discord.com/api/v10/channels/42/messages',
      headers: { Authorization: 'Bot bot-tok' },
      body: { content: 'hello' },
    });
    expect(req.url).not.toContain('bot-tok');
  });

  test('facebookFeedRequest builds the page-feed call, token in the header only', () => {
    const req = facebookFeedRequest({ pageId: '777', accessToken: 'page-tok' }, 'hello');
    expect(req).toEqual({
      url: 'https://graph.facebook.com/v21.0/777/feed',
      headers: { Authorization: 'Bearer page-tok' },
      body: { message: 'hello' },
    });
    expect(req.url).not.toContain('page-tok');
  });

  test('normalizeInstanceUrl yields an https origin or null', () => {
    expect(normalizeInstanceUrl('mastodon.social')).toBe('https://mastodon.social');
    expect(normalizeInstanceUrl('https://mastodon.social/')).toBe('https://mastodon.social');
    expect(normalizeInstanceUrl('http://mastodon.social')).toBeNull();
    expect(normalizeInstanceUrl('not a url')).toBeNull();
    expect(normalizeInstanceUrl('')).toBeNull();
  });

  test('blueskyPostRecord is a deterministic app.bsky.feed.post', () => {
    expect(blueskyPostRecord('hi', '2026-07-19T00:00:00.000Z')).toEqual({
      $type: 'app.bsky.feed.post',
      text: 'hi',
      createdAt: '2026-07-19T00:00:00.000Z',
    });
  });

  test('every poster answers a real not-configured outcome for null credentials', async () => {
    for (const post of Object.values(POSTERS)) {
      const out = await post(null, 'hi');
      expect(out.ok).toBe(false);
      expect(out.detail).toContain('not configured');
    }
    const badInstance = await postToMastodon({ instanceUrl: 'http://insecure', accessToken: 't' }, 'hi');
    expect(badInstance.ok).toBe(false);
  });

  test('every poster honors the operator barge-in signal', async () => {
    // Valid-format credentials so each pre-flight passes and execution reaches
    // fetch, where the pre-aborted signal raises the real AbortError — no
    // mock, and no packet leaves the machine.
    const creds = {
      x: { apiKey: 'k', apiSecret: 's', accessToken: 't', accessSecret: 'as' },
      telegram: { botToken: 'b', chatId: 'c' },
      discord: { botToken: 'b', channelId: '1' },
      mastodon: { instanceUrl: 'https://mastodon.social', accessToken: 't' },
      bluesky: { service: 'https://bsky.social', identifier: 'i', appPassword: 'p' },
      facebook: { pageId: '1', accessToken: 't' },
      linkedin: { personUrn: 'urn:li:person:1', accessToken: 't', tokenExpiresAt: '2099-01-01T00:00:00.000Z' },
      youtube: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
      tiktok: { clientKey: 'k', clientSecret: 's', refreshToken: 'r', accessToken: 'a', accessExpiresAt: '2099-01-01T00:00:00.000Z' },
    };
    for (const [id, post] of Object.entries(POSTERS)) {
      const controller = new AbortController();
      controller.abort();
      const out = await post(creds[id], 'hi', { signal: controller.signal });
      expect(out).toEqual({ ok: false, detail: 'interrupted by your operator before publishing' });
    }
  });

  test('the app password is never sent to a non-https PDS', async () => {
    expect(isSecureServiceUrl('https://bsky.social')).toBe(true);
    expect(isSecureServiceUrl('http://internal-host')).toBe(false);
    expect(isSecureServiceUrl('not a url')).toBe(false);
    const out = await postToBluesky({ service: 'http://internal-host', identifier: 'a', appPassword: 'p' }, 'hi');
    expect(out).toEqual({ ok: false, detail: 'the configured PDS service URL is not a valid https origin' });
  });
});
