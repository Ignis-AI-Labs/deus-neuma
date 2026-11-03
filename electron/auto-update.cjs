// auto-update.cjs — the update pipeline, client side.
//
// THE BARGAIN (ruling, 2026-08-11): […] A packaged NEUMA checks shortly after boot and every
// 30 minutes, downloads in the background, and installs on the next quit. The
// operator sees one quiet OS notice, a tray entry, and a slim bar on the desk
// (update-bar.cjs → UpdateBar.jsx) with WHAT'S NEW; the desk itself is never
// interrupted — the restart that installs happens only on the person's press.
//
// OFF UNTIL THE PERSON TURNS IT ON (Design note, 2026-10-25: […]). The bargain above holds only once the update check
// is switched on in Settings → Security → Connections (electron/connections.cjs); until then the
// timers ask nothing, and the person's own Check now (checkNow) is the one request made.
//
// THE FEED IS THE DEUS NEUMA SITE, AND IT IS PUBLIC (Design note, 2026-10-03: […]; the licence
// gate was removed the same day — […]). The app
// asks HTTPS deusneuma.ai only, with no credential of any kind; the feed is
// static files (electron-updater's generic provider: latest*.yml beside the
// artifacts, whose sha512 every download is checked against). A loopback feed
// is the local test seam. Any other host is refused — never asked at all.
//
// THREE INSTALL FORMS, three honest behaviors:
//   dev    (unpacked)           — never checks; a dev desk must not phone home.
//   self   (AppImage, NSIS)     — electron-updater owns the swap.
//   notify (deb/rpm under /opt) — the package manager owns the files, so the
//                                 app can only say an update exists and open
//                                 the downloads page. Downloading it anyway
//                                 would strand 800 MB the user cannot install.
//
// Differential download stays disabled. It once forwarded an Authorization
// header past a redirect (the real swap proof); there is no header now, but
// the full-download path is the one proven end to end.
//
// NOTHING DOWNLOADS ON THE BUCKET'S WORD ALONE (security seat G2). The feed's
// sha512 and the installer come from one bucket, so TLS + sha512 trust anyone
// who can write it. autoDownload is OFF: on update-available the app fetches
// the same latest*.yml and its .sig, checks the offline release key's ed25519
// signature (release-signature.cjs, key in release-public-key.cjs) under the
// feed name THIS app asked for (its own platform + arch — so a signed feed for
// another platform never verifies), checks the whole signed offer IS what
// electron-updater parsed, and only then downloads (self) or tells the user
// (notify). A failed check is asked once more past every cache (a .sig cached
// apart from a new yml is not a forgery) before it stands. Anything less — no
// key, no signature, a bad one, a different feed — downloads nothing, logs
// why, and shows one quiet […] notice. A self install also
// downloads only its own file type (AppImage on Linux, exe on Windows).

const { refreshResidency } = require('./residency.cjs');
const { RELEASE_PUBLIC_KEYS } = require('./release-public-key.cjs');
const {
  SIGNATURE_SUFFIX,
  channelFileFor,
  checkSignedFeed,
  releasePublicKeys,
  unfitForPlatform,
} = require('./release-signature.cjs');
const { notesText } = require('./update-notes.cjs');
const path = require('path');
const connections = require('./connections.cjs');

const FEED_URL = 'https://deusneuma.ai/updates/';
const DOWNLOADS_PAGE = 'https://deusneuma.ai/download/';
const FEED_HOSTS = Object.freeze(['deusneuma.ai', 'www.deusneuma.ai']);
// A launch checks after the desk settles; an always-on desk is never more
// than 30 minutes behind a release that has passed the feed-live gate.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 5 * 1000;
// NO INSTALL IS EVER TOLD APART FROM ANOTHER. electron-updater stamps every feed request with a
// random per-install id (x-user-staging-id, kept in <userData>/.updaterId) for staged rollouts.
// We stage nothing, and the headers set here are merged over its own (computeFinalHeaders), so
// the id goes out empty: the site sees an address and a file name, as any download does.
const UPDATE_REQUEST_HEADERS = Object.freeze({ 'x-user-staging-id': '' });

/** The feed the app talks to. NEUMA_UPDATE_FEED_URL exists for the proof rig. */
const resolveFeedUrl = (env) => {
  const url = env.NEUMA_UPDATE_FEED_URL || FEED_URL;
  return url.endsWith('/') ? url : `${url}/`;
};

/** True only for an HTTP(S) feed on this machine — the local test seam. */
const isLoopbackFeed = (feedUrl) => {
  try {
    const { hostname, protocol } = new URL(feedUrl);
    const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    return loopback && (protocol === 'http:' || protocol === 'https:');
  } catch {
    return false;
  }
};

/** The one production feed the app will ask: HTTPS on the Deus Neuma site. */
const isSiteFeed = (feedUrl) => {
  try {
    const { hostname, protocol } = new URL(feedUrl);
    return FEED_HOSTS.includes(hostname) && protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Set electron-updater up for an install form and feed. impure (mutates the updater) — the one
 * place its settings live, shared by init and the update-privacy proof (scripts/prove-update-privacy.mjs).
 */
const configureUpdater = (updater, form, feedUrl) => {
  // Never on the feed's word: wireUpdater downloads only after the signature holds.
  updater.autoDownload = false;
  updater.disableDifferentialDownload = true;
  updater.requestHeaders = { ...UPDATE_REQUEST_HEADERS };
  // Linux's autoUpdater is AppImageUpdater even inside deb/rpm installs. It
  // normally refuses to check when APPIMAGE is absent; notify-only installs
  // deliberately bypass that gate while autoDownload remains false.
  updater.forceDevUpdateConfig = form === 'notify';
  updater.autoInstallOnAppQuit = form === 'self';
  updater.setFeedURL({ provider: 'generic', url: feedUrl });
};

/**
 * Which install form this process is. AppImage marks itself in the environment;
 * Windows NSIS self-updates without that marker. Other packaged forms notify.
 */
const installForm = ({ isPackaged, appimage, platform }) => {
  if (!isPackaged) return 'dev';
  return appimage || platform === 'win32' ? 'self' : 'notify';
};

/** The OS notice text per form — metadata only, never a log dump. */
const noticeFor = (form, version) => (form === 'self'
  ? {
    title: 'Deus Neuma update ready',
    body: `Version ${version} is downloaded. It installs when you quit — or restart now from the tray.`,
  }
  : {
    title: `Deus Neuma ${version} is available`,
    body: 'Open the downloads page to fetch it — your package manager installs it.',
  });

/** The quiet notice for an offered update whose signature did not hold. */
const unverifiedNoticeFor = (version) => ({
  title: `Deus Neuma ${version} is available — it could not be verified`,
  body: 'It was not downloaded, and nothing on this machine changed.',
});

/** The quiet notice for a signed offer whose update file is not this install's type. */
const unfitNoticeFor = (version) => ({
  title: `Deus Neuma ${version} is available — not as an update for this install`,
  body: 'Its update file does not fit this system, so it was not downloaded. Get it from the downloads page.',
});

/**
 * What the tray menu gains, as data: an entry or null. `ready` (a downloaded
 * update awaiting install) outranks `available` (a system-package install that
 * must be fetched by hand).
 */
const trayUpdateEntry = ({ form, ready, availableVersion }) => {
  if (ready) return { label: 'RESTART TO UPDATE', action: 'restart' };
  if (form === 'notify' && availableVersion) {
    return { label: `DOWNLOAD DEUS NEUMA ${availableVersion}`, action: 'open-downloads' };
  }
  return null;
};

// ── impure below — everything touches the process or the network ──

// Module-level live state — main.cjs is a singleton process, and the tray menu
// rebuild needs to reach it without main holding an updater reference.
let live = null; // { form, updater, shell, check } after a successful init
// notes: the verified offer's releaseNotes — the SIGNED feed's text, never the bare offer's
let state = { form: 'dev', ready: false, availableVersion: null, notes: null };
let timers = [];

/** The update on offer right now, as data the desk's bar reads (update-bar.cjs). */
const updateOffer = () => ({ ...state });

// impure — the one restart that installs: only on the person's press (tray, or the desk's bar)
/**
 * The person's own "Check now": asked even while the update check is switched off, because the
 * person asked. impure — one feed request.
 * @returns {Promise<{ok: boolean, version?: string|null, reason?: string}>}
 */
const checkNow = async () => {
  if (!live) return { ok: false, reason: 'this build does not update itself' };
  const checked = await live.check();
  return { ok: checked, version: state.availableVersion };
};

const restartToUpdate = () => {
  if (!live || !state.ready) return false;
  live.updater.quitAndInstall(false, true);
  return true;
};

/**
 * What the tray gains right now: one entry, or nothing. Safe to call before
 * init (dev desks, the first menu build) — it answers [] until an event lands.
 */
// impure — the click closures act on the live updater/shell
const trayItems = () => {
  if (!live) return [];
  const entry = trayUpdateEntry(state);
  if (!entry) return [];
  return [{
    label: entry.label,
    click: () => (entry.action === 'restart' ? restartToUpdate() : live.shell.openExternal(DOWNLOADS_PAGE)),
  }];
};

// impure — the feed electron-updater just read, fetched again as bytes, with its detached signature.
// Every read sends no-cache (fetch's no-store mode adds the headers), but a CDN may answer from its
// cache anyway: the fresh read also carries a query no cache has seen, as electron-updater's does.
const fetchSignedFeed = async (fetchImpl, feedUrl, channelFile, fresh = false) => {
  const bust = fresh ? `?noCache=${Date.now().toString(36)}` : '';
  const options = { credentials: 'omit', cache: 'no-store' };
  const ask = (name) => fetchImpl(new URL(`${name}${bust}`, feedUrl).href, options);
  const yml = await ask(channelFile);
  if (!yml.ok) throw new Error(`${channelFile} answered ${yml.status}`);
  const ymlBytes = Buffer.from(await yml.arrayBuffer());
  const sig = await ask(`${channelFile}${SIGNATURE_SUFFIX}`);
  if (sig.status === 404) return { ymlBytes, sigText: null };
  if (!sig.ok) throw new Error(`${channelFile}${SIGNATURE_SUFFIX} answered ${sig.status}`);
  return { ymlBytes, sigText: await sig.text() };
};

/**
 * The verdict on an offer from the signed feed on the site. A failing verdict is asked again once,
 * past every cache, before it stands — it still fails closed. impure (network)
 * @param {{ fetchImpl: Function, feedUrl: string, channelFile: string,
 *   publicKey: import('node:crypto').KeyObject|import('node:crypto').KeyObject[], offered: object }} input
 * @returns {Promise<{ ok: true, signed: object, refreshed: boolean } | { ok: false, reason: string,
 *   firstReason?: string }>}
 */
const siteVerdict = async ({ fetchImpl, feedUrl, channelFile, publicKey, offered }) => {
  const read = async (fresh) => {
    try {
      const { ymlBytes, sigText } = await fetchSignedFeed(fetchImpl, feedUrl, channelFile, fresh);
      return checkSignedFeed({ fileName: channelFile, ymlBytes, sigText, publicKey, offered });
    } catch (error) {
      return { ok: false, reason: `the signed feed could not be fetched: ${error.message}` };
    }
  };
  const first = await read(false);
  if (first.ok) return { ...first, refreshed: false };
  const second = await read(true);
  return second.ok ? { ...second, refreshed: true, firstReason: first.reason } : second;
};

/**
 * Wire a configured updater to the app: verify every offer, then download (self) or tell the
 * user (notify); notices and the tray follow. Shared by init and the signature proof
 * (scripts/prove-update-signature.mjs), so the proof drives this exact code.
 *
 * @param {{ updater: object, form: 'self'|'notify', feedUrl: string, Notification: any,
 *   refreshTray: () => void, log: object, publicKeyText: string|string[], fetchImpl: Function,
 *   channelFile: string, platform?: string }} deps — publicKeyText: the embedded form, or the list
 *   of trusted ones (release-public-key.cjs); channelFile: the feed name derived from THIS app's
 *   platform + arch
 * @returns {{ check: () => Promise<boolean> }}
 */
// impure
const wireUpdater = ({
  updater, form, feedUrl, Notification, refreshTray, log, publicKeyText, fetchImpl, channelFile,
  platform = process.platform,
}) => {
  const publicKeys = releasePublicKeys(publicKeyText);
  state = { form, ready: false, availableVersion: null, notes: null };
  const noticed = new Set(); // one OS notice per kind per version per run
  const announce = (key, { title, body }, silent) => {
    if (noticed.has(key)) return;
    noticed.add(key);
    log.info?.(`[neuma] update notice — ${title}`);
    try {
      new Notification({ title, body, silent }).show();
    } catch (error) {
      log.warn(`[neuma] update notice failed: ${error.message}`);
    }
  };

  // impure — the verdict on an offer; without a key there is nothing to fetch
  const verdictOn = async (info) => {
    if (publicKeys.length === 0) return { ok: false, reason: 'no release public key is embedded in this build' };
    const verdict = await siteVerdict({ fetchImpl, feedUrl, channelFile, publicKey: publicKeys, offered: info });
    if (verdict.refreshed) log.info?.(`[neuma] update ${info.version}: the first read was stale (${verdict.firstReason}); the fresh read verified`);
    return verdict;
  };

  // impure — the gate between […] and any byte of X
  const verifyOffer = async (info) => {
    const verdict = await verdictOn(info);
    if (!verdict.ok) {
      log.warn(`[neuma] update ${info.version} not downloaded — ${verdict.reason}`);
      announce(`unverified ${info.version}`, unverifiedNoticeFor(info.version), true);
      return;
    }
    log.info?.(`[neuma] update ${info.version} carries a valid release signature`);
    const unfit = form === 'self' ? unfitForPlatform(verdict.signed, platform) : null;
    if (unfit) {
      log.warn(`[neuma] update ${info.version} not downloaded — ${unfit}`);
      announce(`unfit ${info.version}`, unfitNoticeFor(info.version), true);
      return;
    }
    state = { ...state, availableVersion: info.version, notes: notesText(verdict.signed?.releaseNotes) };
    if (form === 'self') {
      // A failed download is dispatched as the updater's 'error' event, logged below.
      updater.downloadUpdate().catch(() => {});
    } else {
      announce(info.version, noticeFor(form, info.version), false); // self announces on downloaded
    }
    refreshTray();
  };

  let verifying = null; // a check never overlaps a verification: downloadUpdate takes the LATEST offer
  updater.on('update-available', (info) => {
    verifying = verifyOffer(info).finally(() => { verifying = null; });
  });
  updater.on('update-downloaded', (info) => {
    const notes = state.availableVersion === info.version ? state.notes : null;
    state = { ...state, ready: true, availableVersion: info.version, notes };
    announce(info.version, noticeFor(form, info.version), false);
    refreshTray();
  });
  // The swap moves the AppImage to its new versioned name and deletes the old: the login entry follows.
  updater.on('appimage-filename-updated', (file) => refreshResidency({ appImage: file }));
  updater.on('update-not-available', () => log.info?.('[neuma] up to date'));
  updater.on('error', (error) => log.warn(`[neuma] update check failed: ${error.message}`));

  // The site, or the local proof seam — nothing else is ever asked.
  const check = async () => {
    if (!isSiteFeed(feedUrl) && !isLoopbackFeed(feedUrl)) {
      log.warn('[neuma] update feed is not the Deus Neuma site — refusing the check');
      return false;
    }
    if (verifying) return false;
    const result = await updater.checkForUpdates().catch(() => null);
    if (verifying) await verifying;
    return !!result;
  };
  return { check };
};

/**
 * Wire the updater. No-ops in dev. Never throws: an update check is the least
 * important thing the app does, and it must never cost a boot.
 *
 * @param {{ app: object, shell: object, Notification: any,
 *   refreshTray: () => void, env?: object, platform?: string, log?: object }} deps
 */
// impure
const init = ({
  app,
  shell,
  Notification,
  refreshTray,
  env = process.env,
  platform = process.platform,
  log = console,
}) => {
  const form = installForm({ isPackaged: app.isPackaged, appimage: !!env.APPIMAGE, platform });
  if (form === 'dev') return { form };
  // The login entry starts this app's own file (residency.cjs): kept current at each packaged launch.
  refreshResidency({ appImage: env.APPIMAGE || null });

  const feedUrl = resolveFeedUrl(env);

  let updater;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch (error) {
    log.warn(`[neuma] auto-update unavailable: ${error.message}`);
    return { form };
  }
  try {
    configureUpdater(updater, form, feedUrl);
  } catch (error) {
    // A malformed NEUMA_UPDATE_FEED_URL threw here and quit the whole app at launch.
    log.warn(`[neuma] update feed unusable — no update checks: ${error.message}`);
    return { form };
  }
  // Chromium's stack, as electron-updater's own requests use (system proxy included); no cookies.
  const { net } = require('electron');
  const { check } = wireUpdater({
    updater,
    form,
    feedUrl,
    Notification,
    refreshTray,
    log,
    publicKeyText: RELEASE_PUBLIC_KEYS,
    fetchImpl: (url, options) => net.fetch(url, options),
    channelFile: channelFileFor(platform, process.arch),
    platform,
  });

  live = { form, updater, shell, check };

  // OFF UNTIL TURNED ON (CONNECTIONS, Design note, 2026-10-25: the timers ask the person's switch at every
  // tick, so turning it on or off in Settings takes effect without a restart, and nothing is asked
  // of the site while it is off.
  const dataRoot = connections.dataRootFor({ env, isPackaged: app.isPackaged, home: app.getPath('home'), repoRoot: path.join(__dirname, '..') });
  const scheduled = () => (connections.isOn('update-check', { env, dataRoot }) ? check() : false);
  timers = [
    setTimeout(scheduled, FIRST_CHECK_DELAY_MS),
    setInterval(scheduled, CHECK_INTERVAL_MS),
  ];
  timers.forEach((t) => t.unref?.());

  return {
    form,
    check, // the proof rig drives a check directly instead of waiting five seconds
  };
};

module.exports = {
  FEED_URL,
  DOWNLOADS_PAGE,
  CHECK_INTERVAL_MS,
  resolveFeedUrl,
  FIRST_CHECK_DELAY_MS,
  UPDATE_REQUEST_HEADERS,
  configureUpdater,
  isLoopbackFeed,
  isSiteFeed,
  installForm,
  noticeFor,
  unverifiedNoticeFor,
  unfitNoticeFor,
  trayUpdateEntry,
  trayItems,
  updateOffer,
  checkNow,
  restartToUpdate,
  siteVerdict,
  wireUpdater,
  init,
};
