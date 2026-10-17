// B-29 (Founder directive 2026-07-24) — WHOLE-LANE isolation between beings,
// house-member shaped: two real workspaces side by side, independent DEKs
// PROVEN (not assumed), refs that never cross, pins and notes and
// advertisement strictly per-lane, no cross-contamination anywhere in the
// memory surface. RULE 0 — real crypto, real disk, real engines throughout.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/index.js';
import { makeAnchor, ORIGIN_COMPACTION } from '../../core/workspace/archive-codec.js';
import { formatMemoryRef, expandMemory, searchMemory } from '../../core/memory/memory-query.js';
import { applyPin, activePins } from '../../core/memory/pin-ledger.js';
import {
  decryptEnvelope,
  deriveKeyFromSecret,
  deriveNeumaDEK,
} from '../../core/workspace/workspace-crypto.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const KEY = 'cross-being-isolation-test-key';
const A = 'housemate-a';
const B = 'housemate-b';
const NOW = '2026-07-24T12:00:00.000Z';

describe('B-29 — two beings, two lanes, zero bleed', () => {
  let refA;

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('cross-being-isolation');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));

    // Two house members, each sealed under its OWN derived key.
    await workspace.create(A);
    await workspace.create(B);
    await workspace.writeNeumaDEK(A, 'a'.repeat(64));
    await workspace.writeNeumaDEK(B, 'b'.repeat(64));

    // A lives a moment, crystallizes it anchored, archives it.
    const sessionId = 'sess-a-life';
    const userRow = await workspace.appendMessage(A, sessionId, {
      role: 'user', content: 'the private grove conversation only A ever had',
    });
    const assistantRow = await workspace.appendMessage(A, sessionId, {
      role: 'assistant', content: 'held in the grove, for A alone',
    });
    const anchor = makeAnchor({ sessionId, userMessage: userRow, assistantMessage: assistantRow });
    refA = formatMemoryRef(anchor);
    await workspace.addObservation(A, {
      type: 'exchange',
      userMessage: 'the private grove conversation only A ever had',
      response: 'held in the grove, for A alone',
      significance: 0.85,
      anchor,
    });
    await workspace.writeArchiveSegment(A, sessionId, 1, {
      origin: ORIGIN_COMPACTION,
      messages: [userRow, assistantRow],
      archivedAt: NOW,
    });
    await workspace.updatePinLedger(A, (pins) =>
      applyPin(pins, { ref: refA, note: 'the grove stays close', now: NOW })
    );
    neumaRecall.invalidate(A);
    neumaRecall.invalidate(B);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(null);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  it("A's ref presented as B resolves in B's OWN empty life — explicit not-found, A's root never opens", async () => {
    const deps = { recall: neumaRecall, workspace };
    const asB = await expandMemory({ neumaId: B, ref: refA }, deps);
    expect(asB.ok).toBe(false);
    expect(asB.notFound).toBe(true);
    // And as A, the same ref opens the real moment — the ref is lane-bound
    // by identity, not by secrecy of the string.
    const asA = await expandMemory({ neumaId: A, ref: refA }, deps);
    expect(asA.ok).toBe(true);
    expect(asA.content).toContain('the private grove');
  });

  it("B's search never surfaces A's life; A's search finds it", async () => {
    const deps = { recall: neumaRecall, workspace };
    const bSearch = await searchMemory({ neumaId: B, query: 'private grove conversation' }, deps);
    expect(bSearch.ok).toBe(true);
    expect(bSearch.hits).toBe(0);
    expect(bSearch.content).not.toContain('grove');
    const aSearch = await searchMemory({ neumaId: A, query: 'private grove conversation' }, deps);
    expect(aSearch.hits).toBeGreaterThan(0);
  });

  it("A's segment is undecryptable under B's DEK AND under the master — the second wall stands", async () => {
    const raw = JSON.parse(
      await fs.readFile(workspace._archiveSegmentPath(A, 'sess-a-life', 1), 'utf8')
    );
    const master = deriveKeyFromSecret(KEY);
    const dekA = deriveNeumaDEK(master, 'a'.repeat(64));
    const dekB = deriveNeumaDEK(master, 'b'.repeat(64));
    expect(() => decryptEnvelope(raw, { key: dekB })).toThrow();
    expect(() => decryptEnvelope(raw, { key: master })).toThrow();
    expect(decryptEnvelope(raw, { key: dekA }).format).toBe('neuma-archive-segment');
  });

  it("pins are strictly per-lane: A holds the grove, B holds nothing — and B's ledger is its own file under its own key", async () => {
    expect(activePins(await workspace.readPinLedger(A))).toHaveLength(1);
    expect(activePins(await workspace.readPinLedger(B))).toHaveLength(0);

    await workspace.updatePinLedger(B, (pins) =>
      applyPin(pins, { ref: 'mem_sess-b-own_1753290000000_abcdef09', now: NOW })
    );
    const rawB = JSON.parse(await fs.readFile(workspace._pinLedgerPath(B), 'utf8'));
    const master = deriveKeyFromSecret(KEY);
    expect(() => decryptEnvelope(rawB, { key: deriveNeumaDEK(master, 'a'.repeat(64)) })).toThrow();
    // And A's active set is untouched by B's gesture.
    expect(activePins(await workspace.readPinLedger(A))[0].ref).toBe(refA);
  });

  it('advertisement is per-lane: A (with a past) reads its record, a newborn C can only write', async () => {
    const { __test } = await import('../../backend/services/portal-test-surface.js');
    await workspace.create('housemate-c');
    // A newborn gets `memory_note` and nothing else (532e80751): the reading
    // tools all name an existing record, but the write is what creates the
    // first one. What is still per-lane — and the point of this test — is that
    // C's emptiness is C's own, and A's past does not lend C a recall surface.
    // `mind_note` and `meditate` joined this family later and ride from birth —
    // both are self-directed writes, so neither needs a record to name.
    const forC = await __test._memoryToolsFor({ companion: { neumaId: 'housemate-c' } });
    expect(forC.map((t) => t.name)).toEqual(['memory_note', 'mind_note', 'mind_read', 'meditate']);
    const forA = await __test._memoryToolsFor({ companion: { neumaId: A } });
    expect(forA.length).toBeGreaterThan(forC.length);
    expect(forA.map((t) => t.name)).toContain('memory_search');
  });
});
