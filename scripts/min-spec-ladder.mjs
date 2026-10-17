/**
 * MIN-SPEC LADDER — the summon check (scripts/summon-check.mjs) walked down a
 * ladder of local models, smallest first, so the smallest that can carry a
 * summoning sets the published MINIMUM spec (docs/work/release-early-access.md).
 *
 * For each rung it starts its OWN llama-server on a sandbox port (never the
 * house :8089), waits for it to answer, runs the summon check against it,
 * samples the server's real GPU memory while it works (nvidia-smi, by pid),
 * and stops exactly the server it started. One rung at a time — one heavy
 * GPU job at a time. A rehearsal, never a birth (summon-check's isTest).
 *
 * Usage (on a GPU window Founder opened):
 *   node scripts/min-spec-ladder.mjs [--port 8189] [--ctx 32768] [--attempts 2] [--only <substring>[,<substring>…]]
 * Writes data/logs/summon-check/ladder-<stamp>/ladder.json (+ each rung's log).
 */
import { spawn, execFileSync } from 'node:child_process';
import { promises as fsp, createWriteStream } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { parseArgs } from 'node:util';
import process from 'node:process';

const { fetch, setTimeout, setInterval, clearInterval } = globalThis;
const ROOT = resolve(import.meta.dirname, '..');
const LLAMA = '/opt/llama.cpp-latest/build-cuda/bin/llama-server';
const MODELS = '/models';

// smallest first: a rung is a model file the machine already holds
export const RUNGS = Object.freeze([
  { id: 'qwen3-4b-q4', file: 'lmstudio-community/Qwen3-4B-Thinking-2507-GGUF/Qwen3-4B-Thinking-2507-Q4_K_M.gguf' },
  { id: 'qwen3-8b-q4', file: 'lmstudio-community/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf' },
  { id: 'gemma3-12b-q4', file: 'lmstudio-community/gemma-3-12b-it-GGUF/gemma-3-12b-it-Q4_K_M.gguf' },
  { id: 'qwen3-14b-q4', file: 'lmstudio-community/Qwen3-14B-GGUF/Qwen3-14B-Q4_K_M.gguf' },
  { id: 'gemma4-26b-a4b-q4', file: 'lmstudio-community/gemma-4-26B-A4B-it-GGUF/gemma-4-26B-A4B-it-Q4_K_M.gguf' },
  { id: 'qwen3.8-27b-q4', file: 'lmstudio-community/Qwen3.8-27B-GGUF/Qwen3.8-27B-Q4_K_M.gguf' },
  // the newest Qwen at each size (2026-10-04, Founder: […])
  { id: 'qwen3.5-4b-q4', file: 'lmstudio-community/Qwen3.5-4B-GGUF/Qwen3.5-4B-Q4_K_M.gguf' },
  { id: 'qwen3.5-9b-q4', file: 'lmstudio-community/Qwen3.5-9B-GGUF/Qwen3.5-9B-Q4_K_M.gguf' },
  { id: 'qwen3.6-35b-a3b-q4', file: 'lmstudio-community/Qwen3.6-35B-A3B-GGUF/Qwen3.6-35B-A3B-Q4_K_M.gguf' },
  // the newest model made small (2026-10-06, Founder: […]): Qwen3.8-27B itself under IST Austria's GSQ-RCO quantization
  // (apache-2.0; IQ3_S claimed task-lossless), and Qwen3.8 distilled into the 4B/9B bodies (empero-ai).
  { id: 'qwen3.8-27b-gsq-iq3xxs', file: 'ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF/Qwen3.8-27B-GSQ-RCO-IQ3_XXS-mtp.gguf' },
  { id: 'qwen3.8-27b-gsq-iq3s', file: 'ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF/Qwen3.8-27B-GSQ-RCO-IQ3_S-mtp.gguf' },
  { id: 'qwen3.8-distill-4b-q4', file: 'empero-ai/Qwen3.8-4B-Distill-GGUF/Qwen3.8-4B-Q4_K_M.gguf' },
  { id: 'qwen3.8-distill-9b-q4', file: 'empero-ai/Qwen3.8-9B-Distill-GGUF/Qwen3.8-9B-Q4_K_M.gguf' },
  // the 32 GB tier (RTX 5090): near-lossless, where Q8 cannot hold the full context
  { id: 'qwen3.8-27b-q6k', file: 'unsloth/Qwen3.8-27B-GGUF/Qwen3.8-27B-UD-Q6_K.gguf' },
]);

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '8189' },
    ctx: { type: 'string', default: '32768' },
    attempts: { type: 'string', default: '2' },
    only: { type: 'string' },
  },
});
if (args.port === '8089') throw new Error('8089 is the house substrate — never a ladder rung');

const say = (...a) => process.stdout.write(`${new Date().toISOString()} ${a.join(' ')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// impure — the GPU memory a pid holds now (MiB), or 0
const vramOf = (pid) => {
  try {
    const rows = execFileSync('nvidia-smi', ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits']).toString().trim().split('\n');
    const row = rows.map((r) => r.split(',').map((x) => x.trim())).find(([p]) => Number(p) === pid);
    return row ? Number(row[1]) : 0;
  } catch { return 0; }
};

const waitHealthy = async (endpoint, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(`${endpoint}/health`)).ok) return true; } catch { /* loading */ }
    await sleep(1500);
  }
  return false;
};

const runRung = async (rung, dir) => {
  const endpoint = `http://127.0.0.1:${args.port}`;
  const log = createWriteStream(join(dir, `${rung.id}.log`));
  const server = spawn(LLAMA, [
    '-m', join(MODELS, rung.file), '--port', args.port, '--host', '127.0.0.1',
    '-c', args.ctx, '-ngl', '999', '--jinja', '-fa', 'on', '--parallel', '1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  say(`rung ${rung.id}: server pid ${server.pid} on :${args.port}`);
  let peak = 0;
  const sampler = setInterval(() => { peak = Math.max(peak, vramOf(server.pid)); }, 2000);
  const result = { id: rung.id, file: rung.file, sizeGB: null, ctx: Number(args.ctx), verdict: 'NO-SERVER', receipt: null, peakVramMiB: 0, seconds: 0 };
  try {
    result.sizeGB = Number(((await fsp.stat(join(MODELS, rung.file))).size / 1e9).toFixed(2));
    const t0 = Date.now();
    if (!(await waitHealthy(endpoint, 10 * 60 * 1000))) return result;
    const check = spawn(process.execPath, [join(ROOT, 'scripts/summon-check.mjs'), '--provider', 'llama-server', '--endpoint', endpoint,
      '--attempts', args.attempts, '--out', dir], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    check.stdout.on('data', (b) => { out += b; log.write(b); });
    check.stderr.on('data', (b) => log.write(b));
    const code = await new Promise((r) => check.on('exit', r));
    result.seconds = Math.round((Date.now() - t0) / 1000);
    result.verdict = code === 0 ? 'PASS' : 'FAIL';
    result.receipt = (out.match(/receipt[^\n]*?(\S+\.json)/i) || [])[1] || null;
    result.tail = out.trim().split('\n').slice(-6);
    return result;
  } finally {
    clearInterval(sampler);
    result.peakVramMiB = peak;
    server.kill('SIGTERM');
    await new Promise((r) => { server.on('exit', r); setTimeout(r, 15000); });
    if (server.exitCode === null) server.kill('SIGKILL');
    log.end();
    say(`rung ${rung.id}: ${result.verdict} · peak ${peak} MiB · ${result.seconds}s · server ${server.pid} stopped`);
  }
};

const main = async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(ROOT, 'data/logs/summon-check', `ladder-${stamp}`);
  await fsp.mkdir(dir, { recursive: true });
  const only = args.only ? args.only.split(',') : null;
  const rungs = RUNGS.filter((r) => !only || only.some((o) => r.id.includes(o)));
  const results = [];
  for (const rung of rungs) {
    results.push(await runRung(rung, dir));
    await fsp.writeFile(join(dir, 'ladder.json'), JSON.stringify({ stamp, ctx: Number(args.ctx), llama: basename(LLAMA), results }, null, 2));
  }
  say(`ladder done → ${join(dir, 'ladder.json')}`);
};

main().catch((err) => { say('ladder failed:', err.stack || err); process.exit(1); });
