/**
 * The update pipeline's decision layer — feed URL resolution, the feed's host
 * guard (the Deus Neuma site, public, no credential), install-form detection,
 * notice text, and the tray entry decision.
 *
 * The pure helpers are tested here with real inputs, no mocks (RULE 0). The
 * impure electron-updater wiring is proven separately and for real by
 * scripts/prove-auto-update.mjs (an actual AppImage swaps to a newer build) and
 * scripts/prove-update-privacy.mjs (real Electron: the feed request carries no
 * per-install id) and scripts/prove-update-signature.mjs (real Electron: nothing downloads unless
 * the release key signed the feed) — a mocked autoUpdater would prove nothing about the thing being claimed.
 *
 * siteVerdict — the signed-feed fetch and its one cache-busted re-read — is proven here over real
 * HTTP: Node's own fetch against a loopback server that behaves like a cache keyed by URL.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';

const require = createRequire(import.meta.url);
const {
  FEED_URL,
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  UPDATE_REQUEST_HEADERS,
  resolveFeedUrl,
  isSiteFeed,
  isLoopbackFeed,
  installForm,
  noticeFor,
  unverifiedNoticeFor,
  unfitNoticeFor,
  trayUpdateEntry,
  siteVerdict,
} = require('../../electron/auto-update.cjs');
const { embeddedFormOf, releasePublicKey, signFeed } = require('../../electron/release-signature.cjs');

describe('update pickup cadence', () => {
  it('checks soon after launch and within 30 minutes while always on', () => {
    expect(FIRST_CHECK_DELAY_MS).toBe(5_000);
    expect(CHECK_INTERVAL_MS).toBe(30 * 60 * 1_000);
  });
});

describe('what an update check says about the install', () => {
  it('blanks electron-updater\'s per-install staging id — the site never tells installs apart', () => {
    expect(UPDATE_REQUEST_HEADERS).toEqual({ 'x-user-staging-id': '' });
    expect(Object.isFrozen(UPDATE_REQUEST_HEADERS)).toBe(true);
  });
});

describe('resolveFeedUrl', () => {
  it('defaults to the Deus Neuma site\'s feed', () => {
    expect(resolveFeedUrl({})).toBe(FEED_URL);
    expect(FEED_URL).toBe('https://deusneuma.ai/updates/');
  });

  it('honors the proof-rig override and guarantees a trailing slash', () => {
    expect(resolveFeedUrl({ NEUMA_UPDATE_FEED_URL: 'http://127.0.0.1:9999/feed' }))
      .toBe('http://127.0.0.1:9999/feed/');
  });
});

describe('update feed trust boundaries', () => {
  it('asks only the real HTTPS Deus Neuma site — never Ignis, never a look-alike', () => {
    expect(isSiteFeed('https://deusneuma.ai/updates/')).toBe(true);
    expect(isSiteFeed('https://www.deusneuma.ai/updates/')).toBe(true);
    expect(isSiteFeed('http://deusneuma.ai/updates/')).toBe(false);
    expect(isSiteFeed('https://deusneuma.ai.evil.example/')).toBe(false);
    expect(isSiteFeed('https://www.ignislabs.ai/api/neuma-updates/')).toBe(false);
  });

  it('recognizes HTTP(S) loopback as the local test seam', () => {
    expect(isLoopbackFeed('http://127.0.0.1:9999/feed/')).toBe(true);
    expect(isLoopbackFeed('http://localhost:9999/')).toBe(true);
    expect(isLoopbackFeed('https://[::1]:9999/')).toBe(true);
    expect(isLoopbackFeed('ftp://127.0.0.1/feed/')).toBe(false);
  });

  it('never mistakes a stranger or malformed URL for either trusted seam', () => {
    expect(isLoopbackFeed('https://example.com/')).toBe(false);
    expect(isSiteFeed('https://example.com/')).toBe(false);
    expect(isLoopbackFeed('not a url')).toBe(false);
    expect(isSiteFeed('not a url')).toBe(false);
  });
});

describe('installForm', () => {
  it('a dev run never checks', () => {
    expect(installForm({ isPackaged: false, appimage: true, platform: 'linux' })).toBe('dev');
  });

  it('an AppImage self-updates', () => {
    expect(installForm({ isPackaged: true, appimage: true, platform: 'linux' })).toBe('self');
  });

  it('Windows NSIS self-updates without an APPIMAGE marker', () => {
    expect(installForm({ isPackaged: true, appimage: false, platform: 'win32' })).toBe('self');
  });

  it('a packaged system install (deb/rpm under /opt) can only notify', () => {
    expect(installForm({ isPackaged: true, appimage: false, platform: 'linux' })).toBe('notify');
  });
});

describe('noticeFor', () => {
  it('self: the update installs on quit, restart from the tray', () => {
    const n = noticeFor('self', '0.1.18');
    expect(n.title).toBe('Deus Neuma update ready');
    expect(n.body).toContain('0.1.18');
    expect(n.body).toContain('quit');
  });

  it('notify: the package manager owns the install — fetch it', () => {
    const n = noticeFor('notify', '0.1.18');
    expect(n.title).toContain('0.1.18');
    expect(n.body).toContain('downloads page');
  });

  it('an offer whose signature did not hold: available, not verified, nothing changed', () => {
    const n = unverifiedNoticeFor('0.1.31');
    expect(n.title).toBe('Deus Neuma 0.1.31 is available — it could not be verified');
    expect(n.body).toBe('It was not downloaded, and nothing on this machine changed.');
  });

  it('a signed offer whose file is not this install\'s type: said plainly, nothing downloaded', () => {
    const n = unfitNoticeFor('0.1.31');
    expect(n.title).toBe('Deus Neuma 0.1.31 is available — not as an update for this install');
    expect(n.body).toMatch(/does not fit this system, so it was not downloaded/);
  });
});

describe('siteVerdict — a stale .sig is not a forgery, and a forgery still fails', () => {
  const CHANNEL = 'latest-linux.yml';
  const key = generateKeyPairSync('ed25519');
  const publicKey = releasePublicKey(embeddedFormOf(key.publicKey));
  const yml = (version) => Buffer.from(`version: ${version}\nfiles:\n  - url: Deus-Neuma-${version}-x86_64.AppImage\n    sha512: AAAA\n    size: 1\n`);
  const offered = (version) => require('js-yaml').load(yml(version).toString());
  const servers = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))); });

  // impure — a feed behind a CDN cache keyed by URL, which (like Cloudflare's default) ignores a
  // request's no-cache headers: a plain request gets what the cache holds; one carrying a query the
  // cache has not seen reaches the origin
  const cachedFeed = async ({ origin, cached }) => {
    const requests = [];
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://feed');
      const pastCache = url.search !== '';
      requests.push(`${url.pathname}${pastCache ? ' (fresh)' : ''}`);
      const body = (pastCache ? origin : cached)[url.pathname.slice(1)];
      if (body == null) res.writeHead(404).end();
      else res.writeHead(200).end(body);
    });
    servers.push(server);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { feedUrl: `http://127.0.0.1:${server.address().port}/`, requests };
  };

  it('a new yml under an old cached .sig verifies after ONE fresh re-read', async () => {
    const origin = { [CHANNEL]: yml('0.1.32'), [`${CHANNEL}.sig`]: signFeed(CHANNEL, yml('0.1.32'), key.privateKey) };
    const cached = { [CHANNEL]: yml('0.1.32'), [`${CHANNEL}.sig`]: signFeed(CHANNEL, yml('0.1.31'), key.privateKey) };
    const { feedUrl, requests } = await cachedFeed({ origin, cached });
    const verdict = await siteVerdict({ fetchImpl: fetch, feedUrl, channelFile: CHANNEL, publicKey, offered: offered('0.1.32') });
    expect(verdict.ok).toBe(true);
    expect(verdict.refreshed).toBe(true);
    expect(verdict.firstReason).toMatch(/signature does not match latest-linux\.yml/);
    expect(requests).toEqual([`/${CHANNEL}`, `/${CHANNEL}.sig`, `/${CHANNEL} (fresh)`, `/${CHANNEL}.sig (fresh)`]);
  });

  it('a feed that verifies at once is read once', async () => {
    const good = { [CHANNEL]: yml('0.1.32'), [`${CHANNEL}.sig`]: signFeed(CHANNEL, yml('0.1.32'), key.privateKey) };
    const { feedUrl, requests } = await cachedFeed({ origin: good, cached: good });
    const verdict = await siteVerdict({ fetchImpl: fetch, feedUrl, channelFile: CHANNEL, publicKey, offered: offered('0.1.32') });
    expect(verdict).toMatchObject({ ok: true, refreshed: false });
    expect(requests).toEqual([`/${CHANNEL}`, `/${CHANNEL}.sig`]);
  });

  it('a forged .sig fails both reads — closed, with the reason, after exactly one retry', async () => {
    const other = generateKeyPairSync('ed25519');
    const forged = { [CHANNEL]: yml('0.1.32'), [`${CHANNEL}.sig`]: signFeed(CHANNEL, yml('0.1.32'), other.privateKey) };
    const { feedUrl, requests } = await cachedFeed({ origin: forged, cached: forged });
    const verdict = await siteVerdict({ fetchImpl: fetch, feedUrl, channelFile: CHANNEL, publicKey, offered: offered('0.1.32') });
    expect(verdict).toEqual({ ok: false, reason: 'the signature does not match latest-linux.yml (altered, signed for another file, or by another key)' });
    expect(requests).toHaveLength(4);
  });

  it('a signed Windows feed served as latest-linux.yml fails both reads', async () => {
    const replay = { [CHANNEL]: yml('0.1.32'), [`${CHANNEL}.sig`]: signFeed('latest.yml', yml('0.1.32'), key.privateKey) };
    const { feedUrl } = await cachedFeed({ origin: replay, cached: replay });
    const verdict = await siteVerdict({ fetchImpl: fetch, feedUrl, channelFile: CHANNEL, publicKey, offered: offered('0.1.32') });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/signature does not match latest-linux\.yml/);
  });
});

describe('trayUpdateEntry', () => {
  it('nothing to say → no entry (the default menu is untouched)', () => {
    expect(trayUpdateEntry({ form: 'self', ready: false, availableVersion: null })).toBeNull();
  });

  it('a downloaded update outranks everything — restart to install', () => {
    expect(trayUpdateEntry({ form: 'self', ready: true, availableVersion: '0.1.18' }))
      .toEqual({ label: 'RESTART TO UPDATE', action: 'restart' });
  });

  it('notify form offers the download once a version is known', () => {
    expect(trayUpdateEntry({ form: 'notify', ready: false, availableVersion: '0.1.18' }))
      .toEqual({ label: 'DOWNLOAD DEUS NEUMA 0.1.18', action: 'open-downloads' });
  });

  it('a self install with no download yet stays silent', () => {
    expect(trayUpdateEntry({ form: 'self', ready: false, availableVersion: '0.1.18' })).toBeNull();
  });
});
