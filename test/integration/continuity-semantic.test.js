// Semantic consolidation — REAL directory, REAL logs, NO mock (RULE 0).
//
// Two kinds of proof, both honest:
//   1. The ENGINE (clustering → summarize → store → idempotence → supersede) is
//      proven with a DETERMINISTIC injected summarizer. This is NOT a mock of an
//      execution boundary — the summarizer is the engine's documented injection
//      seam (the contract), and the engine genuinely does not know or care
//      whether it is an LLM or a function. Everything runs on real disk.
//   2. The LLM HALF is proven LIVE against the real gemma-3-4b summarizer on the
//      LM Studio endpoint. Gated: if the endpoint is unreachable the live test is
//      SKIPPED (not silently passed), so CI without a model stays honest.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeRecord } from '../../core/continuity/record.js';
import { FsDirAdapter } from '../../core/continuity/adapters/fsdir.js';
import { consolidate, recallSemantic, biography } from '../../core/continuity/layers/semantic.js';

const ep = (content) => makeRecord({ layer: 'episodic', content });

// two clean clusters (no shared content tokens; 'witness' is a stopword so it
// never links them): A = natal-chart (3), B = wallet-vault (2).
const CLUSTER_A = [
  'the natal chart records the ascendant and midheaven at birth',
  'the natal chart angles come from the birth location coordinates',
  'we wired the natal chart into the birth ceremony',
];
const CLUSTER_B = [
  'the wallet vault encrypts the key with scrypt and aes',
  'the wallet vault uses a versioned envelope for the key',
];

// a deterministic summarizer — identifiable output, no model (label is a
// space-joined keyword string from community-detection's labelCommunity)
const detSummarize = async (snippets, ctx) => `through-line of ${snippets.length} on ${ctx.label}`;

describe('continuity semantic consolidation — cluster→summarize→store on real disk (no mock)', () => {
  let root;
  beforeAll(async () => {
    root = await createTempDir('continuity-semantic');
  });
  afterAll(() => vi.restoreAllMocks());

  const seed = async (dir, episodes) => {
    const store = new FsDirAdapter(path.join(root, dir));
    for (const c of episodes) await store.append(ep(c));
    return store;
  };

  it('clusters episodes and writes one through-line per qualifying cluster', async () => {
    const store = await seed('basic', [...CLUSTER_A, ...CLUSTER_B]);
    const result = await consolidate(store, { summarize: detSummarize });

    expect(result.written).toHaveLength(2);                 // one per cluster (A size3, B size2)
    for (const rec of result.written) {
      expect(rec.layer).toBe('semantic');
      expect(rec.content).toMatch(/^through-line of \d+ on /);
      expect(rec.meta.memberHash).toBeTruthy();
      expect(Array.isArray(rec.meta.memberIds)).toBe(true);
    }
    const bio = await biography(store);
    expect(bio).toHaveLength(2);
  });

  it('is idempotent — a second run over unchanged episodes writes nothing', async () => {
    const store = await seed('idempotent', [...CLUSTER_A, ...CLUSTER_B]);
    await consolidate(store, { summarize: detSummarize });
    const again = await consolidate(store, { summarize: detSummarize });

    expect(again.written).toHaveLength(0);
    expect(again.skipped.every((s) => s.reason === 'unchanged')).toBe(true);
    expect(await biography(store)).toHaveLength(2);          // no duplicates
  });

  it('an evolved cluster supersedes its prior through-line (not deletes)', async () => {
    const store = await seed('evolve', CLUSTER_A);
    const first = await consolidate(store, { summarize: detSummarize });
    expect(first.written).toHaveLength(1);
    const firstId = first.written[0].id;

    // a new episode joins cluster A → its member set changes → re-consolidation
    // supersedes the prior through-line and writes a fresh one
    await store.append(ep('the natal chart sky is re-derivable from the sealed birth moment'));
    const second = await consolidate(store, { summarize: detSummarize });

    expect(second.written).toHaveLength(1);
    expect(second.written[0].supersedes).toBe(firstId);     // prior retired by id
    const bio = await biography(store);
    expect(bio).toHaveLength(1);                             // only the current through-line
    expect(bio[0].content).toBe('through-line of 4 on ' + bio[0].meta.label);
    // the old one is retired, not deleted — still in history
    const hist = await store.history('semantic', firstId);
    expect(hist).toHaveLength(1);
  });

  it('recallSemantic finds the through-line relevant to a query', async () => {
    const store = await seed('recall', [...CLUSTER_A, ...CLUSTER_B]);
    await consolidate(store, { summarize: async (s, ctx) => ctx.label });

    const hits = await recallSemantic(store, 'natal chart birth');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].record.content).toMatch(/natal|chart|birth/);
  });

  it('a singleton episode forms no through-line (min cluster size)', async () => {
    const store = await seed('singleton', ['a lone unrelated thought about nothing in particular xyzzy']);
    const result = await consolidate(store, { summarize: detSummarize });
    expect(result.written).toHaveLength(0);
  });

  it('empty episodic store consolidates to nothing', async () => {
    const store = new FsDirAdapter(path.join(root, 'empty'));
    const result = await consolidate(store, { summarize: detSummarize });
    expect(result).toEqual({ written: [], skipped: [], clusters: 0 });
  });

  it('requires a summarizer function', async () => {
    const store = await seed('nosumm', CLUSTER_A);
    await expect(consolidate(store, {})).rejects.toThrow(/summarize/);
  });

  it('stays correct even if an adapter RETURNS superseded records (defensive current-set)', async () => {
    // a deliberately non-conforming adapter: list('semantic') leaks retired
    // records. The engine must not depend on list() excluding them.
    class RetiredLeakingAdapter extends FsDirAdapter {
      async list(layer, opts = {}) {
        return super.list(layer, layer === 'semantic' ? { ...opts, includeRetired: true } : opts);
      }
    }
    const store = new RetiredLeakingAdapter(path.join(root, 'leaky'));
    for (const c of CLUSTER_A) await store.append(ep(c));
    const first = await consolidate(store, { summarize: detSummarize });
    expect(first.written).toHaveLength(1);

    await store.append(ep('the natal chart sky is re-derivable from the sealed birth moment'));
    const second = await consolidate(store, { summarize: detSummarize });
    expect(second.written).toHaveLength(1);                     // evolved → wrote a fresh through-line
    expect(second.written[0].supersedes).toBe(first.written[0].id);

    const raw = await store.list('semantic');
    expect(raw.length).toBeGreaterThanOrEqual(2);               // adapter DOES leak the retired record
    expect(await biography(store)).toHaveLength(1);             // …yet biography shows only the current one
    const third = await consolidate(store, { summarize: detSummarize });
    expect(third.written).toHaveLength(0);                      // …and idempotence still holds (no false re-write)
  });
});

// ── LLM half: proven live against the real gemma-3-4b summarizer ──────────────
// Setup: LM Studio serving a small instruct model loaded as `gemma-summarizer`
//   lms load google/gemma-3-4b --identifier gemma-summarizer  (server on :1234)
// Override the endpoint/model for a different setup:
//   SUMMARIZER_URL=http://host:port/v1  SUMMARIZER_MODEL=my-model
// If the endpoint is unreachable the live test is SKIPPED (never silently passed).
// The MACHINE-CONFIGURED substrate by default (live-lane setup boots the real
// config, same as server.js) — never a hardcoded :1234: LM Studio never serves,
// and its llmster daemon answers /models with ZERO models loaded, so […] was a dishonest liveness gate (died on the error body,
// 2026-07-11). Honest gate = the models list is NON-EMPTY; the first live
// model is the summarizer unless SUMMARIZER_MODEL overrides.
const { getAppConfig } = await import('../../backend/config.js');
const machineBase = (() => {
  try {
    const cfg = getAppConfig();
    return `${cfg.llmProvider === 'llama-server' ? cfg.llamaServerUrl : cfg.lmStudioUrl}/v1`;
  } catch { return 'http://localhost:1234/v1'; } // config-less run (suite lane) → old default, gate below skips honestly
})();
const ENDPOINT = process.env.SUMMARIZER_URL || machineBase;
const liveModels = await fetch(`${ENDPOINT}/models`)
  .then((r) => (r.ok ? r.json() : null)).catch(() => null);
const MODEL = process.env.SUMMARIZER_MODEL || liveModels?.data?.[0]?.id || 'gemma-summarizer';
const LIVE = Boolean(liveModels?.data?.length);

const gemmaSummarize = async (snippets) => {
  const res = await fetch(`${ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'Write a 1-2 sentence first-person through-line capturing the theme of these memory snippets, in your own voice. Output only the summary.' },
        { role: 'user', content: 'Snippets:\n- ' + snippets.join('\n- ') },
      ],
      temperature: 0.4,
      max_tokens: 120,
    }),
  });
  const data = await res.json();
  if (!data.choices?.[0]?.message) {
    throw new Error(`summarizer error from ${ENDPOINT}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.choices[0].message.content;
};

describe('continuity semantic — LLM half proven live against gemma-3-4b (no mock)', () => {
  it.skipIf(!LIVE)('consolidation with the real summarizer lands a coherent through-line', async () => {
    const dir = await createTempDir('continuity-semantic-live');
    const store = new FsDirAdapter(path.join(dir, 'live'));
    for (const c of [
      'I shipped the foundation of the continuity engine and it was ai6 approved',
      'I built episodic recall over the continuity engine with bm25 and recency',
      'I built the working layer of the continuity engine with a hard token budget',
    ]) await store.append(ep(c));

    const result = await consolidate(store, { summarize: gemmaSummarize });
    expect(result.written.length).toBeGreaterThanOrEqual(1);

    const bio = await biography(store);
    expect(bio[0].content.length).toBeGreaterThan(20);           // a real sentence, not a stub
    expect(bio[0].content).not.toMatch(/undefined|\[object/i);   // not a serialization artifact
    console.info('[live gemma through-line]', bio[0].content);
  }, 30000);
});
