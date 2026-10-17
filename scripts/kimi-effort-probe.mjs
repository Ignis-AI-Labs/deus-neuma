// kimi-effort-probe.mjs — does the Kimi coding lane HONOR its three rungs?
//
// The vendor contract (kimi.com/code/docs, re-read 2026-09-23): k3, k3-256k
// and kimi-for-coding (K2.8) take low | high | max, riding INSIDE the
// thinking block on the Anthropic door — the official client's own format:
//   thinking: { type: 'enabled', effort: 'low' | 'high' | 'max' }
//   thinking: { type: 'disabled' }                       → the off state
// An unknown effort is documented to 400. This probe sends exactly those
// shapes — WITH the turn's real temperature beside them, the combination a
// live turn actually produces — and reads the thinking accounting back.
//
//   node scripts/kimi-effort-probe.mjs              → the sweep (9 calls)
//   node scripts/kimi-effort-probe.mjs --repeat 2   → N samples per rung
//
// Rides the SAME credential door the runtime uses (oauth-token-broker).
// Probes only: it sends questions, it changes nothing.

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO, '.env') });

const { resolveUsableCredential } = await import(path.join(REPO, 'backend/services/oauth-token-broker.js'));

const MODEL = process.env.KIMI_PROBE_MODEL || 'k3';
const REPEAT = Number(process.argv[process.argv.indexOf('--repeat') + 1]) > 0
  ? Number(process.argv[process.argv.indexOf('--repeat') + 1]) : 1;
// One question hard enough that real tiers MUST separate: effort must be
// visible in the work shown, and the answer must be definite.
const QUESTION = process.env.KIMI_PROBE_QUESTION
  || 'A train travels 162 km in 3 hours, then 96 km in 1.5 hours. What is its average speed for the whole journey in km/h? Think carefully.';

const cred = await resolveUsableCredential('kimi-for-coding');
if (!cred?.apiKey) {
  console.error('no usable credential for kimi-for-coding — check the provider credentials store');
  process.exit(1);
}
const url = `${cred.endpoint}/messages`;

const ask = async (label, extra) => {
  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cred.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      temperature: 0.7, // the real turn's shape — a 400 here sinks the design
      messages: [{ role: 'user', content: QUESTION }],
      stream: false,
      ...extra,
    }),
  });
  const body = await response.json().catch(() => null);
  const ms = Date.now() - started;
  return {
    label,
    status: response.status,
    ms,
    usage: body?.usage ?? null,
    thinkingChars: (body?.content || []).filter((b) => b.type === 'thinking').reduce((s, b) => s + (b.thinking?.length || 0), 0),
    error: response.ok ? null : JSON.stringify(body?.error ?? body)?.slice(0, 200),
  };
};

const rows = [];
const rung = async (label, extra) => {
  for (let i = 0; i < REPEAT; i += 1) rows.push(await ask(label, extra));
};

// The three documented rungs, in the official client's shape.
await rung('effort low', { thinking: { type: 'enabled', effort: 'low' } });
await rung('effort high', { thinking: { type: 'enabled', effort: 'high' } });
await rung('effort max', { thinking: { type: 'enabled', effort: 'max' } });
// The documented refusal: an unknown effort must 400 (the lane validates).
await rung('effort bogus (expect 400)', { thinking: { type: 'enabled', effort: 'bogus' } });
// The switch and the untouched baseline.
await rung('thinking disabled', { thinking: { type: 'disabled' } });
await rung('baseline (nothing sent)', {});

for (const r of rows) {
  const u = r.usage ? JSON.stringify(r.usage) : '-';
  console.log(`${r.label.padEnd(26)} status=${r.status} ${String(r.ms).padStart(6)}ms thinkChars=${String(r.thinkingChars).padStart(5)} usage=${u}${r.error ? ` ERROR ${r.error}` : ''}`);
}
