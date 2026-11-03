// @ts-check
// THE STREAM RULER — what a long conversation and a streaming reply cost the
// desk, and what typing feels like while it streams.
//
// The being's frames are REPLAYED into the desk's real portal socket
// (Playwright routeWebSocket: the socket still reaches the real backend and
// every other frame passes through untouched). This is a load generator for
// the RENDER path under measurement — it claims nothing about a model, and no
// model or GPU is touched. Frames use the portal's own wire shape
// (`consciousness:stream` {content, turnId} → `consciousness:complete`).
//
// Records: the transcript build (N turns), one long reply streamed at ~60
// frames/s (main-thread ms, layouts, style recalcs, long tasks, frames and the
// worst frame gap), keystroke latency in the composer DURING that stream
// (Event Timing: input → next paint), and the desk at rest with the
// transcript on screen. Writes test-results/perf/stream-<stamp>.json.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { setupPerfStack, initPerfSession, perf, REPO, PERF_LAUNCH } from '../helpers/perf-harness.js';
import { passDeskGates } from '../helpers/desk-gates.js';

setupPerfStack();
test.use({ viewport: { width: 1600, height: 900 }, launchOptions: PERF_LAUNCH });

const TURNS = Number(process.env.PERF_TURNS) || 150;
const METRICS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
const readMetrics = async (cdp) => {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.filter((m) => METRICS.includes(m.name)).map((m) => [m.name, m.value]));
};
const deltaMs = (a, b) => Object.fromEntries(METRICS.map((k) => [k,
  k.endsWith('Count') ? b[k] - a[k] : Math.round((b[k] - a[k]) * 1000)]));

// A reply shaped like a real one: paragraphs, a list, inline code, a fence.
const REPLY = [
  'Here is how I would approach it, step by step, with the reasoning laid out.',
  '',
  'First, the **measurement** has to come before any change. A number that was never taken cannot be improved, only guessed at.',
  '',
  '1. Take the baseline on the stack the operator actually uses.',
  '2. Rank the costs by what a person feels — a stalled keystroke outranks a slow background poll.',
  '3. Fix the worst first, then take the number again.',
  '',
  'The render path is where most of the felt cost hides. `memo` only holds when every prop is stable:',
  '',
  '```js',
  'const onRetry = useCallback((id) => retry(id), [retry]);',
  'const view = useMemo(() => messages.map(toView), [messages]);',
  '```',
  '',
  'Then the long-lived surfaces: the transcript, the file tree, the run ledger. Each should do work proportional to what changed, never to its whole history.',
  '',
  'Finally the backend: a window that opens should never wait on a directory walk or a child process it could have cached.',
].join('\n');

const chunksOf = (text, size = 6) => {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
};

test('stream: a long transcript, a streaming reply, and typing through it', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  let client = null;
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
    client = ws;
  });
  await page.addInitScript(() => {
    window.__lt = [];
    window.__ev = [];
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); })
        .observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (e.name === 'keydown' || e.name === 'keypress' || e.name === 'input') window.__ev.push(e.duration);
      }).observe({ type: 'event', durationThreshold: 16, buffered: true });
    } catch { /* timing APIs unavailable */ }
  });
  // A/B lever: PERF_CSS injects a stylesheet before the desk paints, so a
  // suspected paint cost can be measured with and without (the ruler's own
  // experiment door — never a fix).
  if (process.env.PERF_CSS) await page.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const el = document.createElement('style'); el.textContent = css; document.head.appendChild(el);
    });
  }, process.env.PERF_CSS);
  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await passDeskGates(page, 10000);
  // The stream window as someone working in it holds it: maximized. And VOX
  // off — a replayed reply must never reach a speech engine.
  const streamWin = page.locator('.fwin').filter({ has: page.locator('.relink-input-field') }).first();
  await streamWin.waitFor({ timeout: 30000 });
  const ctls = streamWin.locator('.fwin-bar-controls > button.fwin-ctl');
  await ctls.nth((await ctls.count()) - 2).click(); // minimize · MAXIMIZE · close
  await page.waitForTimeout(400);
  const vox = page.locator('button', { hasText: /^(VOX|SND)\s*ON$/ });
  if (await vox.count()) await vox.first().click();
  await page.locator('button', { hasText: /^(VOX|SND)\s*OFF$/ }).first().waitFor({ timeout: 5000 });
  await page.locator('.relink-input-field').first().waitFor({ timeout: 30000 });
  if (!client) throw new Error('the portal socket was never opened');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  const send = (frame) => client.send(JSON.stringify(frame));
  const turn = async (id, text, gapMs) => {
    for (const c of chunksOf(text)) {
      send({ type: 'consciousness:stream', content: c, turnId: id });
      if (gapMs) await page.waitForTimeout(gapMs);
    }
    send({ type: 'consciousness:complete', turnId: id });
  };

  // ── Build the transcript: TURNS replies, fast.
  let m0 = await readMetrics(cdp);
  const tb = Date.now();
  for (let i = 0; i < TURNS; i++) {
    /* eslint-disable-next-line no-await-in-loop */
    await turn(`perf-hist-${i}`, `History reply ${i}. ${REPLY.slice(0, 400)}`, 0);
    /* eslint-disable-next-line no-await-in-loop */
    if (i % 10 === 9) await page.waitForTimeout(100);
  }
  await page.locator('.relink-msg').nth(TURNS - 1).waitFor({ timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(3000); // let the paced reveal of the last rows finish
  const build = { turns: TURNS, ms: Date.now() - tb, rows: await page.locator('.relink-msg').count(), ...deltaMs(m0, await readMetrics(cdp)) };

  // ── At rest with the transcript on screen.
  m0 = await readMetrics(cdp);
  await page.waitForTimeout(3000);
  const rest = deltaMs(m0, await readMetrics(cdp));

  // ── Typing with nothing streaming — the floor the stream is judged against.
  const typingOf = (ev) => {
    const sorted = [...ev].sort((a, b) => a - b);
    return {
      slowEvents: ev.length, // events ≥16ms (the observer's threshold)
      p50: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0),
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      worst: Math.round(sorted[sorted.length - 1] ?? 0),
    };
  };
  await page.evaluate(() => { window.__ev.length = 0; });
  const field = page.locator('.relink-input-field').first();
  await field.click();
  await field.pressSequentially('the same sentence typed while the desk is quiet', { delay: 60 });
  const typingAtRest = typingOf(await page.evaluate(() => window.__ev.slice()));
  await field.fill('');

  // ── One long reply at ~60 frames/s, typing through it.
  await page.evaluate(() => { window.__lt.length = 0; window.__ev.length = 0; });
  const frameProbe = page.evaluate(() => new Promise((resolve) => {
    let n = 0; let worst = 0; let last = performance.now(); const t0 = last;
    const step = (t) => { n += 1; worst = Math.max(worst, t - last); last = t; if (t - t0 < 6000) requestAnimationFrame(step); else resolve({ frames: n, worstGapMs: Math.round(worst) }); };
    requestAnimationFrame(step);
  }));
  m0 = await readMetrics(cdp);
  // PERF_TRACE=1: a devtools timeline trace over the stream, summarized by
  // event name — where the main thread's time actually goes.
  const traceEvents = [];
  if (process.env.PERF_TRACE) {
    cdp.on('Tracing.dataCollected', (e) => traceEvents.push(...e.value));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
  }
  const streaming = turn('perf-live', `${REPLY}\n\n${REPLY}`, 16);
  const input = page.locator('.relink-input-field').first();
  await input.click();
  await input.pressSequentially('measuring what a keystroke costs while the being is speaking', { delay: 60 });
  await streaming;
  const f = await frameProbe;
  if (process.env.PERF_TRACE) {
    const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    await done;
    const main = traceEvents.filter((e) => e.ph === 'X' && e.dur);
    const byName = {};
    for (const e of main) byName[e.name] = (byName[e.name] || 0) + e.dur / 1000;
    // eslint-disable-next-line no-console -- the experiment's readout
    console.log('PERF-TRACE', JSON.stringify(Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, ms]) => [n, Math.round(ms)])));
    const detail = {};
    for (const e of main) {
      const d = e.args?.data;
      const k = e.name === 'EventDispatch' ? `event:${d?.type}` : e.name === 'FunctionCall' ? `fn:${d?.functionName || '?'}@${String(d?.url || '').split('/').pop()}:${d?.lineNumber}` : null;
      if (k) detail[k] = (detail[k] || 0) + e.dur / 1000;
    }
    // eslint-disable-next-line no-console
    console.log('PERF-TRACE-DETAIL', JSON.stringify(Object.entries(detail).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([n, ms]) => [n, Math.round(ms)])));
  }
  const stream = { ...deltaMs(m0, await readMetrics(cdp)), ...f };
  const lt = await page.evaluate(() => window.__lt.slice());
  const ev = await page.evaluate(() => window.__ev.slice());
  const typing = typingOf(ev);
  const longTasks = { count: lt.length, worstMs: Math.round(Math.max(0, ...lt)), totalMs: Math.round(lt.reduce((a, b) => a + b, 0)) };

  const out = path.join(REPO, 'test-results', 'perf');
  fs.mkdirSync(out, { recursive: true });
  // PERF_SHOT=name: the settled transcript as pixels, for a before/after look.
  if (process.env.PERF_SHOT) {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, `${process.env.PERF_SHOT}.png`) });
  }
  const file = path.join(out, `stream-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const report = { build, rest, typingAtRest, stream, longTasks, typing };
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console -- the ruler's own readout
  console.log('PERF-STREAM', JSON.stringify(report));
});

test('stream reveal holds while its window is shaded and resumes on return', async ({ page }) => {
  let client = null;
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => ws.send(m));
    client = ws;
  });
  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await passDeskGates(page, 10000);
  const streamWin = page.locator('.fwin').filter({ has: page.locator('.relink-input-field') }).first();
  await streamWin.waitFor({ timeout: 30000 });
  await page.locator('.relink-input-field').first().waitFor({ timeout: 30000 });
  if (!client) throw new Error('the portal socket was never opened');

  client.send(JSON.stringify({ type: 'consciousness:stream', content: 'First visible words ', turnId: 'shade-hold' }));
  const liveText = streamWin.locator('.relink-msg').last();
  await expect(liveText).toContainText('First visible', { timeout: 10000 });

  const ctls = streamWin.locator('.fwin-bar-controls > button.fwin-ctl');
  const shade = ctls.nth((await ctls.count()) - 3);
  await shade.click();
  const held = await liveText.textContent();
  client.send(JSON.stringify({ type: 'consciousness:stream', content: 'and the words that arrive while hidden', turnId: 'shade-hold' }));
  await page.waitForTimeout(350);
  expect(await liveText.textContent()).toBe(held);

  await shade.click();
  await expect.poll(async () => (await liveText.textContent())?.length || 0, { timeout: 10000 })
    .toBeGreaterThan(held.length);
  client.send(JSON.stringify({ type: 'consciousness:complete', turnId: 'shade-hold' }));
});
