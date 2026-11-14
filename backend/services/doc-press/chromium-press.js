/**
 * Chromium press — renders a complete HTML document to PDF bytes. // impure
 *
 * Drives a local Chromium binary over the raw DevTools protocol (CDP) using
 * the ws dependency we already carry — no Puppeteer/Playwright runtime dep.
 * Binary resolution order: NEUMA_CHROMIUM_PATH → Playwright's cached
 * chromium builds → common system install paths.
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import WebSocket from 'ws';
import { createLogger } from './../logger.js';
import { helperEnvironment } from '../agent-terminal-environment.js';
import { PRESS_DIR_PREFIX, recordPressOwner, sweepOrphanedPresses } from './press-orphans.js';
import { BADGE_MARK } from './document-shell.js';

const log = createLogger('DocPress.Chromium');

const LAUNCH_TIMEOUT_MS = 20_000;
const RENDER_TIMEOUT_MS = 60_000;
const WS_MAX_PAYLOAD = 512 * 1024 * 1024;

const PAPER_SIZES_IN = Object.freeze({
  letter: Object.freeze({ width: 8.5, height: 11 }),
  a4: Object.freeze({ width: 8.27, height: 11.69 }),
  legal: Object.freeze({ width: 8.5, height: 14 })
});

// Every layout Playwright has shipped, newest build first: `chrome-linux/` up to
// build 1161, `chrome-linux64/` since; the headless shells after the full
// browsers. Knowing only the first layout, the press lived on a stale 1161 —
// pruned, the press would have left every catalog without a word (2026-10-28).
const PLAYWRIGHT_LAYOUTS = Object.freeze([
  Object.freeze({ dir: /^chromium-(\d+)$/, bins: Object.freeze([['chrome-linux64', 'chrome'], ['chrome-linux', 'chrome']]) }),
  Object.freeze({ dir: /^chromium_headless_shell-(\d+)$/, bins: Object.freeze([
    ['chrome-headless-shell-linux64', 'chrome-headless-shell'], ['chrome-linux', 'headless_shell']]) }),
]);

function playwrightChromiums() {
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return PLAYWRIGHT_LAYOUTS.flatMap(({ dir, bins }) => names
    .filter((name) => dir.test(name))
    .sort((a, b) => Number(b.match(dir)[1]) - Number(a.match(dir)[1]))
    .flatMap((name) => bins.map((parts) => path.join(root, name, ...parts))));
}

const SYSTEM_CHROMIUMS = Object.freeze([
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome'
]);

/**
 * Finds a usable Chromium binary or throws with guidance. // impure (fs probes)
 * @returns {string}
 */
export function locateChromium() {
  const fromEnv = process.env.NEUMA_CHROMIUM_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      throw new Error(`NEUMA_CHROMIUM_PATH is set but does not exist: ${fromEnv}`);
    }
    return fromEnv;
  }
  const found = [...playwrightChromiums(), ...SYSTEM_CHROMIUMS].find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'No Chromium found for PDF pressing. Install Chrome/Chromium or set NEUMA_CHROMIUM_PATH to a browser binary.'
    );
  }
  return found;
}

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// The press renders text a being wrote; its browser needs a home, a path, a
// locale and its font config, never the backend's secrets.
const PRESS_RUNTIME_KEY = /^(FONTCONFIG_|LC_|LANGUAGE$)/;

/**
 * The environment the press's Chromium starts with. Pure; the input is never mutated.
 * @param {Record<string, string|undefined>} env
 * @param {string} [platform]
 * @returns {Record<string, string>}
 */
export const pressEnvironment = (env, platform = process.platform) =>
  helperEnvironment(env, platform, (key) => PRESS_RUNTIME_KEY.test(key));

function launchChromium(executable, profileDir) {
  const args = [
    ...(/headless[_-]shell/.test(executable) ? [] : ['--headless=new']),
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    'about:blank'
  ];
  // Its own process group, so the press ends the browser with every helper it spawned.
  const child = spawn(executable, args, {
    env: pressEnvironment(process.env),
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const wsUrl = new Promise((resolve, reject) => {
    let stderrTail = '';
    const timer = setTimeout(
      () => reject(new Error(`Chromium did not expose DevTools within ${LAUNCH_TIMEOUT_MS}ms: ${stderrTail.slice(-500)}`)),
      LAUNCH_TIMEOUT_MS
    );
    child.stderr.on('data', (chunk) => {
      stderrTail += chunk.toString();
      const match = stderrTail.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited before DevTools came up (code ${code}): ${stderrTail.slice(-500)}`));
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return { child, wsUrl };
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { maxPayload: WS_MAX_PAYLOAD });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function createCdpClient(socket) {
  const pending = new Map();
  const eventWaiters = new Set();
  const listeners = new Set();
  let nextId = 1;

  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`CDP ${msg.error.message || 'error'}`));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      for (const listener of listeners) {
        if (listener.method === msg.method && listener.sessionId === msg.sessionId) listener.handle(msg.params);
      }
      for (const waiter of [...eventWaiters]) {
        if (waiter.method === msg.method && (!waiter.sessionId || waiter.sessionId === msg.sessionId)) {
          eventWaiters.delete(waiter);
          waiter.resolve(msg.params);
        }
      }
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const waitForEvent = (method, sessionId, ms) =>
    withTimeout(
      new Promise((resolve) => {
        eventWaiters.add({ method, sessionId, resolve });
      }),
      ms,
      `CDP event ${method}`
    );

  const on = (method, sessionId, handle) => listeners.add({ method, sessionId, handle });

  return { send, waitForEvent, on };
}

// pure — may the press page load this URL? Only its own document and inline
// data. A pressed body may carry raw HTML, and a file:// page would otherwise
// pull any file the backend can read into the PDF (an iframe, an img by path)
// for the being to read back; http(s) would reach loopback services the same
// way (audit 2026-10-19). Every brand asset is already inlined as data:.
export const pressMayLoad = (url, documentUrl) => url === documentUrl || /^(data|blob):/i.test(url);

// The Fetch filter above never sees a WebSocket, and a script in a pressed
// body opened one to a loopback service and printed its reply into the PDF
// (recheck 2026-10-20, §7). The press needs no script at all — charts are
// SVG, assets are data: — so the page runs none, and its policy forbids every
// connection besides. Two layers: the CDP switch holds even if a body breaks
// out of the head, the policy holds even if the switch is ever lost.
const PRESS_CONTENT_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:";
const POLICY_META = `<meta http-equiv="Content-Security-Policy" content="${PRESS_CONTENT_POLICY}">`;

/**
 * pure — the document with the press policy as its first element. A meta
 * before <html> opens the head itself, so the policy precedes anything the
 * body could carry; after the doctype, so standards mode is kept.
 * @param {string} html
 * @returns {string}
 */
export const withPressPolicy = (html) => {
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype
    ? `${doctype[0]}${POLICY_META}${html.slice(doctype[0].length)}`
    : `${POLICY_META}${html}`;
};

// A badge this small rides as it is; a larger raster badge is drawn at a height that prints sharp
// at 12 px (4x) and that small image takes its place in the running header (deus-neuma #33).
const BADGE_INLINE_MAX_BYTES = 16 * 1024;
const BADGE_DRAWN_HEIGHT_PX = 48;

// impure (CDP) — the badge drawn at BADGE_DRAWN_HEIGHT_PX tall on a transparent ground, as a PNG
// data URI, or null (the caller keeps the original). No page script runs: the page is laid out by
// Chromium, measured through the DOM domain and photographed by the screenshot domain.
const drawBadgeSmall = async (cdp, sessionId, badgeUrl, waitLoaded) => {
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);
  try {
    const loaded = waitLoaded();
    await cdp.send('Page.navigate', { url: badgeUrl }, sessionId);
    await loaded;
    const { root } = await cdp.send('DOM.getDocument', {}, sessionId);
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#badge' }, sessionId);
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId }, sessionId);
    if (!(model?.width > 0 && model?.height > 0)) return null;
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png', clip: { x: 0, y: 0, width: model.width, height: model.height, scale: 1 }, captureBeyondViewport: true,
    }, sessionId);
    return `data:image/png;base64,${data}`;
  } finally {
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', {}, sessionId).catch(() => {});
  }
};

/**
 * Renders HTML to PDF bytes through a real Chromium print pipeline. // impure
 * @param {object} params
 * @param {string} params.html - Complete HTML document
 * @param {string} [params.headerTemplate] - Print-chrome header (inline styles only)
 * @param {string} [params.footerTemplate] - Print-chrome footer
 * @param {string} [params.format] - Letter | A4 | Legal
 * @param {number} [params.marginCm] - Uniform page margin in centimeters
 * @param {string|null} [params.badge] - the kit's badge data URI, for BADGE_MARK in the header
 * @returns {Promise<Buffer>}
 */
export async function pressPdf({ html, headerTemplate, footerTemplate, format = 'Letter', marginCm = 1.5, badge = null }) {
  const paper = PAPER_SIZES_IN[String(format).toLowerCase()];
  if (!paper) {
    throw new Error(`Unsupported paper format: ${format} (supported: ${Object.keys(PAPER_SIZES_IN).join(', ')})`);
  }
  const marginIn = marginCm / 2.54;
  const executable = locateChromium();

  // A press whose owner died left its browser running; clear those first (press-orphans.js).
  const swept = await sweepOrphanedPresses().catch(() => []);
  if (swept.length) log.warn('swept orphaned presses', { count: swept.length });
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), PRESS_DIR_PREFIX));
  const htmlPath = path.join(workDir, 'document.html');
  await fs.writeFile(htmlPath, withPressPolicy(html), 'utf8');
  // the badge alone on a page of its own, when it is a raster too large to repeat on every page
  const drawBadge = Boolean(badge) && String(headerTemplate || '').includes(BADGE_MARK)
    && !badge.startsWith('data:image/svg') && badge.length > BADGE_INLINE_MAX_BYTES;
  const badgePath = path.join(workDir, 'badge.html');
  if (drawBadge) {
    await fs.writeFile(badgePath, withPressPolicy(`<!DOCTYPE html><html><body style="margin:0"><img id="badge" src="${badge}" style="height:${BADGE_DRAWN_HEIGHT_PX}px;display:block"></body></html>`), 'utf8');
  }

  const { child, wsUrl } = launchChromium(executable, path.join(workDir, 'profile'));
  let socket = null;
  try {
    await recordPressOwner(workDir, child.pid);
    socket = await openSocket(await wsUrl);
    const cdp = createCdpClient(socket);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Emulation.setScriptExecutionDisabled', { value: true }, sessionId);

    const documentUrl = pathToFileURL(htmlPath).href;
    const badgeUrl = pathToFileURL(badgePath).href;
    cdp.on('Fetch.requestPaused', sessionId, ({ requestId, request }) => {
      const allowed = pressMayLoad(request.url, documentUrl) || (drawBadge && pressMayLoad(request.url, badgeUrl));
      if (!allowed) log.info('press page load blocked', { scheme: request.url.split(':')[0] });
      cdp.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' }, sessionId)
        .catch((err) => log.warn('press request verdict not delivered', { err: err.message }));
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);

    let header = headerTemplate || '<div></div>';
    if (header.includes(BADGE_MARK)) {
      const small = drawBadge
        ? await drawBadgeSmall(cdp, sessionId, badgeUrl, () => cdp.waitForEvent('Page.loadEventFired', sessionId, RENDER_TIMEOUT_MS))
          .catch((err) => { log.warn('the badge could not be drawn small — it rides as it is', { err: err.message }); return null; })
        : null;
      header = header.replace(BADGE_MARK, small || badge || '');
    }

    const loaded = cdp.waitForEvent('Page.loadEventFired', sessionId, RENDER_TIMEOUT_MS);
    await cdp.send('Page.navigate', { url: documentUrl }, sessionId);
    await loaded;

    const { data } = await withTimeout(
      cdp.send(
        'Page.printToPDF',
        {
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: header,
          footerTemplate: footerTemplate || '<div></div>',
          paperWidth: paper.width,
          paperHeight: paper.height,
          marginTop: marginIn,
          marginBottom: marginIn,
          marginLeft: marginIn,
          marginRight: marginIn,
          preferCSSPageSize: false
        },
        sessionId
      ),
      RENDER_TIMEOUT_MS,
      'Page.printToPDF'
    );

    await cdp.send('Browser.close').catch(() => {});
    return Buffer.from(data, 'base64');
  } finally {
    if (socket) {
      try {
        socket.close();
      } catch {
        // socket already gone — nothing to release
      }
    }
    // The whole group: the browser's helpers can outlive its own exit.
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // the group is already gone
      }
    }
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      // Wait for the process to actually die — removing the profile dir
      // while Chromium is still flushing it races into ENOTEMPTY.
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    }
    await fs.rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }).catch((err) => {
      log.warn('Could not remove press work dir', { workDir, err: err.message });
    });
  }
}
