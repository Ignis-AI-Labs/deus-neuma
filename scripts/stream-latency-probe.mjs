#!/usr/bin/env node
// stream-latency-probe.mjs — baseline measurement for third-party streaming.
//
// Streams a fixed prompt through the REAL provider path — the same
// resolveUsableCredential / createStreamRequest / consumeStream modules the
// portal uses — and records a monotonic timestamp at every stage boundary:
//   prelude (credential load + decrypt, route store read, SSRF DNS guard)
//   request start → response headers (provider TTFB)
//   headers → first content chunk, and every chunk thereafter
//   per-chunk backend CPU (output sanitizer + WS-frame JSON serialization)
//
// RULE 0: no mocks anywhere. If a provider has no resolvable key it is SKIPPED
// and reported as unmeasured — never faked.
//
// Usage:
//   node scripts/stream-latency-probe.mjs                      # openai + kimi-for-coding
//   node scripts/stream-latency-probe.mjs openai xai           # explicit providers
//   node scripts/stream-latency-probe.mjs openai-chatgpt:gpt-5.6-sol   # provider:model
//   node scripts/stream-latency-probe.mjs --runs 3 openai      # repeat runs
//   node scripts/stream-latency-probe.mjs --json out.json ...  # machine-readable report

import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

try { process.loadEnvFile('.env'); } catch { /* .env optional — store may hold the keys */ }

const { loadConfig } = await import('../backend/config.js');
const { createStreamRequest, consumeStream } = await import('../backend/services/llm-provider.js');
const { loadCredentials } = await import('../backend/services/provider-credentials.js');
const { resolveUsableCredential } = await import('../backend/services/oauth-token-broker.js');
const { getProvider, probeRefusalReason } = await import('../backend/services/provider-registry.js');
const { assertSafeEndpoint } = await import('../backend/services/endpoint-guard.js');
const { sanitizeModelOutput } = await import('../core/runtime/output-sanitizer.js');

loadConfig();

const PROMPT = 'Explain in roughly 300 words how WebSocket streaming delivers LLM tokens to a browser, and why steady delivery cadence matters for perceived smoothness.';

// --- pure statistics ---

const percentile = (sorted, p) => {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
};

/** Inter-arrival gap statistics in ms. Pure. */
const gapStats = (times) => {
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const burst = gaps.filter((g) => g < 16).length; // arrived inside the same display frame as the previous chunk
  return Object.freeze({
    n: gaps.length,
    p50: percentile(gaps, 50),
    p90: percentile(gaps, 90),
    p99: percentile(gaps, 99),
    max: gaps.length ? gaps[gaps.length - 1] : null,
    sameFramePct: gaps.length ? Math.round((burst / gaps.length) * 100) : null,
  });
};

const round = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
const roundStats = (s) => Object.freeze({
  n: s.n, p50: round(s.p50), p90: round(s.p90), p99: round(s.p99), max: round(s.max), sameFramePct: s.sameFramePct,
});

// --- impure measurement ---

/** Time the per-turn prelude exactly as production resolves it. */
const measurePrelude = async (providerId, store) => {
  // Cold was paid by the caller's initial load; here we measure the warm cost
  // the server pays per turn (it re-reads + re-decrypts the store every turn).
  const credTimings = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await loadCredentials();
    credTimings.push(performance.now() - t0);
  }
  const t1 = performance.now();
  // Off-limits lanes refuse before a credential is resolved, let alone spent
  // (provider-registry PROBE_FORBIDDEN — the Claude Code subscription bridge).
  const refusal = probeRefusalReason(providerId);
  if (refusal) throw new Error(`refusing to probe ${providerId}: ${refusal}`);
  const cred = await resolveUsableCredential(providerId, store);
  const resolveMs = performance.now() - t1;

  let guardMs = null;
  if (cred.endpoint) {
    const t2 = performance.now();
    const guard = await assertSafeEndpoint(cred.endpoint);
    guardMs = performance.now() - t2;
    if (!guard.ok) return { credTimings, resolveMs, guardMs, refused: guard.reason, cred };
  }
  return { credTimings, resolveMs, guardMs, refused: null, cred };
};

/** Stream one turn through the real provider path, timestamping every chunk. */
const streamOnce = async (providerId, route) => {
  const messages = [{ role: 'user', content: PROMPT }];
  const tStart = performance.now();
  const streamResult = await createStreamRequest(messages, { route });
  const tHeaders = performance.now();

  const chunks = []; // { t, len, sanitizeMs, frameMs }
  await consumeStream(streamResult, (content) => {
    const t = performance.now();
    const s0 = performance.now();
    const clean = sanitizeModelOutput(content);
    const s1 = performance.now();
    JSON.stringify({ type: 'consciousness:stream', content: clean });
    const s2 = performance.now();
    chunks.push(Object.freeze({ t, len: content.length, sanitizeMs: s1 - s0, frameMs: s2 - s1 }));
  });
  const tEnd = performance.now();

  const times = chunks.map((c) => c.t);
  const totalChars = chunks.reduce((n, c) => n + c.len, 0);
  const durationMs = tEnd - tStart;
  return Object.freeze({
    provider: providerId,
    model: route.model,
    ttftMs: round(times.length ? times[0] - tStart : null),
    headersMs: round(tHeaders - tStart),
    firstChunkAfterHeadersMs: round(times.length ? times[0] - tHeaders : null),
    totalMs: round(durationMs),
    chunks: chunks.length,
    totalChars,
    deliveredCps: round(durationMs > 0 ? (totalChars / durationMs) * 1000 : null),
    interChunk: roundStats(gapStats(times)),
    perChunkCpu: Object.freeze({
      sanitizeP99Ms: round(percentile(chunks.map((c) => c.sanitizeMs).sort((a, b) => a - b), 99)),
      frameP99Ms: round(percentile(chunks.map((c) => c.frameMs).sort((a, b) => a - b), 99)),
    }),
    // Relative-to-start chunk trace for offline pacing simulation (real data,
    // not a model of the network — this is what the provider actually sent).
    trace: chunks.map((c) => Object.freeze({ at: round(c.t - tStart), len: c.len })),
  });
};

const buildRoute = async (providerId, store, modelOverride = null) => {
  const entry = getProvider(providerId);
  if (!entry) throw new Error(`Unknown provider: ${providerId}`);
  // Off-limits lanes refuse before a credential is resolved, let alone spent
  // (provider-registry PROBE_FORBIDDEN — the Claude Code subscription bridge).
  const refusal = probeRefusalReason(providerId);
  if (refusal) throw new Error(`refusing to probe ${providerId}: ${refusal}`);
  const cred = await resolveUsableCredential(providerId, store);
  return {
    provider: providerId,
    endpoint: cred.endpoint,
    apiKey: cred.apiKey,
    accountId: cred.accountId || null,
    model: modelOverride || entry.defaultModel,
    chatPath: entry.chatPath,
  };
};

// --- driver ---

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const runs = args.includes('--runs') ? Number(args[args.indexOf('--runs') + 1]) : 1;
const providerIds = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json' && args[i - 1] !== '--runs');
// `provider` or `provider:model` — the model override mirrors the lane's locked route
const targets = (providerIds.length ? providerIds : ['openai', 'kimi-for-coding']).map((t) => {
  const [id, model] = t.split(':');
  return { id, model: model || null };
});

const tCold = performance.now();
const store = await loadCredentials();
const coldLoadMs = performance.now() - tCold;

const report = { at: new Date().toISOString(), prompt: PROMPT, coldCredentialLoadMs: round(coldLoadMs), providers: [] };

for (const { id: providerId, model } of targets) {
  const entry = { provider: model ? `${providerId}:${model}` : providerId, skipped: null, prelude: null, runs: [] };
  const route = await buildRoute(providerId, store, model);
  if (!route.apiKey) {
    entry.skipped = 'no resolvable key (store > env > catalog all empty) — UNMEASURED, not faked';
    report.providers.push(entry);
    continue;
  }
  const prelude = await measurePrelude(providerId, store);
  entry.prelude = Object.freeze({
    warmCredentialLoadsMs: prelude.credTimings.map(round),
    resolveMs: round(prelude.resolveMs),
    ssrfGuardMs: round(prelude.guardMs),
    refused: prelude.refused,
  });
  if (prelude.refused) {
    entry.skipped = `endpoint refused by SSRF guard: ${prelude.refused}`;
    report.providers.push(entry);
    continue;
  }
  for (let i = 0; i < runs; i++) {
    try {
      entry.runs.push(await streamOnce(providerId, route));
    } catch (err) {
      entry.runs.push({ provider: providerId, error: String(err.message || err) });
    }
  }
  report.providers.push(entry);
}

// --- report ---

for (const p of report.providers) {
  console.log(`\n=== ${p.provider} ===`);
  if (p.skipped) { console.log(`  SKIPPED: ${p.skipped}`); continue; }
  console.log(`  prelude: cred-loads ${JSON.stringify(p.prelude.warmCredentialLoadsMs)}ms | resolve ${p.prelude.resolveMs}ms | ssrf ${p.prelude.ssrfGuardMs}ms`);
  for (const [i, r] of p.runs.entries()) {
    if (r.error) { console.log(`  run ${i + 1}: ERROR ${r.error}`); continue; }
    console.log(`  run ${i + 1} [${r.model}]: ttft ${r.ttftMs}ms (headers ${r.headersMs} + first-chunk ${r.firstChunkAfterHeadersMs}ms) | total ${r.totalMs}ms | ${r.chunks} chunks / ${r.totalChars} chars @ ${r.deliveredCps} cps`);
    console.log(`    inter-chunk ms: p50 ${r.interChunk.p50} | p90 ${r.interChunk.p90} | p99 ${r.interChunk.p99} | max ${r.interChunk.max} | same-frame ${r.interChunk.sameFramePct}%`);
    console.log(`    per-chunk cpu p99: sanitize ${r.perChunkCpu.sanitizeP99Ms}ms | frame-serialize ${r.perChunkCpu.frameP99Ms}ms`);
  }
}
console.log(`\ncold credential load (first disk read + decrypt): ${report.coldCredentialLoadMs}ms`);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(`report written: ${jsonOut}`);
}
