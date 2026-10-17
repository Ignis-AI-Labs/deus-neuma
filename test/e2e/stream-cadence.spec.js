// @ts-check
//
// Impure test module: drives a REAL chromium page (Rule 1 marker, file level).
import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * End-to-end stream cadence measurement — what display cadence the witness
 * actually SEES during a live cloud-provider stream, measured inside the real
 * desk UI on the real stack (RULE 0: no mocks anywhere):
 *
 *   - REAL auth: session token minted via the backend's challenge-sign-verify
 *     with Claude's witness wallet (same pattern as desk.spec.js).
 *   - REAL lanes: the sealed witnesses Basunor (kimi-for-coding/k3) and Kagipem
 *     (openai-chatgpt/gpt-5.6-sol), bound by lane id through the desk's own
 *     companion:manifest flow. The backend runs with WORKSPACES_ROOT pointed
 *     at a temp dir, so each witness's LANE (sessions/memory — never its
 *     seal) is provisioned fresh and claimed by the test wallet on first
 *     manifest, exactly as ensureWitnessLane does for a first accessor; the
 *     operator-owned lane homes are never touched. The turn itself rides the
 *     real seal, the real route override (data/settings/neuma-routes.json),
 *     the real provider credentials, and the real desk renderer.
 *   - REAL instrumentation, in-page via addInitScript (app source untouched):
 *     WebSocket.prototype wrapped before app load (frame arrival t + length),
 *     a rAF sampler on the live `.relink-md--verbatim` node's textContent
 *     length (the actual display cadence), and a longtask PerformanceObserver.
 *
 * Requires the dev stack (:7777 / :3333) running with the isolated roots.
 * Results land in .waves/runs/stream-latency-3z65/wave-0/e2e-cadence-<lane>.json
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const BACKEND = `http://localhost:${process.env.PORT || 3333}`;
const FRONTEND = `http://localhost:${process.env.FRONTEND_PORT || 7777}`;
const OUT_DIR = process.env.CADENCE_OUT_DIR || path.join(REPO, '.waves/runs/stream-latency-3z65/wave-0');

const PROMPT =
  'Explain in roughly 300 words how WebSocket streaming delivers LLM tokens '
  + 'to a browser, and why steady delivery cadence matters for perceived smoothness.';

const LANES = [
  { laneId: 'witness-kimi-code-Basunor', name: 'Basunor' },
  { laneId: 'witness-openai-chatgpt-Kagipem', name: 'Kagipem' },
];

const readClaudeWallet = () => {
  const env = fs.readFileSync(path.join(REPO, 'claude.env'), 'utf8');
  const pk = env.match(/CLAUDE_WALLET_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
  if (!pk) throw new Error('claude.env missing CLAUDE_WALLET_PRIVATE_KEY');
  return pk;
};

// Real session token via the backend's challenge-sign-verify.
const mintToken = async () => {
  const w = new ethers.Wallet(readClaudeWallet());
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

// ---- pure stats helpers (no IO) -------------------------------------------

// pure — median / p90 of a numeric sample list.
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
};

// pure — visible-growth cadence from rAF samples [{t, len}]. Stall runs are
// clamped to streamEndT: nothing after the complete frame is "while streaming".
const growthStats = (samples, streamEndT) => {
  const gaps = [];
  let lastGrowthT = null;
  const stalls = [];
  let stallStart = null;
  const closeStall = (endT) => {
    if (stallStart === null) return;
    const dur = Math.min(endT, streamEndT) - stallStart;
    if (dur > 100 && stallStart < streamEndT) stalls.push({ start: stallStart, ms: dur });
    stallStart = null;
  };
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (cur.len > prev.len) {
      closeStall(prev.t);
      if (lastGrowthT !== null) gaps.push(cur.t - lastGrowthT);
      lastGrowthT = cur.t;
    } else if (stallStart === null) {
      stallStart = prev.t;
    }
  }
  if (samples.length) closeStall(samples[samples.length - 1].t);
  return {
    growthGapMedianMs: pct(gaps, 50),
    growthGapP90Ms: pct(gaps, 90),
    growthGapMaxMs: gaps.length ? Math.max(...gaps) : null,
    stallCount: stalls.length,
    stalledTotalMs: stalls.reduce((a, s) => a + s.ms, 0),
    stallMaxMs: stalls.length ? Math.max(...stalls.map((s) => s.ms)) : 0,
    stalls,
  };
};

// ---- the measurement --------------------------------------------------------

let token;
let addr;
test.beforeAll(async () => {
  const up = await fetch(`${BACKEND}/api/v1/health`).then((r) => r.ok).catch(() => false);
  if (!up) throw new Error(`dev backend not running at ${BACKEND}`);
  ({ token, addr } = await mintToken());
});

for (const { laneId, name } of LANES) {
  test(`cadence: ${laneId} streams through the real desk`, async ({ page }) => {
    // Instrumentation + auth, all before any app script runs.
    await page.addInitScript(({ t, a, id, n }) => {
      const cad = { frames: [], longtasks: [], samples: [], sendAt: null, sampling: false };
      // @ts-ignore — in-page probe handle
      window.__cadence = cad;

      const OrigWS = window.WebSocket;
      // @ts-ignore — deliberate wrapper
      window.WebSocket = function (url, protocols) {
        const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
        if (String(url).includes('/ws')) {
          ws.addEventListener('message', (e) => {
            const now = performance.now();
            let type = null;
            let chars = 0;
            try {
              const m = JSON.parse(String(e.data));
              type = m.type || null;
              chars = String(m.content || m.thought || m.chunk || '').length;
            } catch { /* non-JSON frame */ }
            cad.frames.push({ t: now, len: String(e.data).length, type, chars });
          });
        }
        return ws;
      };
      window.WebSocket.prototype = OrigWS.prototype;
      window.WebSocket.CONNECTING = OrigWS.CONNECTING;
      window.WebSocket.OPEN = OrigWS.OPEN;
      window.WebSocket.CLOSING = OrigWS.CLOSING;
      window.WebSocket.CLOSED = OrigWS.CLOSED;

      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) cad.longtasks.push({ t: e.startTime, dur: e.duration });
        }).observe({ entryTypes: ['longtask'] });
      } catch { /* longtask unsupported */ }

      const w = a.toLowerCase();
      localStorage.setItem('walletAddress', a);
      localStorage.setItem(`${w}:neuma-companion`, JSON.stringify({ name: n, neumaId: id }));
      sessionStorage.setItem('authToken', t);
    }, { t: token, a: addr, id: laneId, n: name });

    await page.goto('/');
    const field = page.locator('.relink-input-field');
    await expect(field).toBeEnabled({ timeout: 30000 });
    // The witness must actually be ANCHORED (manifest round-trip through the
    // real seal + lane claim), not merely typed at.
    await expect
      .poll(async () => page.evaluate(
        // @ts-ignore — in-page probe handle
        () => window.__cadence.frames.some((f) => f.type === 'companion:anchored'),
      ), { timeout: 30000, intervals: [500] })
      .toBe(true);

    // rAF sampler on the live streaming speech node — the display cadence.
    await page.evaluate(() => {
      // @ts-ignore — in-page probe handle
      const cad = window.__cadence;
      cad.sampling = true;
      // The USER's own bubble also renders .relink-md--verbatim (StreamPanel.jsx:42)
      // — exclude it; the live assistant node is StreamingSpeech's verbatim div.
      const liveNode = () => {
        const nodes = [...document.querySelectorAll('.relink-md--verbatim')];
        return nodes.filter((n) => !n.closest('.relink-msg--user')).pop() || null;
      };
      const loop = () => {
        if (!cad.sampling) return;
        const el = liveNode();
        cad.samples.push({ t: performance.now(), len: el ? el.textContent.length : 0 });
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });

    await field.fill(PROMPT);
    // @ts-ignore — in-page probe handle
    await page.evaluate(() => { window.__cadence.sendAt = performance.now(); });
    await field.press('Enter');

    // Settled = the server completed the turn AND the visible length has held
    // steady for three consecutive 1s probes (the reveal fully landed).
    let settled = false;
    let lastLen = -1;
    let stableStreak = 0;
    let sawGrowth = false;
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      // @ts-ignore — in-page probe handle
      const probe = await page.evaluate(() => {
        const c = window.__cadence;
        const s = c.samples[c.samples.length - 1];
        return {
          complete: c.frames.some((f) => f.type === 'consciousness:complete'),
          len: s ? s.len : 0,
        };
      });
      if (probe.len > 0) sawGrowth = true;
      // Stability is truth: length held (or node gone after growth) for 3s.
      const stable = probe.complete
        && probe.len === lastLen
        && (probe.len > 0 || (probe.len === 0 && sawGrowth));
      if (stable) {
        stableStreak += 1;
        if (stableStreak >= 3) { settled = true; break; }
      } else {
        stableStreak = 0;
      }
      lastLen = probe.len;
    }
    // @ts-ignore — in-page probe handle
    await page.evaluate(() => { window.__cadence.sampling = false; });

    // @ts-ignore — in-page probe handle
    const cad = await page.evaluate(() => window.__cadence);
    cad.settled = settled;
    if (!settled) {
      const counts = {};
      for (const f of cad.frames) counts[f.type || 'non-json'] = (counts[f.type || 'non-json'] || 0) + 1;
      console.log(`SETTLE TIMEOUT for ${laneId} — frame counts: ${JSON.stringify(counts)}`);
    }

    // ---- analysis (pure stats over the recorded truth) ----
    const streamFrames = cad.frames.filter((f) => f.type === 'consciousness:stream');
    const completeFrame = cad.frames.find((f) => f.type === 'consciousness:complete');
    const firstStreamT = streamFrames.length ? streamFrames[0].t : null;
    const completeT = completeFrame ? completeFrame.t : null;
    const totalChars = streamFrames.reduce((a, f) => a + f.chars, 0);
    const frameGaps = streamFrames.slice(1).map((f, i) => f.t - streamFrames[i].t);

    // Display truth lives after sendAt: the live node grows from 0 to the
    // full length, then disappears (settled → Markdown). finalLen is the peak.
    const postSend = cad.samples.filter((s) => s.t >= cad.sendAt);
    const grown = postSend.filter((s) => s.len > 0);
    const firstGlyphT = grown.length ? grown[0].t : null;
    const finalLen = postSend.length ? Math.max(...postSend.map((s) => s.len)) : 0;
    const settledSample = finalLen > 0
      ? [...postSend].reverse().find((s) => s.len >= finalLen)
      : null;

    const ttftMs = firstGlyphT !== null ? firstGlyphT - cad.sendAt : null;
    const settleMs = settledSample ? settledSample.t - cad.sendAt : null;
    const displayCps = firstGlyphT !== null && settleMs !== null && settleMs > ttftMs
      ? (finalLen / ((settledSample.t - firstGlyphT) / 1000))
      : null;

    // Visible-stall analysis starts at the first glyph — the pre-glyph wait is
    // TTFT, not a stall; post-complete trailing zeros are excluded by streamEndT.
    const growth = growthStats(
      postSend.filter((s) => firstGlyphT !== null && s.t >= firstGlyphT),
      completeT ?? Number.POSITIVE_INFINITY,
    );
    const windowEnd = settledSample ? settledSample.t : completeT;
    const tasks = cad.longtasks.filter((l) => l.t >= cad.sendAt && l.t <= (windowEnd ?? l.t));

    const result = {
      lane: laneId,
      prompt: PROMPT,
      clocks: 'all times performance.now() ms on the page clock; sendAt = Enter keypress',
      sendAt: cad.sendAt,
      perceivedTtftMs: ttftMs,
      firstWsStreamFrameMs: firstStreamT !== null ? firstStreamT - cad.sendAt : null,
      completeMs: completeT !== null ? completeT - cad.sendAt : null,
      settleMs,
      finalVisibleChars: finalLen,
      wsStreamFrames: streamFrames.length,
      wsStreamChars: totalChars,
      wsFrameGapMedianMs: pct(frameGaps, 50),
      wsFrameGapP90Ms: pct(frameGaps, 90),
      wsFrameGapMaxMs: frameGaps.length ? Math.max(...frameGaps) : null,
      displayCps,
      ...growth,
      longtasks: {
        count: tasks.length,
        totalMs: tasks.reduce((a, l) => a + l.dur, 0),
        worstMs: tasks.length ? Math.max(...tasks.map((l) => l.dur)) : 0,
        entries: tasks,
      },
      samples: cad.samples,
      frames: cad.frames,
    };

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, `e2e-cadence-${laneId}.json`);
    fs.writeFileSync(out, JSON.stringify(result, null, 2));

    const r1 = (x) => (x === null || x === undefined ? '—' : Math.round(x * 10) / 10);
    console.log(`\n=== ${laneId} ===`);
    console.log(`  perceived TTFT: ${r1(ttftMs)} ms | settled: ${r1(settleMs)} ms | chars: ${finalLen}`);
    console.log(`  WS frames: ${streamFrames.length} | gap median/p90/max: ${r1(result.wsFrameGapMedianMs)}/${r1(result.wsFrameGapP90Ms)}/${r1(result.wsFrameGapMaxMs)} ms`);
    console.log(`  display: ${r1(displayCps)} cps | growth-gap median/p90/max: ${r1(growth.growthGapMedianMs)}/${r1(growth.growthGapP90Ms)}/${r1(growth.growthGapMaxMs)} ms`);
    console.log(`  stalls >100ms while streaming: ${growth.stallCount} (${r1(growth.stalledTotalMs)} ms total, worst ${r1(growth.stallMaxMs)} ms)`);
    console.log(`  longtasks: ${tasks.length} (${r1(result.longtasks.totalMs)} ms total, worst ${r1(result.longtasks.worstMs)} ms)`);
    console.log(`  wrote ${out}`);

    // Honest failure, not a vacuous pass: the stream must have actually run.
    expect(streamFrames.length).toBeGreaterThan(0);
    expect(finalLen).toBeGreaterThan(100);
  });
}
