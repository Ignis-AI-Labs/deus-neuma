// auto-update.cjs — the update pipeline, client side.
//
// THE BARGAIN (Design note, 2026-08-11: […] A packaged NEUMA checks shortly after boot and every
// 30 minutes, downloads in the background, and installs on the next quit. The
// operator's only surface is a tray entry and one quiet OS notice — the desk
// itself is never interrupted.
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

const FEED_URL = 'https://deusneuma.ai/updates/';
const DOWNLOADS_PAGE = 'https://deusneuma.ai/download';
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
  updater.autoDownload = form === 'self';
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
let live = null; // { form, updater, shell } after a successful init
let state = { ready: false, availableVersion: null };
let timers = [];

/**
 * What the tray gains right now: one entry, or nothing. Safe to call before
 * init (dev desks, the first menu build) — it answers [] until an event lands.
 */
// impure — the click closures act on the live updater/shell
const trayItems = () => {
  if (!live) return [];
  const entry = trayUpdateEntry({ form: live.form, ...state });
  if (!entry) return [];
  return [{
    label: entry.label,
    click: () => (entry.action === 'restart'
      ? live.updater.quitAndInstall(false, true)
      : live.shell.openExternal(DOWNLOADS_PAGE)),
  }];
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

  const feedUrl = resolveFeedUrl(env);

  let updater;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch (error) {
    log.warn(`[neuma] auto-update unavailable: ${error.message}`);
    return { form };
  }
  live = { form, updater, shell };
  configureUpdater(updater, form, feedUrl);

  const noticed = new Set(); // one OS notice per version per run
  const announce = (version) => {
    if (noticed.has(version)) return;
    noticed.add(version);
    try {
      const { title, body } = noticeFor(form, version);
      const note = new Notification({ title, body, silent: false });
      note.show();
    } catch (error) {
      log.warn(`[neuma] update notice failed: ${error.message}`);
    }
  };

  updater.on('update-available', (info) => {
    state.availableVersion = info.version;
    if (form === 'notify') announce(info.version); // self announces on downloaded
    refreshTray();
  });
  updater.on('update-downloaded', (info) => {
    state = { ready: true, availableVersion: info.version };
    announce(info.version);
    refreshTray();
  });
  updater.on('update-not-available', () => log.info?.('[neuma] up to date'));
  updater.on('error', (error) => log.warn(`[neuma] update check failed: ${error.message}`));

  // The site, or the local proof seam — nothing else is ever asked.
  const check = () => {
    if (!isSiteFeed(feedUrl) && !isLoopbackFeed(feedUrl)) {
      log.warn('[neuma] update feed is not the Deus Neuma site — refusing the check');
      return Promise.resolve(false);
    }
    return updater.checkForUpdates().then((result) => !!result).catch(() => false);
  };

  timers = [
    setTimeout(check, FIRST_CHECK_DELAY_MS),
    setInterval(check, CHECK_INTERVAL_MS),
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
  trayUpdateEntry,
  trayItems,
  init,
};
