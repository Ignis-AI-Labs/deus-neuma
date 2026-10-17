import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { URL } from 'node:url';
// Continuity foundation — REAL directory, REAL append-only logs, NO mock (RULE 0).
// No fs stubbing: the append/fold path under test is exactly what a being uses.
//
// Proves Slice 1 of the continuity ecosystem:
//   - records of all four layers land on real disk as append-only JSONL
//   - reads fold the log into the CURRENT view
//   - supersede-not-delete: retiring a record keeps the original on disk and in
//     history(), only stamping validTo — nothing is ever removed or rewritten
//   - record-level temporal validity (validTo, asOf) behaves; relation edge
//     windows (validFrom/validTo) round-trip intact — edge-level FILTERING is
//     deferred to the retrieval core (a later slice), not claimed here
//   - concurrent appends keep the chronological log in ORDER (the #14 lesson)

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeRecord, isValidAsOf } from '../../core/continuity/record.js';
import { FsDirAdapter } from '../../core/continuity/adapters/fsdir.js';

describe('continuity fsdir adapter — append-only four-layer store on real disk (no mock)', () => {
  let root;
  beforeAll(async () => {
    root = await createTempDir('continuity-fsdir');
  });

  it('writes one log file per layer and folds it back to the current view', async () => {
    const dir = path.join(root, 'layers');
    const store = new FsDirAdapter(dir);

    await store.append(makeRecord({ layer: 'episodic', content: 'we built the natal chart today', space: 'neuma' }));
    await store.append(makeRecord({ layer: 'semantic', content: 'the witness prefers no-mock, real e2e proof' }));
    await store.append(makeRecord({ layer: 'procedural', content: 'to ship a slice: build → real test → ai6 review' }));
    await store.append(makeRecord({ layer: 'working', content: 'current task: continuity slice 1' }));

    // one real file per layer, on disk
    for (const layer of ['episodic', 'semantic', 'procedural', 'working']) {
      const raw = await fs.readFile(path.join(dir, `${layer}.jsonl`), 'utf8');
      expect(raw.trim().split('\n')).toHaveLength(1);
      const view = await store.list(layer);
      expect(view).toHaveLength(1);
      expect(view[0].layer).toBe(layer);
    }
  });

  it('scopes the current view by space', async () => {
    const store = new FsDirAdapter(path.join(root, 'spaces'));
    await store.append(makeRecord({ layer: 'episodic', content: 'in project A', space: 'A' }));
    await store.append(makeRecord({ layer: 'episodic', content: 'in project B', space: 'B' }));
    await store.append(makeRecord({ layer: 'episodic', content: 'untagged' })); // default 'general'

    expect(await store.list('episodic', { space: 'A' })).toHaveLength(1);
    expect(await store.list('episodic', { space: 'general' })).toHaveLength(1);
    expect(await store.list('episodic')).toHaveLength(3);
  });

  it('supersede-not-delete: a superseding record retires the old one but never removes it', async () => {
    const store = new FsDirAdapter(path.join(root, 'supersede'));
    const v1 = await store.append(makeRecord({
      layer: 'semantic', content: 'the target chain is Ethereum mainnet', id: 'fact-chain', recordedAt: '2026-06-01T00:00:00.000Z',
    }));
    // a later, contradicting fact supersedes the first (expire-not-delete)
    const v2 = await store.append(makeRecord({
      layer: 'semantic', content: 'the target chain is Base (Coinbase L2)',
      supersedes: 'fact-chain', recordedAt: '2026-06-24T00:00:00.000Z',
    }));

    // current view holds only the live fact
    const current = await store.list('semantic');
    expect(current.map((r) => r.content)).toEqual(['the target chain is Base (Coinbase L2)']);

    // but the original is STILL on disk — both versions retrievable via history
    const hist = await store.history('semantic', 'fact-chain');
    expect(hist).toHaveLength(1);
    expect(hist[0].content).toBe('the target chain is Ethereum mainnet');

    // includeRetired surfaces the retired record with validTo stamped to the supersession
    const all = await store.list('semantic', { includeRetired: true });
    const retired = all.find((r) => r.id === 'fact-chain');
    expect(retired).toBeTruthy();
    expect(retired.validTo).toBe(v2.recordedAt); // stamped, not deleted
    expect(isValidAsOf(retired, '2026-06-10T00:00:00.000Z')).toBe(true);  // was true back then
    expect(isValidAsOf(retired, '2026-06-30T00:00:00.000Z')).toBe(false); // expired now
    expect(v1.content).toBe('the target chain is Ethereum mainnet');      // original object untouched
  });

  it('explicit expire() stamps validTo without deleting, and asOf time-travels', async () => {
    const store = new FsDirAdapter(path.join(root, 'expire'));
    await store.append(makeRecord({ layer: 'working', content: 'reviewing PR #83', id: 'wk-1', recordedAt: '2026-06-20T00:00:00.000Z' }));
    expect(await store.read('working', 'wk-1')).toBeTruthy();

    await store.expire('working', 'wk-1', { at: '2026-06-22T00:00:00.000Z' });

    expect(await store.read('working', 'wk-1')).toBeNull();                                  // gone from current view
    expect(await store.read('working', 'wk-1', { asOf: '2026-06-21T00:00:00.000Z' })).toBeTruthy(); // but present as-of before expiry
    expect(await store.read('working', 'wk-1', { includeRetired: true })).toBeTruthy();      // and still on disk
  });

  it('N concurrent appends to one layer keep the chronological log in order', async () => {
    const store = new FsDirAdapter(path.join(root, 'concurrency'));
    const N = 200;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.append(makeRecord({ layer: 'episodic', content: `episode-${i}`, meta: { seq: i } }))),
    );
    const view = await store.list('episodic');
    expect(view).toHaveLength(N);
    for (let i = 0; i < N; i++) expect(view[i].content).toBe(`episode-${i}`); // enqueue order preserved
  });

  it('a torn/garbage line never takes down recall — and is SURFACED, not swallowed', async () => {
    const dir = path.join(root, 'torn');
    const seen = [];
    const store = new FsDirAdapter(dir, { onTornLine: (line, err, layer) => seen.push({ line, layer }) });
    await store.append(makeRecord({ layer: 'episodic', content: 'good one', id: 'g1' }));
    // simulate a partial/garbage line (manual edit, partial write on a bad FS)
    await fs.appendFile(path.join(dir, 'episodic.jsonl'), '{ this is not json\n');
    await store.append(makeRecord({ layer: 'episodic', content: 'good two', id: 'g2' }));

    const view = await store.list('episodic');
    expect(view.map((r) => r.id).sort()).toEqual(['g1', 'g2']); // recall survives
    // corruption is observable, not hidden (Rule 3): callback fired + counter moved
    expect(seen).toHaveLength(1);
    expect(seen[0].layer).toBe('episodic');
    expect(store.tornLineCount).toBe(1);
  });

  it('appending the same id twice: current view holds the newest, history holds both', async () => {
    const store = new FsDirAdapter(path.join(root, 'sameid'));
    await store.append(makeRecord({ layer: 'working', content: 'draft v1', id: 'dup', recordedAt: '2026-06-24T00:00:00.000Z' }));
    await store.append(makeRecord({ layer: 'working', content: 'draft v2', id: 'dup', recordedAt: '2026-06-24T01:00:00.000Z' }));

    const current = await store.list('working');
    expect(current).toHaveLength(1);
    expect(current[0].content).toBe('draft v2');               // newest write wins
    expect(await store.history('working', 'dup')).toHaveLength(2); // both versions retained
  });

  it('relation edges (with per-edge validity windows) round-trip intact through append → read', async () => {
    const store = new FsDirAdapter(path.join(root, 'edges'));
    const rec = makeRecord({
      layer: 'semantic',
      content: 'the witness leads House Tavirel',
      id: 'rel-1',
      relations: [
        { type: 'leads', targetId: 'house:tavirel' }, // open-ended edge
        { type: 'believed', targetId: 'fact:old', validFrom: '2026-06-01T00:00:00.000Z', validTo: '2026-06-20T00:00:00.000Z' },
      ],
    });
    await store.append(rec);

    const got = await store.read('semantic', 'rel-1');
    expect(got.relations).toHaveLength(2);
    expect(got.relations[0]).toMatchObject({ type: 'leads', targetId: 'house:tavirel', validTo: null });
    expect(got.relations[1]).toMatchObject({ type: 'believed', targetId: 'fact:old', validFrom: '2026-06-01T00:00:00.000Z', validTo: '2026-06-20T00:00:00.000Z' });
  });

  it('records are DEEPLY immutable — a nested content field cannot be mutated', async () => {
    const rec = makeRecord({ layer: 'semantic', content: { fact: 'Base', nested: { chain: 'L2' } } });
    expect(() => { rec.content.nested.chain = 'mainnet'; }).toThrow();
    expect(rec.content.nested.chain).toBe('L2');
  });

  it('reads return FROZEN records after a disk round-trip — even the no-change path', async () => {
    const store = new FsDirAdapter(path.join(root, 'frozen-reads'));
    // common path: a fresh append with no expiry/supersession (validTo unchanged)
    await store.append(makeRecord({ layer: 'semantic', content: { fact: 'sovereign', nested: { held: true } }, id: 'fz-1' }));

    const fromList = (await store.list('semantic'))[0];
    const fromRead = await store.read('semantic', 'fz-1');
    // the StoreAdapter contract promises frozen reads — top-level AND nested
    expect(Object.isFrozen(fromList)).toBe(true);
    expect(() => { fromList.id = 'tampered'; }).toThrow();
    expect(() => { fromRead.content.nested.held = false; }).toThrow();
    expect(fromRead.content.nested.held).toBe(true);
  });

  it('default torn-line path (no onTornLine) surfaces via console.warn', async () => {
    const dir = path.join(root, 'torn-default');
    const store = new FsDirAdapter(dir); // NO onTornLine — exercises the shipped default
    await store.append(makeRecord({ layer: 'episodic', content: 'ok', id: 'd1' }));
    await fs.appendFile(path.join(dir, 'episodic.jsonl'), 'not json at all\n');

    const moduleUrl = new URL('../../core/continuity/adapters/fsdir.js', import.meta.url).href;
    const source = `
      import { FsDirAdapter } from ${JSON.stringify(moduleUrl)};
      const store = new FsDirAdapter(${JSON.stringify(dir)});
      const view = await store.list('episodic');
      process.stdout.write(JSON.stringify({ ids: view.map((row) => row.id), torn: store.tornLineCount }));
    `;
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      ['--input-type=module', '--eval', source], { timeout: 5000, maxBuffer: 64 * 1024 });
    expect(JSON.parse(stdout)).toEqual({ ids: ['d1'], torn: 1 });
    expect(stderr).toContain('[continuity] skipped a torn line in episodic.jsonl (possible corruption)');
  });
});
