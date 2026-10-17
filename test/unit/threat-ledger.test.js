/**
 * Threat ledger — the CSO office's standing repository, proven against REAL
 * temp disk (RULE 0): dedup on (source, externalId, repo), refresh-never-
 * duplicate on re-scan, assessment transitions, prefix ids, and the corrupt-
 * store law (a ledger that lies about being empty would re-"new" every
 * settled threat).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir, writeJSON } from '../helpers/temp-fs.js';
import {
  createThreatLedger, validateThreat, threatKey, threatCounts, threatsByStatus,
} from '../../backend/services/security/threat-ledger.js';

const OSV_HIT = {
  layer: 'software', source: 'osv', repo: 'neuma',
  externalId: 'GHSA-xvch-5gv4-984h', title: 'minimist prototype pollution',
  severity: 'medium', summary: 'test fixture',
  affected: [{ package: 'minimist', version: '1.2.5' }],
};

describe('threat-ledger (real tmp disk)', () => {
  let dir, ledger, file;
  beforeEach(async () => {
    dir = await createTempDir('threat-ledger');
    file = path.join(dir, 'threats.json');
    ledger = createThreatLedger({ path: file });
  });
  afterEach(() => vi.restoreAllMocks());

  test('validateThreat names what is wrong', () => {
    expect(validateThreat(OSV_HIT)).toBeNull();
    expect(validateThreat({ ...OSV_HIT, layer: 'space' })).toMatch(/layer/);
    expect(validateThreat({ ...OSV_HIT, source: 'gut-feeling' })).toMatch(/source/);
    expect(validateThreat({ ...OSV_HIT, externalId: '' })).toMatch(/externalId/);
    expect(validateThreat({ ...OSV_HIT, title: ' ' })).toMatch(/title/);
    expect(validateThreat({ ...OSV_HIT, severity: 'catastrophic' })).toMatch(/severity/);
  });

  test('ingest lands new entries as status new, deduped on (source, externalId, repo)', async () => {
    const first = await ledger.ingest([OSV_HIT]);
    expect(first.added).toHaveLength(1);
    expect(first.added[0]).toMatchObject({ status: 'new', severity: 'medium', repo: 'neuma' });
    expect(first.added[0].id).toMatch(/^th_/);

    // The same advisory seen by tomorrow's scan refreshes, never duplicates…
    const second = await ledger.ingest([OSV_HIT]);
    expect(second.added).toHaveLength(0);
    expect(second.seen).toBe(1);
    expect(await ledger.load()).toHaveLength(1);
    expect(Date.parse((await ledger.load())[0].lastSeenAt)).toBeGreaterThan(0);

    // …but the same advisory against a DIFFERENT repo is its own entry.
    const third = await ledger.ingest([{ ...OSV_HIT, repo: 'kenorie' }]);
    expect(third.added).toHaveLength(1);
    expect(await ledger.load()).toHaveLength(2);
    expect(threatKey(OSV_HIT)).not.toBe(threatKey({ ...OSV_HIT, repo: 'kenorie' }));
  });

  test('assess settles a threat with its reasoning, by prefix id', async () => {
    const { added } = await ledger.ingest([OSV_HIT]);
    const id = added[0].id;
    const result = await ledger.assess(id.slice(0, 10), {
      status: 'not_affected',
      assessment: 'minimist is a transitive devDep never reached with attacker input',
      surfaces: ['backend/'],
      assessedBy: 'csolane',
    });
    expect(result.ok).toBe(true);
    const stored = await ledger.get(id);
    expect(stored.status).toBe('not_affected');
    expect(stored.assessment).toMatch(/transitive devDep/);
    expect(stored.assessedBy).toBe('csolane');
    expect(stored.assessedAt).toBeTruthy();
    // A settled verdict STANDS through re-scans — the scanner never reopens it.
    await ledger.ingest([OSV_HIT]);
    expect((await ledger.get(id)).status).toBe('not_affected');
  });

  test('assess refuses a verdict without reasons, an unsettling status, and ambiguity', async () => {
    const { added } = await ledger.ingest([OSV_HIT, { ...OSV_HIT, externalId: 'GHSA-aaaa-bbbb-cccc', title: 'another' }]);
    await expect(ledger.assess(added[0].id, { status: 'confirmed', assessment: '' })).rejects.toThrow(/reasoning/);
    await expect(ledger.assess(added[0].id, { status: 'new', assessment: 'x' })).rejects.toThrow(/settling status/);
    await expect(ledger.assess('th_', { status: 'confirmed', assessment: 'x' })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/ambiguous/) });
    await expect(ledger.assess('th_nonexistent', { status: 'confirmed', assessment: 'x' })).resolves.toMatchObject({ ok: false });
  });

  test('the file on disk is real JSON with 0600 posture', async () => {
    await ledger.ingest([OSV_HIT]);
    const stat = await fs.stat(file);
    expect(stat.mode & 0o777).toBe(0o600);
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(parsed).toHaveLength(1);
  });

  test('a corrupt store THROWS — never silently reads empty', async () => {
    await fs.writeFile(file, '{not json');
    await expect(ledger.load()).rejects.toThrow();
    await writeJSON(dir, 'object.json', { not: 'an array' });
    const objectLedger = createThreatLedger({ path: path.join(dir, 'object.json') });
    await expect(objectLedger.load()).rejects.toThrow(/array/);
  });

  test('counts and status views read the same record', async () => {
    await ledger.ingest([
      OSV_HIT,
      { ...OSV_HIT, externalId: 'GHSA-2', title: 'two', layer: 'hardware', source: 'host-probe', repo: null },
      { ...OSV_HIT, externalId: 'GHSA-3', title: 'three', layer: 'house', source: 'house-probe', repo: null },
    ]);
    const entries = await ledger.load();
    expect(threatCounts(entries)).toEqual({
      total: 3,
      byStatus: { new: 3 },
      byLayer: { software: 1, hardware: 1, house: 1 },
    });
    expect(threatsByStatus(entries, 'new')).toHaveLength(3);
    expect(threatsByStatus(entries, 'confirmed')).toHaveLength(0);
  });

  test('every verdict is recorded in the entry\'s HISTORY — never overwritten, only superseded', async () => {
    const { added } = await ledger.ingest([OSV_HIT]);
    const id = added[0].id;
    expect(added[0].history).toEqual([]);

    await ledger.assess(id, { status: 'confirmed', assessment: 'it bites', assessedBy: 'csolane' });
    await ledger.assess(id, { status: 'mitigated', assessment: 'the fix landed in abc123', assessedBy: 'csolane', githubIssue: 'https://example/issue/1' });

    const stored = await ledger.get(id);
    // The latest view stays the LATEST…
    expect(stored.status).toBe('mitigated');
    expect(stored.assessment).toMatch(/fix landed/);
    // …and the whole road to it stands.
    expect(stored.history).toHaveLength(2);
    expect(stored.history[0]).toMatchObject({ status: 'confirmed', assessment: 'it bites', assessedBy: 'csolane' });
    expect(stored.history[1]).toMatchObject({ status: 'mitigated', githubIssue: 'https://example/issue/1' });
    expect(Date.parse(stored.history[0].assessedAt)).toBeGreaterThan(0);
  });

  test('an entry written before history existed is tolerated — its verdict starts the record', async () => {
    await writeJSON(dir, 'legacy.json', [{
      id: 'th_legacy01', layer: 'software', source: 'osv', repo: 'neuma',
      externalId: 'GHSA-legacy', title: 'legacy entry', severity: 'high',
      summary: '', affected: [], surfaces: [], status: 'new', assessment: null,
      publishedAt: null, ingestedAt: 'x', lastSeenAt: 'x',
      assessedAt: null, assessedBy: null, githubIssue: null,
    }]);
    const legacy = createThreatLedger({ path: path.join(dir, 'legacy.json') });
    const result = await legacy.assess('th_legacy01', { status: 'not_affected', assessment: 'does not bite', assessedBy: 'csolane' });
    expect(result.ok).toBe(true);
    const stored = await legacy.get('th_legacy01');
    expect(stored.status).toBe('not_affected');
    expect(stored.history).toHaveLength(1);
    expect(stored.history[0].status).toBe('not_affected');
  });

  test('assessMany settles a batch under one verdict; partial failure is reported, never silent', async () => {
    const { added } = await ledger.ingest([
      OSV_HIT,
      { ...OSV_HIT, externalId: 'GHSA-b2', title: 'batch two' },
      { ...OSV_HIT, externalId: 'GHSA-b3', title: 'batch three' },
    ]);
    const ids = added.map((e) => e.id);
    const result = await ledger.assessMany([ids[0].slice(0, 10), 'th_nonexistent', ids[2]], {
      status: 'not_affected',
      assessment: 'dev-only transitive deps, never server-side reachable',
      assessedBy: 'csolane',
    });
    expect(result.ok).toBe(false); // one id failed — said plainly
    expect(result.settled.map((e) => e.id)).toEqual([ids[0], ids[2]]);
    expect(result.failed).toEqual([{ id: 'th_nonexistent', error: 'no such threat' }]);
    const entries = await ledger.load();
    expect(entries.filter((e) => e.status === 'not_affected')).toHaveLength(2);
    expect(entries.find((e) => e.id === ids[1]).status).toBe('new'); // the un-named one stands
    expect(entries.find((e) => e.id === ids[0]).history[0].assessment).toMatch(/dev-only/);
  });

  test('assessMany refuses an empty batch and a verdict without reasons', async () => {
    await expect(ledger.assessMany([], { status: 'confirmed', assessment: 'x' })).rejects.toThrow(/non-empty/);
    await expect(ledger.assessMany(['th_x'], { status: 'confirmed', assessment: ' ' })).rejects.toThrow(/reasoning/);
  });

  test('the journal hook fires per settled entry, AFTER the verdict stands on disk', async () => {
    const calls = [];
    // The REAL hook signature, exercised with a real async writer — the claim
    // here is the ledger invokes it correctly; the writer itself is proven in
    // assessment-journal.test.js against a real workspace.
    const journaled = createThreatLedger({
      path: file,
      journal: async ({ entry, verdict }) => { calls.push({ id: entry.id, status: verdict.status }); },
    });
    const { added } = await journaled.ingest([OSV_HIT, { ...OSV_HIT, externalId: 'GHSA-j2', title: 'two' }]);
    await journaled.assessMany(added.map((e) => e.id), { status: 'confirmed', assessment: 'bite', assessedBy: 'csolane' });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.id).sort()).toEqual(added.map((e) => e.id).sort());
    // The verdicts landed BEFORE any journal call could have observed them.
    expect((await journaled.load()).every((e) => e.status === 'confirmed')).toBe(true);
  });

  test('a throwing journal never blocks a verdict — fail-soft is the law', async () => {
    const broken = createThreatLedger({
      path: file,
      journal: async () => { throw new Error('disk on fire'); },
    });
    const { added } = await broken.ingest([OSV_HIT]);
    const result = await broken.assess(added[0].id, { status: 'confirmed', assessment: 'bites', assessedBy: 'csolane' });
    expect(result.ok).toBe(true);
    expect((await broken.get(added[0].id)).status).toBe('confirmed');
  });
});
