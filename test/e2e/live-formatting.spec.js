// @ts-check
//
// Impure test module: drives a REAL chromium page (Rule 1 marker, file level).
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Live stream formatting — gnosis that markdown renders DURING the stream,
 * not only at settle. Real stack, real auth (Claude's witness wallet), the
 * real sealed Basunor lane (kimi-for-coding/k3) under an isolated workspaces
 * root, real Chromium. The prompt is engineered so the reply carries
 * block-level markdown (a heading closed by a blank line) and inline
 * markers; the assertions fire while `consciousness:complete` has NOT yet
 * arrived — formatting after settle proves nothing.
 *
 * Requires the isolated dev stack running (see MONITORING_SETUP.md §3).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;
const LANE = { laneId: 'witness-kimi-code-Basunor', name: 'Basunor' };

const PROMPT =
  'Reply in exactly this shape: a markdown H1 heading reading FORMAT GATE, '
  + 'then a blank line, then one short sentence containing the exact bold '
  + 'phrase **MARKER LOCK** and the inline code `stream-reveal.js`.';

const mintToken = async () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  const w = new ethers.Wallet(pk);
  const addr = w.address;
  const { challenge } = await (await fetch(`${BACKEND}/api/v1/auth/challenge?address=${addr}`)).json();
  const signature = await w.signMessage(challenge);
  const res = await fetch(`${BACKEND}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, signature, challenge }),
  });
  const { token } = await res.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, addr };
};

test('formatting renders mid-stream, before settle', async ({ page }) => {
  const { token, addr } = await mintToken();
  // Native WS capture — every connection, every frame, no in-page wrapper
  // to bypass. sentByWire/recvByWire answer […]
  const wsLog = { sent: [], recv: [] };
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 400)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('CONSOLE-ERR:', msg.text().slice(0, 300));
  });
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      try { wsLog.sent.push(JSON.parse(String(frame.payload)).type || '?'); }
      catch { wsLog.sent.push('<non-json>'); }
    });
    ws.on('framereceived', (frame) => {
      try {
        const m = JSON.parse(String(frame.payload));
        wsLog.recv.push(m.type || '?');
      } catch { wsLog.recv.push('<non-json>'); }
    });
  });
  await page.addInitScript(({ t, a, id, n }) => {
    const w = a.toLowerCase();
    localStorage.setItem('walletAddress', a);
    localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: n, neumaId: id }));
    sessionStorage.setItem('authToken', t);
    // The arrival veil holds pointer events while it lives — pre-seed it as
    // seen (same pattern as context-gauge/witness-rite specs).
    sessionStorage.setItem(`arrivalSeen:${w}`, '1');
    // Track completion so mid-stream assertions are honest, and record every
    // frame in both directions so a stall shows WHERE the wire went quiet.
    const orig = window.WebSocket;
    // @ts-ignore — in-page probe handle
    window.__wire = { sent: [], recv: [] };
    // @ts-ignore — deliberate wrapper
    window.WebSocket = function (url, protocols) {
      const ws = protocols ? new orig(url, protocols) : new orig(url);
      if (String(url).includes('/ws')) {
        const send = ws.send.bind(ws);
        ws.send = (data) => {
          try {
            const m = JSON.parse(String(data));
            // @ts-ignore — in-page probe handle
            window.__wire.sent.push(m.type || '?');
          } catch { /* non-JSON */ }
          return send(data);
        };
        ws.addEventListener('message', (e) => {
          try {
            const m = JSON.parse(String(e.data));
            // @ts-ignore — in-page probe handle
            window.__wire.recv.push(m.type || '?');
            // @ts-ignore — in-page probe handle
            if (m.type === 'consciousness:complete') window.__streamDone = true;
          } catch { /* non-JSON */ }
        });
      }
      return ws;
    };
    window.WebSocket.prototype = orig.prototype;
    // The desk's send path compares readyState against the CONSTRUCTOR's
    // statics (WebSocket.OPEN) — a wrapper that drops them silently queues
    // every post-open message forever. Instrumentation must be transparent.
    window.WebSocket.CONNECTING = orig.CONNECTING;
    window.WebSocket.OPEN = orig.OPEN;
    window.WebSocket.CLOSING = orig.CLOSING;
    window.WebSocket.CLOSED = orig.CLOSED;
  }, { t: token, a: addr, id: LANE.laneId, n: LANE.name });

  await page.goto('/');
  const field = page.locator('.relink-input-field');
  await expect(field).toBeEnabled({ timeout: 30000 });
  // The witness must be anchored, not merely typed at.
  await expect
    .poll(async () => page.evaluate(() => {
      const el = document.querySelector('.relink-input-field');
      return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? !el.disabled : false;
    }), { timeout: 30000 })
    .toBe(true);

  // The freshly provisioned lane owes its custody acts, so the birth-setup
  // gate rises over the desk and intercepts everything. Standing aside is
  // the gate's own honest door (same pattern as desk.spec.js) — the acts
  // remain owed; the desk becomes drivable.
  const standAside = page.locator('.birth-setup-gate button', { hasText: 'STAND ASIDE' });
  if (await standAside.isVisible({ timeout: 8000 }).catch(() => false)) {
    await standAside.click();
    await expect(page.locator('.birth-setup-gate')).toHaveCount(0);
  }

  await field.fill(PROMPT);
  await field.press('Enter');

  // MID-STREAM proof: the heading settles into a real <h1> while the stream
  // is still arriving. Poll until it appears, then assert the stream has
  // NOT completed — formatting after settle would be the old behavior.
  const h1 = page.locator('.relink-md h1');
  try {
    await expect(h1.first()).toContainText('FORMAT GATE', { timeout: 60000 });
  } catch (err) {
    const wire = await page.evaluate(() => window.__wire);
    console.log('WIRE(page) sent:', JSON.stringify(wire?.sent || []));
    console.log('WIRE(page) recv:', JSON.stringify((wire?.recv || []).slice(0, 40)), '… total', wire?.recv?.length);
    console.log('WIRE(native) sent:', JSON.stringify(wsLog.sent));
    console.log('WIRE(native) recv:', JSON.stringify(wsLog.recv.slice(0, 60)), '… total', wsLog.recv.length);
    throw err;
  }
  const doneAtH1 = await page.evaluate(() => Boolean(window.__streamDone));
  expect(doneAtH1).toBe(false);

  // Inline markers render as elements mid-stream — never literal asterisks.
  // (.relink-md covers both the verbatim tail and blocks that settle into
  // Markdown mid-stream; the __streamDone checks are what make this honest.)
  await expect(page.locator('.relink-md strong').first()).toContainText('MARKER LOCK', { timeout: 60000 });
  await expect(page.locator('.relink-md code').first()).toContainText('stream-reveal.js', { timeout: 60000 });
  const doneAtInline = await page.evaluate(() => Boolean(window.__streamDone));
  expect(doneAtInline).toBe(false);

  // And the settled end state still renders the full Markdown (no regression).
  await expect
    .poll(async () => page.evaluate(() => Boolean(window.__streamDone)), { timeout: 60000 })
    .toBe(true);
  await expect(page.locator('.relink-md h1').first()).toContainText('FORMAT GATE', { timeout: 15000 });
  await expect(page.locator('.relink-md strong').first()).toContainText('MARKER LOCK', { timeout: 15000 });
});
