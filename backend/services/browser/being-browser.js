// being-browser — a neuma's own browser, on the operator's own computer.
//
// Design note, 2026-11-17: […]. So a neuma gets
// a BROWSER, not a machine: one Chromium per working being, with its own profile folder (its sign-ins
// never mix with another being's), started on its first browser act and closed after IDLE_MS without
// one. The profile stays on disk, so its sign-ins are there next time. At most MAX_OPEN run at once.
// Idle costs nothing.
//
// Every byte it sends leaves through the guarded relay (watch-egress.js): outward to the open
// internet only — never this computer, never its network — with every name resolved once and
// pinned. Loopback is forced through the relay too (`<-loopback>`), so a page that points the
// browser at the backend, a model server or a router is refused, and the being is told so.
// impure (processes, files, sockets)
import fs from 'node:fs/promises';
import path from 'node:path';
import { openCdpPipe } from './cdp-pipe.js';
import { look, navigate, click, type, back } from './page-ops.js';
import { startWatchEgress } from '../watch/watch-egress.js';
import { locateChromium, pressEnvironment } from '../doc-press/chromium-press.js';
import { getDataRoot } from '../data-root.js';
import { createLogger } from '../logger.js';

const log = createLogger('BeingBrowser');

export const IDLE_MS = 10 * 60_000;
export const MAX_OPEN = 2;
const LANE_ID = /^[A-Za-z0-9_-]+$/;

const sessions = new Map();
let exitHookSet = false;

/**
 * Where a neuma's browser keeps its profile (sign-ins, cookies, history): beside the house's data,
 * outside every lane, so no being's file tools can read another's sign-ins — or its own cookie jar.
 * Pure given the data root.
 */
export const browserProfileDir = (laneId, dataRoot = getDataRoot()) => {
  if (!LANE_ID.test(String(laneId || ''))) throw new Error('not a lane id');
  return path.join(dataRoot, 'browsers', laneId);
};

/** The launch flags for a neuma's browser. Pure. */
const browserFlags = (executable, profileDir, relayUrl) => [
  ...(/headless[_-]shell/.test(executable) ? [] : ['--headless=new']),
  `--user-data-dir=${profileDir}`,
  `--proxy-server=${relayUrl}`,
  // Chromium sends loopback around a proxy by default; this sends it through, to be refused.
  '--proxy-bypass-list=<-loopback>',
  // WebRTC can reach the local network around a proxy; keep it to proxied paths only.
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
  '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
  '--disable-gpu', '--mute-audio', '--window-size=1280,900',
  'about:blank',
];

// A lane's entry is a promise while its browser starts, the session once it has.
const settled = (entry) => (entry && typeof entry.then !== 'function' ? entry : null);

const killAll = () => { for (const entry of sessions.values()) settled(entry)?.cdp.kill(); };

// impure — drop a closed browser from the house's list and shut its relay
const forget = (laneId, session) => {
  if (sessions.get(laneId) !== session) return;
  sessions.delete(laneId);
  clearTimeout(session.idleTimer);
  session.relay.close().catch(() => {});
};

const touch = (laneId, session) => {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => { closeBrowser(laneId); }, IDLE_MS);
  session.idleTimer.unref?.();
};

// impure — start a Chromium for one lane and attach to its page
const launch = async (laneId) => {
  const executable = locateChromium();
  const profile = browserProfileDir(laneId);
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  const relay = await startWatchEgress();
  const cdp = openCdpPipe(executable, browserFlags(executable, profile, relay.url), pressEnvironment(process.env));
  try {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    const { targetInfos } = await cdp.send('Target.getTargets');
    const targetId = targetInfos.find((t) => t.type === 'page')?.targetId
      || (await cdp.send('Target.createTarget', { url: 'about:blank' })).targetId;
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);
    await send('Page.enable');
    const session = { cdp, relay, send, view: null, idleTimer: null };
    cdp.events.once('exit', () => forget(laneId, session));
    if (!exitHookSet) {
      process.once('exit', killAll);
      exitHookSet = true;
    }
    log.info('A neuma\'s browser started', { laneId, executable });
    return session;
  } catch (error) {
    cdp.kill();
    await relay.close();
    throw new Error(`the browser would not start: ${error.message} ${cdp.stderrTail().slice(-300)}`.trim(), { cause: error });
  }
};

/** The lane's browser if one is running — never starts one. */
export const runningBrowser = (laneId) => settled(sessions.get(laneId));

/**
 * The lane's browser, started if it is not running. impure
 * @returns {Promise<{ok: true, session: object} | {ok: false, error: string}>}
 */
export const browserFor = async (laneId) => {
  const running = sessions.get(laneId);
  if (running) {
    try {
      const session = await running;
      touch(laneId, session);
      return { ok: true, session };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  if (sessions.size >= MAX_OPEN) {
    return { ok: false, error: `the house's browsers are all in use (${MAX_OPEN} of ${MAX_OPEN}); one closes after ${IDLE_MS / 60_000} idle minutes` };
  }
  // The promise holds the place while it starts, so two acts at once never start two browsers.
  const starting = launch(laneId);
  sessions.set(laneId, starting);
  try {
    const session = await starting;
    sessions.set(laneId, session);
    touch(laneId, session);
    return { ok: true, session };
  } catch (error) {
    sessions.delete(laneId);
    return { ok: false, error: error.message };
  }
};

/** Close a lane's browser now; its profile (and sign-ins) stay on disk. impure */
export const closeBrowser = async (laneId) => {
  const held = sessions.get(laneId);
  if (!held) return false;
  const session = await held;
  session.cdp.kill();
  forget(laneId, session);
  return true;
};

/**
 * Do one act in a lane's page and read the page after it. The relay's refusals that the act set off
 * ride along, so the being knows a blocked address was blocked, not empty. impure
 * @param {object} session - from browserFor
 * @param {{kind: 'open'|'click'|'type'|'back'|'look', url?: string, ref?: number, text?: string, enter?: boolean}} act
 */
export const actInPage = async (session, act) => {
  const mark = session.relay.refused.length;
  const out = act.kind === 'open' ? await navigate(session.send, act.url)
    : act.kind === 'click' ? await click(session.send, act.ref)
      : act.kind === 'type' ? await type(session.send, act.ref, act.text, act.enter)
        : act.kind === 'back' ? await back(session.send)
          : { ok: true };
  const refused = session.relay.refused.slice(mark);
  if (!out.ok) return { ok: false, error: out.error, refused };
  session.view = await look(session.send);
  return { ok: true, view: session.view, refused };
};
