// @ts-check
// THE SMOOTHNESS BASELINE — every dock app, opened alone on a fresh desk,
// measured from the click to settled content and then left to sit.
//
// Per app it records, from the browser's own counters:
//   openMs     click → the window is on screen
//   settledMs  click → the open's own calls (started within 2s) done for
//              400ms, and no LOADING/READING… word in the window
//              (background pollers that start later do not hold it open)
//   api        every request the open made: path, status, duration
//   main       CDP Performance deltas over the open (script, layout, style)
//   longTasks  main-thread blocks ≥50ms during the open (count, worst, total)
//   idle       3s with the window sitting: main-thread ms, requests, frames
//
// It writes the whole table to test-results/perf/baseline-<stamp>.json and
// prints a ranked summary. It ASSERTS nothing: it is the ruler, not the
// judge — budgets come once the baseline says where the time goes.
//
// GPU SAFETY: COMFY and VOICE are skipped (their windows can reach external
// engines), and any request that would launch/start/boot an engine is
// aborted and reported. The stack is isolated (perf-harness.js).
import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { setupPerfStack, initPerfSession, perf, REPO, PERF_LAUNCH } from '../helpers/perf-harness.js';
import { passDeskGates } from '../helpers/desk-gates.js';
import { openDockApp } from '../helpers/dock.js';

setupPerfStack();
test.use({ viewport: { width: 1600, height: 900 }, launchOptions: PERF_LAUNCH });

const SKIP = new Set(['COMFY', 'VOICE', 'NEW STREAM', 'TALK', 'WORK', 'CRAFT', 'WATCH', 'MEASURE']);
const ENGINE_DOOR = /\/(launch|start|boot|ensure|serve|warm)(\b|\/|$)/i;
const METRICS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];

const readMetrics = async (cdp) => {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.filter((m) => METRICS.includes(m.name)).map((m) => [m.name, m.value]));
};
const deltaMs = (a, b) => Object.fromEntries(METRICS.map((k) => [k,
  k.endsWith('Count') ? b[k] - a[k] : Math.round((b[k] - a[k]) * 1000)]));

// impure — the page keeps its own long-task ledger from the first byte.
const installObservers = (page) => page.addInitScript(() => {
  window.__lt = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); })
      .observe({ type: 'longtask', buffered: true });
  } catch { /* no long-task timing */ }
});

// impure — frames painted over `ms`.
const frames = (page, ms) => page.evaluate((span) => new Promise((resolve) => {
  let n = 0; const t0 = performance.now(); let worst = 0; let last = t0;
  const step = (t) => { n += 1; worst = Math.max(worst, t - last); last = t; if (t - t0 < span) requestAnimationFrame(step); else resolve({ frames: n, worstGapMs: Math.round(worst) }); };
  requestAnimationFrame(step);
}), ms);

// Case-sensitive whole word: an advisory titled "Auto-Loading" is content.
const STILL_LOADING = /(^|[\s«(])(LOADING|READING)(…|\.\.\.)?(?=$|[\s»)])/m;
const titles = (page) => page.locator('.fwin .fwin-bar-title').allInnerTexts();

const labelsOf = async (page) => {
  const labels = new Set();
  for (const t of await page.locator('.dock-app').allInnerTexts()) labels.add(t.trim());
  for (const s of await page.locator('.dock-section').all()) {
    await s.click();
    for (const t of await page.locator('.dock-menu-item').allInnerTexts()) labels.add(t.trim());
    const fly = page.locator('.dock-menu-fly');
    for (let i = 0; i < await fly.count(); i++) {
      await fly.nth(i).click();
      for (const t of await page.locator('.dock-menu-flyout .dock-menu-item').allInnerTexts()) labels.add(t.trim());
    }
  }
  await page.keyboard.press('Escape');
  return [...labels].filter((l) => l && !SKIP.has(l));
};

test('baseline: every dock app, opened alone, then left to sit', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  const blocked = [];
  await page.route('**/api/**', (route) => {
    const req = route.request();
    if (req.method() !== 'GET' && ENGINE_DOOR.test(new URL(req.url()).pathname)) {
      blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  await installObservers(page);
  await initPerfSession(page);
  await page.goto(`http://localhost:${perf.FPORT}/`);
  await page.locator('.dock').waitFor({ timeout: 30000 });
  await passDeskGates(page, 5000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  // Every request, timed by the browser's own timing.
  const inflight = new Map();
  const log = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) inflight.set(r, Date.now()); });
  const settle = (r, failed) => {
    if (!inflight.has(r)) return;
    const started = inflight.get(r); inflight.delete(r);
    log.push({ at: started, path: new URL(r.url()).pathname, ms: Date.now() - started, failed });
  };
  page.on('requestfinished', (r) => settle(r, false));
  page.on('requestfailed', (r) => settle(r, true));

  // The desk alone, at rest.
  await page.waitForTimeout(1500);
  let m0 = await readMetrics(cdp); let n0 = log.length;
  const deskFrames = await frames(page, 3000);
  const desk = { idle: { ...deltaMs(m0, await readMetrics(cdp)), requests: log.length - n0, ...deskFrames } };

  const labels = await labelsOf(page);
  const results = [];
  for (const label of labels) {
    /* eslint-disable no-await-in-loop -- one window at a time, by design */
    const before = new Set(await titles(page));
    await page.evaluate(() => { window.__lt.length = 0; });
    m0 = await readMetrics(cdp); n0 = log.length;
    const t0 = Date.now();
    try { await openDockApp(page, label); } catch (e) { results.push({ label, error: String(e.message).slice(0, 120) }); continue; }
    // The new window is the title that was not there before. An app that
    // opens no window (FILES is the Explorer PANEL) is measured on the page.
    let title = null;
    while (!title && Date.now() - t0 < 3000) {
      title = (await titles(page)).find((t) => !before.has(t)) ?? null;
      if (!title) await page.waitForTimeout(20);
    }
    const openMs = Date.now() - t0;
    const surface = title
      ? page.locator('.fwin').filter({ has: page.locator('.fwin-bar-title', { hasText: title }) }).first()
      : page.locator('.relink');
    let quietSince = Date.now();
    while (Date.now() - t0 < 10000) {
      const busy = [...inflight.values()].some((st) => st >= t0 && st <= t0 + 2000);
      const loading = await surface.innerText().then((t) => STILL_LOADING.test(t), () => false);
      if (busy || loading) quietSince = Date.now();
      else if (Date.now() - quietSince >= 400) break;
      await page.waitForTimeout(50);
    }
    const settledMs = Math.max(openMs, quietSince - t0);
    const main = deltaMs(m0, await readMetrics(cdp));
    const lt = await page.evaluate(() => window.__lt.slice());
    const api = log.slice(n0).map((r) => ({ path: r.path, ms: r.ms, failed: r.failed }));

    // Left to sit.
    const m1 = await readMetrics(cdp); const n1 = log.length;
    const f = await frames(page, 3000);
    const idle = { ...deltaMs(m1, await readMetrics(cdp)), requests: log.length - n1, ...f };

    results.push({
      label, kind: title ? 'window' : 'panel', openMs, settledMs, main,
      longTasks: { count: lt.length, worstMs: Math.round(Math.max(0, ...lt.map((x) => x[1]))), totalMs: Math.round(lt.reduce((sum, x) => sum + x[1], 0)) },
      api: { count: api.length, slowest: api.sort((a, b) => b.ms - a.ms).slice(0, 3) },
      idle,
    });
    // Back to the desk as found: close the window this open made (or toggle
    // the panel shut again).
    if (title) {
      await surface.getByRole('button', { name: 'Close window' }).click().catch(() => {});
      await page.waitForTimeout(450);
    } else {
      await openDockApp(page, label).catch(() => {});
      await page.waitForTimeout(300);
    }
    await page.keyboard.press('Escape');
    /* eslint-enable no-await-in-loop */
  }

  const out = path.join(REPO, 'test-results', 'perf');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `baseline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ desk, results, blocked }, null, 2));
  // eslint-disable-next-line no-console -- the ruler's own readout
  console.log('PERF-FILE', file);
  // eslint-disable-next-line no-console
  console.log('PERF-DESK', JSON.stringify(desk));
  for (const r of [...results].sort((a, b) => (b.settledMs ?? 0) - (a.settledMs ?? 0))) {
    // eslint-disable-next-line no-console
    console.log('PERF', JSON.stringify(r.error ? r : {
      label: r.label, open: r.openMs, settled: r.settledMs, task: r.main.TaskDuration, script: r.main.ScriptDuration,
      layouts: r.main.LayoutCount, lt: r.longTasks, api: r.api.count, slow: r.api.slowest[0],
      idleTask: r.idle.TaskDuration, idleReq: r.idle.requests, idleFrames: r.idle.frames,
    }));
  }
  if (blocked.length) console.log('PERF-BLOCKED', JSON.stringify(blocked)); // eslint-disable-line no-console
});
