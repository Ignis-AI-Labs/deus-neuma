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
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

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
  trayUpdateEntry,
} = require('../../electron/auto-update.cjs');

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
