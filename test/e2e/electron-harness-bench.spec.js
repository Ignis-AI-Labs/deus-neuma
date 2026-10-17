// @ts-check
//
// Impure test module: every function here drives the real Electron app —
// process launch, IPC, DOM, filesystem, the real model server, this machine's
// benchmarks repository. Rule 1 marker, file-level.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  LLAMA, getJson, bootHarnessDesk, enterHarnessDesk, askHarness, liveRunCell,
} from './helpers/harness-desk.js';

/**
 * BENCHMARKS FROM THE HARNESS CHAT, in the real desktop app, with the real
 * model (Design note, 2026-10-15: […]).
 *
 * Founder's own road: a harness on the model server, a plain-words ask.
 *   1. […] → the model calls
 *      bench/bench_list, and its answer names cells that exist in the benchmarks
 *      REPOSITORY (/workspace/repos/project-fuvofos) — never a file read of any
 *      folder named benchmarks.
 *   2. […] → bench/bench_status,
 *      and the answer matches the machine (a live run is named by its cell).
 *
 * A LAUNCH is proven by scripts/bench-watch-proof.mjs, not here: the bench
 * plane refuses to start a benchmark while any test runner is alive (a run
 * must never measure under a test run), so a test cannot launch one. Real model
 * server on :8089 (read and answered only — never restarted). Everything else
 * is temp. Requires a built frontend (build in a worktree when a desk runs from dist/):
 *   xvfb-run -a npx playwright test test/e2e/electron-harness-bench.spec.js
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(__dirname, 'shots-harness-bench');
const BENCH_REPO = process.env.NEUMA_BENCH_HARNESS_PATH || '/workspace/repos/project-fuvofos';

const log = (m) => console.log(`[harness-bench] ${m}`);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

// every cell id the benchmarks repository holds (cells/<tier>/<id>/)
const repoCells = () => fs.readdirSync(path.join(BENCH_REPO, 'cells'))
  .filter((tier) => /^t\d$/.test(tier))
  .flatMap((tier) => fs.readdirSync(path.join(BENCH_REPO, 'cells', tier)));

test.describe('benchmarks from the harness chat — listed and checked by the model itself', () => {
  test.describe.configure({ mode: 'serial' });

  let desk;
  const ask = async (text) => {
    const answer = await askHarness(desk, text);
    log(`asked "${text}" → tools [${answer.tools.join(', ')}]; said: ${answer.reply.slice(0, 300).replace(/\n/g, ' ')}`);
    return answer;
  };

  test.beforeAll(async () => {
    test.skip(!(await getJson(`${LLAMA}/v1/models`))?.data?.length, 'a model server on :8089 must answer');
    test.skip(!fs.existsSync(path.join(BENCH_REPO, 'bench.mjs')), 'no benchmarks repository is connected');
    desk = await bootHarnessDesk({ shots: SHOTS, dnaKey: 'harness-bench-e2e-key-long-enough-for-the-law' });
    log(`lane ${desk.laneId} on llama.cpp ${LLAMA} (${desk.served}); benchmarks repository ${BENCH_REPO}`);
  });

  test.afterAll(async () => { await desk?.close(); });

  test('the harness desk opens', async () => {
    await enterHarnessDesk(desk);
    await expect(desk.page.getByRole('button', { name: 'Server' })).toContainText('llama.cpp', { timeout: 30 * 1000 });
    await shot(desk.page, '01-harness-desk');
  });

  test('"Pull up the list of benchmarks you can run" — the model lists the benchmarks REPOSITORY', async () => {
    const { reply, tools } = await ask('Pull up the list of benchmarks you can run.');
    expect(tools).toEqual(expect.arrayContaining([expect.stringMatching(/bench_list$/)]));
    // never a hunt through folders for benchmarks
    expect(tools.filter((t) => /^(fs|filesystem)\//.test(t))).toEqual([]);
    const named = repoCells().filter((id) => reply.includes(id));
    log(`cells named from the repository: ${named.length} (${named.slice(0, 8).join(', ')})`);
    expect(named.length).toBeGreaterThanOrEqual(3);
    await shot(desk.page, '02-listed');
  });

  test('"Is a benchmark running right now?" — the model reads the machine', async () => {
    const live = liveRunCell();
    const { reply, tools } = await ask('Is a benchmark running on this machine right now?');
    expect(tools).toEqual(expect.arrayContaining([expect.stringMatching(/bench_status$/)]));
    log(`live run on the machine: ${live || 'none'}`);
    if (live) expect(reply.toLowerCase()).toContain(live.toLowerCase());
    await shot(desk.page, '03-status');
  });
});
