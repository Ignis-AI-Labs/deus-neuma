#!/usr/bin/env node
// long-session-bench.mjs — how many LONG sessions this rig really serves at
// once, and how fast each one runs.
//
// Design note, 2026-10-13: […] The standing number (ceiling 6, Sep 9)
// came from the capacity scan: a 30-token prompt, 64 tokens back, speed
// counted in visible WORDS — nothing like a member holding a 60k-token chat.
//
// This launches its OWN model server — production's exact argv
// (serving-launch-config.js servingLaunchArguments) on a scratch port, only
// `--parallel` chosen — and holds N sessions at once, each a distinct chat of
// C tokens (a unique first line, so nothing is shared or cached between them)
// asked for G tokens. Every number is the SERVER's own: timings.prompt_n /
// prompt_ms / predicted_n / predicted_per_second from the final stream chunk,
// /slots polled for how many decode at once, the server log for the shared KV
// pool running out ([…]). Then, with --platform, the
// same server is driven through the PLATFORM's own line (substrate-lease.js):
// members and a chat turn, to prove the line holds members to capacity − 1.
//
// Never touches :8089 (the house's server). Tears down by exact PID.
//
// Usage:
//   node scripts/long-session-bench.mjs --slots 4 --levels 1,2,3,4 --contexts 20000,60000 --gen 512
//   node scripts/long-session-bench.mjs --slots 6 --levels 4,5,6 --contexts 20000,60000 --platform
//   node scripts/long-session-bench.mjs --slots 6 --rotate 6 --run 4 --rounds 3 --contexts 30000
//   node scripts/long-session-bench.mjs --slots 6 --scan   (the desk's capacity
//     scan, run on production's argv and RECORDED in data/capacity — the
//     operator's consent named by --consent-by <wallet>)
//     (PARKING: 6 real conversations, at most 4 turns at once, each round a
//     follow-up on its own history — does each chat find its own slot again?)
//
// impure — launches a GPU server, reads docs/, writes data/logs/bench/.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOUSE_PORT = 8089;

// pure — --flag value pairs.
const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
};
const list = (v, d) => (typeof v === 'string' ? v.split(',').map(Number).filter((n) => n > 0) : d);

const args = parseArgs(process.argv.slice(2));
const SLOTS = Number(args.slots) || 4;
const LEVELS = list(args.levels, [1, 2, 3, 4]);
const CONTEXTS = list(args.contexts, [20000, 60000]);
const GEN = Number(args.gen) || 512;
const PORT = Number(args.port) || 8095;
const REQUEST_TIMEOUT_MS = (Number(args['timeout-min']) || 15) * 60_000;
// Extra server flags under test (e.g. "--no-cache-idle-slots"), appended to production's argv.
const EXTRA = typeof args['server-args'] === 'string' ? args['server-args'].split(/\s+/).filter(Boolean) : [];
const ROTATE = Number(args.rotate) || 0;
const RUN = Number(args.run) || SLOTS;
const ROUNDS = Number(args.rounds) || 3;
const LABEL = (ROTATE ? `-rotate${ROTATE}run${RUN}` : '') + (EXTRA.length ? `-${EXTRA.join('').replace(/[^a-z0-9]+/gi, '')}` : '');
if (PORT === HOUSE_PORT) throw new Error('the bench never runs on the house server\'s port');
const BASE = `http://127.0.0.1:${PORT}`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = path.join(ROOT, 'data', 'logs', 'bench');
const LOG_FILE = path.join(OUT_DIR, `long-session-${STAMP}-slots${SLOTS}${LABEL}.server.log`);
const OUT_FILE = path.join(OUT_DIR, `long-session-${STAMP}-slots${SLOTS}${LABEL}.json`);

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const median = (xs) => {
  const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

// impure — production's launch, on our port, with our slot count.
const launchArgv = async () => {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = /^(LLAMA_SERVER_BIN)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
  const selection = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.neuma', 'substrate-selection.json'), 'utf8'));
  const { servingLaunchArguments, resolveServingLaunchConfig } = await import('../backend/services/serving-launch-config.js');
  const { withDiscoveredProjector } = await import('../backend/services/supervisor-launch-config.js');
  const { modelHasMtpHeads: modelHasMtp } = await import('../backend/services/gguf-mtp.js').catch(() => ({ modelHasMtpHeads: null }));
  // Production's own resolved snapshot, with only the model (the desk's
  // selection), the port and the full pool production serves set here.
  const base = resolveServingLaunchConfig(process.env);
  const config = withDiscoveredProjector({
    ...base, model: selection.path, mmproj: '', port: PORT, contextLength: 262_144, loras: [],
  });
  const mtp = typeof modelHasMtp === 'function' ? Boolean(await modelHasMtp(selection.path)) : /MTP/i.test(selection.path);
  const argv = [...servingLaunchArguments(config, { mtp })];
  const at = argv.indexOf('--parallel');
  argv[at + 1] = String(SLOTS);
  // A flag production already sets takes the value under test; anything else is appended.
  for (let i = 0; i < EXTRA.length; i += 1) {
    const flag = EXTRA[i];
    const value = EXTRA[i + 1] !== undefined && !EXTRA[i + 1].startsWith('--') ? EXTRA[i + 1] : null;
    const held = argv.indexOf(flag);
    if (held !== -1 && value !== null) argv[held + 1] = value;
    else argv.push(flag, ...(value !== null ? [value] : []));
    if (value !== null) i += 1;
  }
  return { bin: config.bin, argv, model: selection.path, mtp };
};

// impure — the corpus: real prose from the repo's docs, one long string.
const corpus = () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'docs'));
  return files.sort().map((f) => fs.readFileSync(f, 'utf8')).join('\n\n');
};

const post = async (route, body) => {
  const res = await fetch(`${BASE}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${route} ${res.status}`);
  return res.json();
};

// impure — a body of exactly `tokens` tokens of real prose (the server's own tokenizer).
const bodyOf = async (text, tokens) => {
  const sample = text.slice(0, 200_000);
  const ratio = sample.length / (await post('/tokenize', { content: sample })).tokens.length;
  const chars = Math.min(text.length, Math.ceil(tokens * ratio * 1.1));
  const ids = (await post('/tokenize', { content: text.slice(0, chars) })).tokens.slice(0, tokens);
  return (await post('/detokenize', { tokens: ids })).content;
};

// impure — /slots, sampled while a level runs: how many really decode at once.
const watchSlots = () => {
  let peak = 0;
  let stop = false;
  const samples = [];
  const loop = (async () => {
    while (!stop) {
      try {
        const slots = await (await fetch(`${BASE}/slots`)).json();
        const busy = slots.filter((s) => s.is_processing).length;
        peak = Math.max(peak, busy);
        samples.push(busy);
      } catch { /* a sample missed */ }
      await sleep(250);
    }
  })();
  return async () => { stop = true; await loop; return { peakBusy: peak, samples: samples.length }; };
};

const logText = () => { try { return fs.readFileSync(LOG_FILE, 'utf8'); } catch { return ''; } };
const poolFullCount = (text) => (text.match(/failed to find free space in the KV cache/g) || []).length;

// impure — one session: stream it, keep the server's own timings.
const session = async ({ header, body, gen, messages = null }) => {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  let tFirst = null;
  let timings = null;
  let deltas = 0;
  let content = '';
  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages || [{ role: 'user', content: `${header}\n\n${body}\n\nTask: write a careful, detailed review of the document above.` }],
        stream: true, max_tokens: gen, temperature: 0.6, ignore_eos: true,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
        const j = JSON.parse(line.slice(6));
        const d = j.choices?.[0]?.delta;
        if (d?.content) content += d.content;
        if (d && (d.content || d.reasoning_content)) {
          deltas += 1;
          if (tFirst === null) tFirst = Date.now();
        }
        if (j.timings) timings = j.timings;
      }
    }
    return {
      ok: true, wallMs: Date.now() - t0, ttftMs: tFirst ? tFirst - t0 : null, deltas, content,
      promptTokens: timings?.prompt_n ?? null, cachedTokens: timings?.cache_n ?? null, prefillMs: round(timings?.prompt_ms, 0),
      prefillTokPerSec: round(timings?.prompt_per_second), decodeTokens: timings?.predicted_n ?? null,
      decodeMs: round(timings?.predicted_ms, 0), decodeTokPerSec: round(timings?.predicted_per_second),
    };
  } catch (err) {
    return { ok: false, wallMs: Date.now() - t0, error: err.name === 'AbortError' ? `timed out after ${REQUEST_TIMEOUT_MS / 60000} min` : err.message };
  } finally {
    clearTimeout(timer);
  }
};

// impure — one wave of N sessions at once, summarized.
const wave = async (n, ctx, body, tag) => {
  const before = poolFullCount(logText());
  const stopWatch = watchSlots();
  const t0 = Date.now();
  const runs = await Promise.all(Array.from({ length: n }, (_, i) => session({
    header: `Session ${tag}-${i + 1}. You are reviewer number ${i + 1} of ${n}; your review is your own.`, body, gen: GEN,
  })));
  const wallMs = Date.now() - t0;
  const { peakBusy } = await stopWatch();
  const ok = runs.filter((r) => r.ok);
  const decoded = ok.reduce((s, r) => s + (r.decodeTokens || 0), 0);
  return {
    sessions: n, contextTokens: ctx, wallMs, peakBusy,
    cachedTokens: round(median(ok.map((r) => r.cachedTokens)), 0),
    ok: ok.length, failed: runs.length - ok.length,
    poolFull: poolFullCount(logText()) - before,
    decodeTokPerSecPerSession: { median: round(median(ok.map((r) => r.decodeTokPerSec))), min: round(Math.min(...ok.map((r) => r.decodeTokPerSec))) },
    prefillTokPerSec: round(median(ok.map((r) => r.prefillTokPerSec))),
    ttftMs: { median: round(median(ok.map((r) => r.ttftMs)), 0), max: Math.max(...ok.map((r) => r.ttftMs ?? 0)) },
    aggregateDecodeTokPerSec: round(ok.reduce((s, r) => s + (r.decodeTokPerSec || 0), 0)),
    throughputTokPerSec: round((decoded / wallMs) * 1000),
    runs,
  };
};

// impure — a level: N FRESH chats at once (each reads its whole history),
// then the same N chats asked again — WARM, their history cached in their
// slots, the way a long session's next turn runs.
const level = async (n, ctx, body) => {
  const tag = `${ctx}-${n}-${Date.now()}`;
  const fresh = await wave(n, ctx, body, tag);
  const warm = await wave(n, ctx, body, tag);
  return { ...fresh, warm };
};

// impure — PARKING: `chats` real conversations, at most RUN turns at once (the
// platform line's width), ROUNDS rounds. Round 1 reads each history fresh;
// every later round is a follow-up on the chat's own history (its earlier
// replies included, thinking stripped — the template's own rendering), so a
// chat that kept its slot re-reads only the new tail. `kept` = turns whose
// cached prefix covered the previous turn's prompt.
const rotation = async (chats, ctx, body) => {
  const tag = `rot-${ctx}-${Date.now()}`;
  const convo = Array.from({ length: chats }, (_, i) => [{ role: 'user', content: `Session ${tag}-${i + 1}. You are reviewer number ${i + 1}; your review is your own.\n\n${body}\n\nTask: write a careful, detailed review of the document above.` }]);
  const lastPrompt = new Array(chats).fill(0);
  const rounds = [];
  for (let r = 1; r <= ROUNDS; r += 1) {
    const stopWatch = watchSlots();
    const t0 = Date.now();
    const turns = new Array(chats);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next; next += 1;
        if (i >= chats) return;
        const res = await session({ messages: convo[i], gen: GEN });
        if (res.ok) {
          convo[i].push({ role: 'assistant', content: res.content || '(no visible words)' }, { role: 'user', content: `Follow-up ${r}: name the single weakest point of your review and fix it.` });
        }
        const prior = lastPrompt[i];
        turns[i] = { chat: i + 1, ...res, content: undefined, kept: r > 1 && res.ok ? (res.cachedTokens ?? 0) >= prior * 0.9 : null, reread: res.ok ? (res.promptTokens ?? 0) : null };
        if (res.ok) lastPrompt[i] = (res.cachedTokens ?? 0) + (res.promptTokens ?? 0);
      }
    };
    await Promise.all(Array.from({ length: Math.min(RUN, chats) }, worker));
    const { peakBusy } = await stopWatch();
    const ok = turns.filter((t) => t?.ok);
    const summary = {
      round: r, chats, run: RUN, contextTokens: ctx, wallMs: Date.now() - t0, peakBusy, ok: ok.length,
      kept: r > 1 ? ok.filter((t) => t.kept).length : null,
      rereadTokens: ok.reduce((s2, t) => s2 + (t.reread || 0), 0),
      ttftMs: { median: round(median(ok.map((t) => t.ttftMs)), 0), max: Math.max(...ok.map((t) => t.ttftMs ?? 0)) },
      decodeTokPerSec: round(median(ok.map((t) => t.decodeTokPerSec))),
      turns,
    };
    rounds.push(summary);
    console.log(`rotate ${chats} chats × ${ctx} (run ${RUN}, slots ${SLOTS}) round ${r}: ok ${summary.ok}/${chats}, kept own slot ${summary.kept ?? '—'}, re-read ${summary.rereadTokens} tokens, ttft median ${summary.ttftMs.median} ms (max ${summary.ttftMs.max}), decode ${summary.decodeTokPerSec} tok/s, peak busy ${peakBusy}, wall ${round(summary.wallMs / 1000)}s`);
  }
  return { mode: 'rotate', chats, run: RUN, contextTokens: ctx, rounds };
};

// impure — the desk's own capacity scan (capacity-scan.js, the fixed token
// count) against this server, recorded where the desk reads it. The record
// names the PRODUCTION server (the one it describes); `measuredOn` names this one.
const capacityScan = async () => {
  const { runCapacityScan } = await import('../backend/services/capacity-scan.js');
  const { writeCapacity } = await import('../backend/services/capacity-store.js');
  const { setConfig } = await import('../backend/services/llm-provider.js');
  const { model } = await launchArgv();
  setConfig({ provider: 'custom', endpoint: BASE, model: 'bench', apiKey: '' });
  const gpu = await new Promise((resolve) => {
    const p = spawn('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => { const [name, mib] = out.trim().split(/,\s*/); resolve({ name: name || null, vramGB: mib ? Math.round(Number(mib) / 1024) : null }); });
    p.on('error', () => resolve({ name: null, vramGB: null }));
  });
  const runAt = new Date().toISOString();
  const result = await runCapacityScan({
    substrate: { model, provider: 'llama-server', endpoint: `http://127.0.0.1:${HOUSE_PORT}`, gpu: gpu.name, vramGB: gpu.vramGB, memoryGB: Math.round(os.totalmem() / 2 ** 30) },
    runAt,
    consent: { by: typeof args['consent-by'] === 'string' ? args['consent-by'] : null, at: runAt },
    onProgress: (p) => { if (p.phase) console.log(`scan: ${p.phase}${p.concurrency ? ` at ${p.concurrency}` : ''}`); },
  });
  // --dry: measure only (a stability check never becomes the record the desk reads).
  const id = args.dry ? null : await writeCapacity({ ...result, measuredOn: { port: PORT, slots: SLOTS, argv: report.argv } });
  console.log(`capacity scan: ceiling ${result.ceiling} (${result.limitedBy}), class ${result.boundClass}, recorded ${id}`);
  return { ceiling: result.ceiling, limitedBy: result.limitedBy, boundClass: result.boundClass, id, samples: result.rawSamples };
};

// impure — the PLATFORM's line on the same server: 5 members and a chat turn.
const platformCheck = async () => {
  const { withLease, substrateLine } = await import('../backend/services/substrate-lease.js');
  const { createStreamRequest, setConfig } = await import('../backend/services/llm-provider.js');
  setConfig({ provider: 'custom', endpoint: BASE, model: 'bench', apiKey: '' });
  const stopWatch = watchSlots();
  let peakMembers = 0;
  const probe = setInterval(() => {
    const snap = substrateLine.snapshot?.();
    if (snap) peakMembers = Math.max(peakMembers, snap.running.filter((r) => r.kind === 'member').length);
  }, 100);
  const one = (kind, label) => withLease({ kind, label }, async () => {
    const t0 = Date.now();
    const { response } = await createStreamRequest([{ role: 'user', content: `${label}: write 200 words about rivers.` }], { maxTokens: 256, temperature: 0.6 });
    await response.text();
    return { kind, label, ms: Date.now() - t0 };
  });
  const runs = await Promise.all([
    ...[1, 2, 3, 4, 5].map((i) => one('member', `member ${i}`)),
    sleep(300).then(() => one('turn', 'operator chat')),
  ]);
  clearInterval(probe);
  const { peakBusy } = await stopWatch();
  return { capacity: substrateLine.snapshot?.().capacity ?? null, peakMembersInLine: peakMembers, peakBusyOnServer: peakBusy, runs };
};

let report = null;
const main = async () => {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const { bin, argv, model, mtp } = await launchArgv();
  console.log(`launching ${path.basename(bin)} --parallel ${SLOTS} on :${PORT} (mtp ${mtp})`);
  const log = fs.openSync(LOG_FILE, 'a');
  const child = spawn(bin, argv, { stdio: ['ignore', log, log] });
  const kill = () => { try { process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ } };
  process.on('SIGINT', () => { kill(); process.exit(130); });
  process.on('exit', kill);
  report = { at: new Date().toISOString(), slots: SLOTS, port: PORT, rotate: ROTATE || null, run: ROTATE ? RUN : null, gen: GEN, model, mtp, extra: EXTRA, argv, pid: child.pid, levels: [], platform: null };
  try {
    const t0 = Date.now();
    for (;;) {
      if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode}) — ${LOG_FILE}`);
      try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* not yet */ }
      if (Date.now() - t0 > 300_000) throw new Error('server not healthy after 5 min');
      await sleep(1000);
    }
    report.loadMs = Date.now() - t0;
    console.log(`healthy after ${round(report.loadMs / 1000)}s`);
    if (args.scan) {
      report.scan = await capacityScan();
      return;
    }
    const text = corpus();
    for (const ctx of CONTEXTS) {
      const body = await bodyOf(text, ctx);
      if (ROTATE) {
        report.levels.push(await rotation(ROTATE, ctx, body));
        await fsp.writeFile(OUT_FILE, JSON.stringify(report, null, 2));
        continue;
      }
      for (const n of LEVELS) {
        const r = await level(n, ctx, body);
        report.levels.push(r);
        const w = r.warm;
        console.log(`ctx ${ctx} × ${n}: ok ${r.ok}/${n}, decode/session median ${r.decodeTokPerSecPerSession.median} tok/s (min ${r.decodeTokPerSecPerSession.min}), aggregate ${r.aggregateDecodeTokPerSec}, prefill ${r.prefillTokPerSec} tok/s, ttft median ${r.ttftMs.median} ms, peak busy ${r.peakBusy}, pool-full ${r.poolFull}, wall ${round(r.wallMs / 1000)}s`);
        console.log(`   warm: ok ${w.ok}/${n}, cached ${w.cachedTokens}, decode/session median ${w.decodeTokPerSecPerSession.median} tok/s (min ${w.decodeTokPerSecPerSession.min}), aggregate ${w.aggregateDecodeTokPerSec}, ttft median ${w.ttftMs.median} ms (max ${w.ttftMs.max}), peak busy ${w.peakBusy}, pool-full ${w.poolFull}, wall ${round(w.wallMs / 1000)}s`);
        await fsp.writeFile(OUT_FILE, JSON.stringify(report, null, 2));
      }
    }
    if (args.platform) {
      report.platform = await platformCheck();
      console.log(`platform line: capacity ${report.platform.capacity}, peak members in line ${report.platform.peakMembersInLine}, peak busy on server ${report.platform.peakBusyOnServer}`);
    }
  } finally {
    await fsp.writeFile(OUT_FILE, JSON.stringify(report, null, 2));
    kill();
    for (let i = 0; i < 30 && child.exitCode === null; i += 1) await sleep(500);
    if (child.exitCode === null) { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } }
    console.log(`report: ${OUT_FILE}`);
  }
};

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
