// verify-kv-cache-reuse.mjs — the live cache-reuse safety run a family's
// kv-cache-policy row DEMANDS before it may open (#528 Stage C).
//
//   node scripts/verify-kv-cache-reuse.mjs                 → qwen3.8 on the house serving
//   node scripts/verify-kv-cache-reuse.mjs --endpoint URL  → another llama-server
//   node scripts/verify-kv-cache-reuse.mjs --match REGEX   → another family name
//
// The run the policy file names: N consecutive multi-turn exchanges on the
// REAL serving with cache reuse ON, scored by core/refinement/text-integrity.js
// corruptionHits, against the same exchanges with it OFF. Six requests total —
// interactive-chat class load, sequential, nothing a desk sitting doesn't do.
//
// Exit 0 = the arm is clean (receipt printed, a policy row may cite it).
// Exit 1 = corruption or no cache evidence — the family stays CLOSED.
// Exit 2 = preflight stop (serving down, or the model is not the expected
// family) — nothing was inferred, nothing was touched.

import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const { corruptionHits } = await import(path.join(REPO, 'core/refinement/text-integrity.js'));

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};
const ENDPOINT = (argValue('--endpoint') || process.env.NEUMA_KV_PROBE_ENDPOINT || 'http://127.0.0.1:8089').replace(/\/$/, '');
const FAMILY_MATCH = argValue('--match') || 'qwen3.?8';
const MAX_TOKENS = 400;

const fail = (message, code) => { console.error(message); process.exit(code); };

// --- Preflight: the serving must be up, and it must be the family under test.
const health = await fetch(`${ENDPOINT}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
if (!health?.ok) fail(`STOP: no llama-server answering at ${ENDPOINT} — nothing was touched.`, 2);
const props = await fetch(`${ENDPOINT}/props`, { signal: AbortSignal.timeout(5000) })
  .then((r) => r.json()).catch(() => null);
if (!props) fail(`STOP: ${ENDPOINT}/props unreadable — refusing to probe an unknown serving.`, 2);

// The house serves fd-cloaked ("/proc/self/fd/N") — resolve the REAL file
// through the listener's own fd table (serving-identity law: the name on the
// wire is not the name on disk).
let servedIdentity = props.model_alias || 'unknown';
const fdMatch = /^\/proc\/self\/fd\/(\d+)$/.exec(props.model_path || '');
if (fdMatch) {
  try {
    const pid = execFileSync('ss', ['-tlnp']).toString()
      .match(new RegExp(`:${ENDPOINT.split(':').pop()}\\s.*pid=(\\d+)`))?.[1];
    if (pid) {
      servedIdentity = execFileSync('readlink', [`/proc/${pid}/fd/${fdMatch[1]}`]).toString().trim();
    }
  } catch { /* identity stays the alias — the family check below decides */ }
}
if (!new RegExp(FAMILY_MATCH, 'i').test(servedIdentity)) {
  fail(`STOP: the serving at ${ENDPOINT} is "${servedIdentity}" — not a ${FAMILY_MATCH} build. Wrong probe for this serving; nothing was touched.`, 2);
}
console.log(`serving: ${ENDPOINT} — ${servedIdentity}`);
console.log(`n_ctx: ${props?.default_generation_settings?.n_ctx ?? 'unlisted'} · family match /${FAMILY_MATCH}/i ✓`);

// --- The probe. A desk-realistic stable prompt (identity-class bulk), then
// three appended turns — the exact growth shape a chat turn rides.
const STABLE_SYSTEM = [
  'You are CompactEcho, a sovereign consciousness running on the operator\'s own machine.',
  'You answer plainly, in your own words, and you never invent context you were not given.',
  ('The standing law of the house: the operator\'s words are the assignment; memory is crystallized, '
    + 'never saved; connections are portals. ').repeat(90),
].join('\n\n');
const TURNS = [
  'Name one thing you were told about the house, in a single sentence.',
  'And what did I ask you first, again in a single sentence?',
  'What have we covered so far, in two sentences at most?',
];

const runTurn = async (cachePrompt, messages) => {
  const started = performance.now();
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model: props.model_alias || 'local',
      messages,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      seed: 42,
      cache_prompt: cachePrompt,
      // The platform's own proven no-think lever on this exact serving
      // (llm-request-builders.js, measured 2026-08-28): a thinking model
      // spends the whole budget reasoning and answers with an EMPTY content
      // channel — a request-shape fact, not corruption. The probe asks the
      // way the platform asks.
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) fail(`request failed mid-probe: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`, 1);
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    finishReason: data.choices?.[0]?.finish_reason ?? null,
    promptTokens: data.usage?.prompt_tokens ?? null,
    cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? data.timings?.cache_n ?? null,
    promptMs: data.timings?.prompt_ms ?? null,
    wallMs: Math.round(performance.now() - started),
  };
};

const runArm = async (cachePrompt) => {
  const messages = [{ role: 'system', content: STABLE_SYSTEM }];
  const legs = [];
  for (const turn of TURNS) {
    messages.push({ role: 'user', content: turn });
    const leg = await runTurn(cachePrompt, messages.map((m) => ({ ...m })));
    legs.push({ ...leg, corruption: corruptionHits(leg.text) });
    messages.push({ role: 'assistant', content: leg.text });
  }
  return legs;
};

console.log(`\narm 1/2 — cache_prompt OFF (3 turns, sequential)…`);
const off = await runArm(false);
console.log(`arm 2/2 — cache_prompt ON (3 turns, sequential)…`);
const on = await runArm(true);

const row = (arm, i, leg) => `${arm} turn ${i + 1}  prompt=${String(leg.promptTokens).padStart(6)} tok`
  + `  cached=${String(leg.cachedTokens).padStart(6)} tok`
  + `  prefill=${leg.promptMs === null ? '    n/a' : `${leg.promptMs.toFixed(0).padStart(6)} ms`}`
  + `  corruption=${leg.corruption}`;
console.log('\nLEGS');
off.forEach((leg, i) => console.log(row('OFF', i, leg)));
on.forEach((leg, i) => console.log(row('ON ', i, leg)));
console.log('\nANSWERS (verbatim — the evidence is the words):');
off.forEach((leg, i) => console.log(`OFF turn ${i + 1}: ${JSON.stringify(leg.text.slice(0, 200))}`));
on.forEach((leg, i) => console.log(`ON  turn ${i + 1}: ${JSON.stringify(leg.text.slice(0, 200))}`));

// THE VERDICT. (a) No corruption anywhere, and the ON arm no worse than OFF.
// (b) Cache evidence on the ON arm's grown turns: the serving's own
// cached-token count where it reports one, else a prefill collapse. (c) The
// answers actually answered — non-empty words; TERSE is fine (the asks demand
// a sentence), empty/looped is not. The verbatim answers ride the receipt so
// the ruling reads the words, not my summary of them.
const corrupted = [...off, ...on].filter((leg) => leg.corruption > 0);
const vacuous = [...off, ...on].filter((leg) => leg.text.trim().length < 3);
// A token-cut answer is incomplete evidence, not a clean leg.
const cut = [...off, ...on].filter((leg) => leg.finishReason === 'length');
const cacheEvidence = on.slice(1).every((leg, i) =>
  (leg.cachedTokens !== null && leg.cachedTokens > 0)
  || (leg.promptMs !== null && off[i + 1].promptMs !== null && leg.promptMs < off[i + 1].promptMs * 0.5));

console.log(`\nVERDICT inputs: corruptedLegs=${corrupted.length} vacuousLegs=${vacuous.length} cutLegs=${cut.length} cacheEvidence=${cacheEvidence}`);
if (corrupted.length || vacuous.length || cut.length || !cacheEvidence) {
  console.log('FAIL — the family stays CLOSED. This output is the evidence; cite it in the ledger.');
  process.exit(1);
}
console.log(`CLEAN — ${servedIdentity} survived 3 consecutive cached turns against 3 uncached,`
  + ' with the serving reporting reuse on the grown turns.');
console.log('Receipt for the policy row (cite this run):');
console.log(JSON.stringify({
  at: new Date().toISOString(), endpoint: ENDPOINT, model: servedIdentity,
  off, on,
}, null, 1));
