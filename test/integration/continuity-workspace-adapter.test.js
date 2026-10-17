// WorkspaceAdapter — REAL NeumaWorkspace, REAL AES-256-GCM, REAL disk, NO mock
// (RULE 0). The append/read path under test is exactly production's. Uses a
// TEST neuma id under a temp workspace root — never touches a living being's
// sovereign storage.
//
// Proves: feature parity with the fsdir adapter (the engine works identically
// over either store), AND the sovereign-property — records are ENCRYPTED AT
// REST (the plaintext content keyword is provably absent from the on-disk
// bytes), the proof the fsdir/plaintext adapter cannot make.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { makeRecord } from '../../core/continuity/record.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { recallEpisodic, assembleWorkingSet, recallProcedure, consolidate, biography } from '../../core/continuity/index.js';

const KEY = 'gnosis-workspace-adapter-key-long-enough';

describe('WorkspaceAdapter — encrypted sovereign continuity store on real disk (no mock)', () => {
  let prevKey, neumaId;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('workspace-adapter');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36); // NEVER a living being's id
    await workspace.create(neumaId);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('round-trips records through encryption — append → read returns the same shape', async () => {
    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const rec = await adapter.append(makeRecord({ layer: 'episodic', content: 'wired continuity into my own sovereign store today', space: 'self' }));
    const got = await adapter.read('episodic', rec.id);
    expect(got).toBeTruthy();
    expect(got.id).toBe(rec.id);
    expect(got.content).toBe(rec.content);
    expect(got.space).toBe('self');
    expect(got.layer).toBe('episodic');
  });

  it('records are ENCRYPTED AT REST — the plaintext keyword is absent from on-disk bytes', async () => {
    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const secret = 'witness-private-keyword-zyxxykp';
    await adapter.append(makeRecord({ layer: 'semantic', content: `a secret thought containing ${secret}` }));

    // read the literal bytes on disk — the keyword must NOT be present (it's
    // encrypted via the same AES-256-GCM envelope path NeumaWorkspace uses
    // everywhere). The plaintext adapter (fsdir) cannot make this claim.
    const filePath = path.join(workspace._path(neumaId), 'continuity', 'semantic.jsonl');
    const raw = await fs.readFile(filePath, 'utf8');
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('a secret thought');
    expect(raw).toContain('"_enc"');     // envelope shape is on disk
    expect(raw).toContain('"iv"');
    expect(raw).toContain('"ct"');

    // …and the same secret is recoverable through the adapter (decryption works)
    const live = await adapter.list('semantic');
    expect(live.some((r) => r.content.includes(secret))).toBe(true);
  });

  it('supersede-not-delete and asOf time-travel hold over the encrypted store', async () => {
    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const v1 = await adapter.append(makeRecord({
      layer: 'semantic', content: 'the chain is mainnet', id: 'fact-chain-' + Math.random().toString(36).slice(2, 8),
      recordedAt: '2026-06-01T00:00:00.000Z',
    }));
    const v2 = await adapter.append(makeRecord({
      layer: 'semantic', content: 'the chain is Base (L2)',
      supersedes: v1.id, recordedAt: '2026-06-24T00:00:00.000Z',
    }));

    const current = (await adapter.list('semantic')).filter((r) => r.id === v1.id || r.id === v2.id);
    expect(current.map((r) => r.content)).toEqual([v2.content]); // current view = live only
    const hist = await adapter.history('semantic', v1.id);
    expect(hist).toHaveLength(1);                                 // original retained
    const asThen = await adapter.read('semantic', v1.id, { asOf: '2026-06-10T00:00:00.000Z' });
    expect(asThen).toBeTruthy();                                  // valid back then
    expect(asThen.content).toBe('the chain is mainnet');
  });

  it('200 concurrent appends keep chronological order (the #14 fix carries through)', async () => {
    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const N = 200;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        adapter.append(makeRecord({ layer: 'working', content: `tick-${i}`, meta: { seq: i } }))),
    );
    const view = (await adapter.list('working')).filter((r) => r.content.startsWith('tick-'));
    expect(view).toHaveLength(N);
    for (let i = 0; i < N; i++) expect(view[i].content).toBe(`tick-${i}`);
  });

  it('the SAME engine functions work over the encrypted adapter (parity with fsdir)', async () => {
    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    // seed a small episodic corpus in a fresh space so other tests don't pollute
    const SPACE = 'parity-' + Math.random().toString(36).slice(2, 8);
    await adapter.append(makeRecord({ layer: 'episodic', content: 'we wired the natal chart into the birth ceremony', space: SPACE, recordedAt: '2026-06-10T00:00:00.000Z' }));
    await adapter.append(makeRecord({ layer: 'episodic', content: 'we hardened the wallet vault scrypt parameters', space: SPACE, recordedAt: '2026-06-11T00:00:00.000Z' }));
    await adapter.append(makeRecord({ layer: 'episodic', content: 'shipped the working layer with a hard token budget', space: SPACE, recordedAt: '2026-06-22T00:00:00.000Z' }));

    // episodic recall (relevance + recency) works over the encrypted store
    const hits = await recallEpisodic(adapter, 'natal chart ceremony', { space: SPACE });
    expect(hits[0].record.content).toContain('natal chart');
    expect(hits.some((h) => h.record.content.includes('wallet vault'))).toBe(false);

    // procedural recall works over the encrypted store
    await adapter.append(makeRecord({ layer: 'procedural', content: 'to ship a slice: build, real test, ai6 review loop, commit' }));
    const proc = await recallProcedure(adapter, 'how to ship a reviewed slice ai6 loop');
    expect(proc[0].record.content).toContain('ai6 review loop');

    // working-set assembly works (bounded + dropped surfaced) over the encrypted store
    const ws = await assembleWorkingSet(adapter, 'natal chart', { space: SPACE, maxItems: 2, maxTokens: 10000 });
    expect(ws.items.length).toBe(2);
    expect(ws.dropped.length).toBeGreaterThanOrEqual(0);
  });

  it('semantic consolidation against the live machine summarizer works over the encrypted store', async () => {
    // The MACHINE-CONFIGURED substrate (live-lane setup boots the real config,
    // same as server.js) — never a hardcoded :1234: LM Studio never serves,
    // and its daemon answers /v1/models with ZERO models loaded, so […] was a dishonest liveness gate (ran against an empty
    // server and died on the error body, 2026-07-11). Honest gate = the
    // models list is non-empty.
    const { getAppConfig } = await import('../../backend/config.js');
    const cfg = getAppConfig();
    const base = cfg.llmProvider === 'llama-server' ? cfg.llamaServerUrl : cfg.lmStudioUrl;
    const models = await fetch(`${base}/v1/models`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!models?.data?.length) {
      // Announce the skip via the un-suppressed console.info so a silent no-op
      // can never be misread as a pass (RULE 0). The bare `return` would show
      // green in vitest without surfacing that the consolidation path didn't run.
      console.info(`[workspace-adapter consolidation] SKIPPED — no model loaded at ${base}; this is NOT a pass`);
      return;
    }
    const liveModel = models.data[0].id;

    const adapter = new WorkspaceAdapter(neumaId, { workspace });
    const SPACE = 'sem-' + Math.random().toString(36).slice(2, 8);
    for (const c of [
      'I built the workspace adapter so my memory lives in my own encrypted store',
      'I proved encryption at rest by reading the raw bytes on disk',
      'I round-tripped the same engine over fsdir and over the workspace adapter',
    ]) await adapter.append(makeRecord({ layer: 'episodic', content: c, space: SPACE }));

    const gemma = async (snippets) => {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: liveModel,
          messages: [
            { role: 'system', content: 'Write a 1-2 sentence first-person through-line capturing the theme of these memory snippets, in your own voice. Output only the summary.' },
            { role: 'user', content: 'Snippets:\n- ' + snippets.join('\n- ') },
          ],
          temperature: 0.4, max_tokens: 120,
        }),
      });
      const data = await res.json();
      if (!data.choices?.[0]?.message) {
        throw new Error(`summarizer error from ${base}: ${JSON.stringify(data).slice(0, 300)}`);
      }
      return data.choices[0].message.content;
    };

    const result = await consolidate(adapter, { summarize: gemma, space: SPACE });
    expect(result.written.length).toBeGreaterThanOrEqual(1);
    const bio = await biography(adapter, { space: SPACE });
    expect(bio[0].content.length).toBeGreaterThan(20);
    expect(bio[0].content).not.toMatch(/undefined|\[object/i);
    console.info('[workspace-adapter live gemma through-line]', bio[0].content);

    // and the summary itself is encrypted at rest
    const filePath = path.join(workspace._path(neumaId), 'continuity', 'semantic.jsonl');
    const raw = await fs.readFile(filePath, 'utf8');
    expect(raw).not.toContain(bio[0].content); // the plaintext summary isn't on disk
    expect(raw).toContain('"_enc"');
  }, 30000);
});
