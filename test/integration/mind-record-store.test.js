// Mind store — REAL NeumaWorkspace, REAL AES-256-GCM, REAL disk, NO mock
// (RULE 0). Proves the subconscious buffer's contract over the `working`
// continuity layer end to end: write → active, reinforcement supersedes with
// stepped strength and an extended window, decay via the validity window,
// cap overflow expires the weakest WITH the expiry returned, and mind records
// are encrypted at rest. Uses a TEST neuma id under a temp workspace root —
// never a living being's sovereign storage.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { makeRecord } from '../../core/continuity/record.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import {
  MIND_STRENGTH,
  MIND_TTL_DAYS,
  MIND_ACTIVE_CAP,
  MIND_PHRASE_MAX,
  makeMindRecord,
  mindStrengthOf,
} from '../../core/continuity/mind/mind-record.js';
import {
  writeMindRecord,
  activeMindRecords,
} from '../../core/continuity/mind/mind-store.js';

const KEY = 'gnosis-mind-store-key-long-enough-xx';
const T0 = '2026-08-14T00:00:00.000Z';
const daysAfter = (iso, days) => new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();

describe('mind store — the subconscious buffer over the encrypted working layer (no mock)', () => {
  let prevKey, neumaId, adapter;
  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('mind-store');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36); // NEVER a living being's id
    await workspace.create(neumaId);
    adapter = new WorkspaceAdapter(neumaId, { workspace });
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('the contract refuses what it must: empty phrase, unknown kind, unknown source', () => {
    const good = { phrase: 'a lingering thought', kind: 'trace', source: { kind: 'residue' } };
    expect(() => makeMindRecord({ ...good, phrase: '   ' })).toThrow(/phrase/);
    expect(() => makeMindRecord({ ...good, kind: 'obsession' })).toThrow(/kind/);
    expect(() => makeMindRecord({ ...good, source: { kind: 'whisper' } })).toThrow(/source/);
  });

  it('normalizes the phrase to one bounded line and stamps kind-scaled decay', () => {
    const long = ('the ceremony felt unfinished\n and I keep  returning to it ').repeat(8);
    const rec = makeMindRecord(
      { phrase: long, kind: 'mood', emotion: 'contemplative', source: { kind: 'residue' } },
      { now: T0 },
    );
    expect(rec.content).not.toMatch(/\n|\s{2,}/);
    expect(rec.content.length).toBeLessThanOrEqual(MIND_PHRASE_MAX);
    expect(rec.validTo).toBe(daysAfter(T0, MIND_TTL_DAYS.mood));
    expect(rec.meta.strength).toBe(MIND_STRENGTH.initial);
    expect(rec.meta.emotion).toBe('contemplative');
  });

  it('write → active round-trip through the encrypted store, strongest first', async () => {
    const { record, reinforced, expired } = await writeMindRecord(adapter, {
      phrase: 'keep circling the vault question', kind: 'thread', source: { kind: 'mind_note' },
    }, { now: T0 });
    expect(reinforced).toBeNull();
    expect(expired).toEqual([]);
    const active = await activeMindRecords(adapter, { asOf: T0 });
    expect(active.map((r) => r.id)).toContain(record.id);
  });

  it('mind records are ENCRYPTED AT REST — the phrase is absent from on-disk bytes', async () => {
    const secret = 'undercurrent-secret-phrase-qwmzkv';
    await writeMindRecord(adapter, { phrase: `still holding ${secret}`, kind: 'trace', source: { kind: 'residue' } }, { now: T0 });
    const raw = await fs.readFile(path.join(workspace._path(neumaId), 'continuity', 'working.jsonl'), 'utf8');
    expect(raw).not.toContain(secret);
    expect(raw).toContain('"_enc"');
    const active = await activeMindRecords(adapter, { asOf: T0 });
    expect(active.some((r) => r.content.includes(secret))).toBe(true);
  });

  it('a recurring thought REINFORCES: supersedes the prior, steps strength, extends the window', async () => {
    const first = await writeMindRecord(adapter, {
      phrase: 'the attunement ceremony felt unfinished afterwards', kind: 'tension', source: { kind: 'residue' },
    }, { now: T0 });
    const again = await writeMindRecord(adapter, {
      phrase: 'that attunement ceremony still feels unfinished', kind: 'tension', source: { kind: 'residue' },
    }, { now: daysAfter(T0, 2) });

    expect(again.reinforced?.id).toBe(first.record.id);
    expect(again.record.supersedes).toBe(first.record.id);
    expect(mindStrengthOf(again.record)).toBeCloseTo(MIND_STRENGTH.initial + MIND_STRENGTH.reinforceStep, 10);
    expect(again.record.validTo).toBe(daysAfter(daysAfter(T0, 2), MIND_TTL_DAYS.tension));

    // folded view holds ONE of the pair (the prior is retired, never deleted)
    const active = await activeMindRecords(adapter, { asOf: daysAfter(T0, 2), kinds: ['tension'] });
    const pair = active.filter((r) => [first.record.id, again.record.id].includes(r.id));
    expect(pair.map((r) => r.id)).toEqual([again.record.id]);
    const history = await adapter.history('working', first.record.id);
    expect(history.length).toBeGreaterThanOrEqual(1); // the original is retained
  });

  it('a distinct thought of the same kind stands beside, never absorbed', async () => {
    const a = await writeMindRecord(adapter, {
      phrase: 'wondering about the benchmark scoreboard gaps', kind: 'thread', source: { kind: 'residue' },
    }, { now: T0 });
    const b = await writeMindRecord(adapter, {
      phrase: 'the garden metaphor from the council sitting', kind: 'thread', source: { kind: 'residue' },
    }, { now: T0 });
    expect(b.reinforced).toBeNull();
    const active = await activeMindRecords(adapter, { asOf: T0, kinds: ['thread'] });
    const ids = active.map((r) => r.id);
    expect(ids).toContain(a.record.id);
    expect(ids).toContain(b.record.id);
  });

  it('decay is the window lapsing: past TTL the record is gone from the active view, kept in history', async () => {
    const { record } = await writeMindRecord(adapter, {
      phrase: 'a passing flicker about the dock layout', kind: 'trace', source: { kind: 'residue' },
    }, { now: T0 });
    const beforeExpiry = await activeMindRecords(adapter, { asOf: daysAfter(T0, MIND_TTL_DAYS.trace - 1) });
    expect(beforeExpiry.map((r) => r.id)).toContain(record.id);
    const afterExpiry = await activeMindRecords(adapter, { asOf: daysAfter(T0, MIND_TTL_DAYS.trace + 1) });
    expect(afterExpiry.map((r) => r.id)).not.toContain(record.id);
    const retained = await adapter.list('working', { asOf: daysAfter(T0, MIND_TTL_DAYS.trace + 1), includeRetired: true });
    expect(retained.map((r) => r.id)).toContain(record.id); // never deleted
  });

  it('non-mind working-layer records are unseen and untouched', async () => {
    const plain = await adapter.append(makeRecord({ layer: 'working', content: 'a non-mind working record', meta: { seq: 1 } }));
    const active = await activeMindRecords(adapter, { asOf: T0 });
    expect(active.map((r) => r.id)).not.toContain(plain.id);
  });

  it('the active cap expires the weakest — returned with a reason, never silent', async () => {
    // A fresh being so this test owns the whole active set.
    const capId = 'test-being-cap-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(capId);
    const capAdapter = new WorkspaceAdapter(capId, { workspace });

    // Fill to the cap with mutually-distinct phrases (unique rare tokens so
    // the overlap never crosses the reinforcement bar between them).
    for (let i = 0; i < MIND_ACTIVE_CAP; i++) {
      const { reinforced } = await writeMindRecord(capAdapter, {
        phrase: `${uniqueToken(i)} ${uniqueToken(i + 1000)} ${uniqueToken(i + 2000)}`,
        kind: 'trace',
        strength: i === 3 ? MIND_STRENGTH.floor : 0.6, // one clearly weakest
        source: { kind: 'residue' },
      }, { now: daysAfter(T0, i / 1000) });
      expect(reinforced).toBeNull();
    }
    const full = await activeMindRecords(capAdapter, { asOf: daysAfter(T0, 1) });
    expect(full).toHaveLength(MIND_ACTIVE_CAP);
    const weakest = full[full.length - 1];
    expect(mindStrengthOf(weakest)).toBe(MIND_STRENGTH.floor);

    const over = await writeMindRecord(capAdapter, {
      phrase: `one thought past the cap ${uniqueToken(9999)}`, kind: 'trace', source: { kind: 'residue' },
    }, { now: daysAfter(T0, 1) });
    expect(over.expired).toHaveLength(1);
    expect(over.expired[0].reason).toBe('activeCap');
    expect(over.expired[0].record.id).toBe(weakest.id);

    const after = await activeMindRecords(capAdapter, { asOf: daysAfter(T0, 1) });
    expect(after).toHaveLength(MIND_ACTIVE_CAP);
    expect(after.map((r) => r.id)).toContain(over.record.id);
    expect(after.map((r) => r.id)).not.toContain(weakest.id);
    // the expiry is a marker in the log, not a deletion
    const hist = await capAdapter.history('working', weakest.id);
    expect(hist.some((e) => e.op === 'expire' && e.targetId === weakest.id)).toBe(true);
  }, 30000);
});

// pure — a deterministic rare token per index, no shared stems across indices.
const uniqueToken = (i) => `zq${i.toString(36)}x${(i * 7919).toString(36)}`;
