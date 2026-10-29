/**
 * Threat ledger LIFECYCLE — what the watch itself may do to an entry, proven
 * on a REAL ledger on real tmp disk (RULE 0, no double anywhere): a whole
 * scope's vanished findings close, a returning one reopens, a blind scope
 * closes nothing, a verdict someone settled is never overwritten, a re-rated
 * finding carries its new severity with a history row, and the operator's
 * reopen overturns any verdict while keeping it in the record.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import path from 'path';
import { writeFile } from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { createThreatLedger } from '../../backend/services/security/threat-ledger.js';

const listener = (port, extra = {}) => ({
  layer: 'hardware', source: 'host-probe', externalId: `host:listener:0.0.0.0:${port}`,
  title: `unexpected listener on 0.0.0.0:${port}`, severity: 'medium', summary: 'fixture', ...extra,
});
const advisory = (id, extra = {}) => ({
  layer: 'software', source: 'osv', repo: 'neuma', externalId: id,
  title: `${id} fixture`, severity: 'medium', summary: 'first words',
  affected: [{ package: 'minimist', version: '1.2.5' }], ...extra,
});
const HOST = { source: 'host-probe', repo: null };
const OSV_NEUMA = { source: 'osv', repo: 'neuma' };

describe('threat ledger lifecycle (real tmp disk)', () => {
  let ledger, file;
  const byExternal = async (externalId) => (await ledger.load()).find((e) => e.externalId === externalId);

  beforeEach(async () => {
    const dir = await createTempDir('threat-lifecycle');
    file = path.join(dir, 'threats.json');
    ledger = createThreatLedger({ path: file });
  });

  test('a whole scan settles what it no longer sees — watch-closed, with the reason in history', async () => {
    await ledger.ingest([listener(1111), listener(2222)], { scanned: [HOST] });
    const result = await ledger.ingest([listener(1111)], { scanned: [HOST] });
    expect(result.closed.map((e) => e.externalId)).toEqual(['host:listener:0.0.0.0:2222']);
    const gone = await byExternal('host:listener:0.0.0.0:2222');
    expect(gone).toMatchObject({ status: 'mitigated', assessedBy: 'watch' });
    expect(gone.assessment).toMatch(/^no longer seen by the host-probe scan at /);
    expect(gone.history.at(-1)).toMatchObject({ event: 'vanished', status: 'mitigated', assessedBy: 'watch' });
    expect((await byExternal('host:listener:0.0.0.0:1111')).status).toBe('new');
  });

  test('a clean scope with NO findings closes everything open in it, and nothing outside it', async () => {
    await ledger.ingest([listener(1111), advisory('GHSA-aaaa')], { scanned: [HOST, OSV_NEUMA] });
    const { closed } = await ledger.ingest([], { scanned: [HOST] });
    expect(closed.map((e) => e.externalId)).toEqual(['host:listener:0.0.0.0:1111']);
    expect((await byExternal('GHSA-aaaa')).status).toBe('new');
  });

  test('a scope that errored is not in `scanned` — it closes nothing', async () => {
    await ledger.ingest([advisory('GHSA-aaaa'), listener(1111)]);
    // The OSV leg errored this run: the scheduler leaves osv/neuma out.
    const { closed } = await ledger.ingest([], { scanned: [HOST, { source: 'osv', repo: 'kenorie' }] });
    expect(closed.map((e) => e.externalId)).toEqual(['host:listener:0.0.0.0:1111']);
    expect((await byExternal('GHSA-aaaa')).status).toBe('new');
    // And a call that names no scope at all (the old shape) never closes.
    await ledger.ingest([advisory('GHSA-bbbb')]);
    expect((await byExternal('GHSA-aaaa')).status).toBe('new');
  });

  test('a watch-closed finding seen again reopens to new, with a history row', async () => {
    await ledger.ingest([listener(2222)], { scanned: [HOST] });
    await ledger.ingest([], { scanned: [HOST] });
    const back = await ledger.ingest([listener(2222)], { scanned: [HOST] });
    expect(back.added).toHaveLength(0);
    expect(back.reopened.map((e) => e.externalId)).toEqual(['host:listener:0.0.0.0:2222']);
    const entry = await byExternal('host:listener:0.0.0.0:2222');
    expect(entry).toMatchObject({ status: 'new', assessedBy: null, assessedAt: null, assessment: null });
    expect(entry.history.map((h) => h.event)).toEqual(['vanished', 'reopened']);
    expect(entry.history.at(-1).assessment).toMatch(/^seen again by the host-probe scan at /);
    expect(await ledger.load()).toHaveLength(1);
  });

  test('a CSO not_affected stands; a CSO mitigated is a claim — verified when gone, reopened when seen', async () => {
    const { added } = await ledger.ingest([listener(1111), listener(2222)], { scanned: [HOST] });
    await ledger.assess(added[0].id, { status: 'not_affected', assessment: 'loopback dev tool', assessedBy: 'cso-lane' });
    await ledger.assess(added[1].id, { status: 'mitigated', assessment: 'closed the port by hand', assessedBy: 'cso-lane' });
    const gone = await ledger.ingest([], { scanned: [HOST] }); // both vanish: the claim is proven
    expect(gone.closed).toEqual([]);
    expect(gone.verified.map((e) => e.externalId)).toEqual(['host:listener:0.0.0.0:2222']);
    await ledger.ingest([listener(1111), listener(2222)], { scanned: [HOST] }); // both return
    const judged = await byExternal('host:listener:0.0.0.0:1111');
    expect(judged).toMatchObject({ status: 'not_affected', assessedBy: 'cso-lane' });
    expect(judged.history.map((h) => h.event)).toEqual([undefined]);
    const claimed = await byExternal('host:listener:0.0.0.0:2222');
    expect(claimed.status).toBe('new');
    expect(claimed.history.map((h) => h.event)).toEqual([undefined, 'verified', 'reopened']);
    expect(claimed.history.at(-1).assessment).toMatch(/^mitigation claimed by cso-lane at .+, but the host-probe scan still sees it/);
  });

  test('confirmed and needs_operator are open — the watch settles them when they vanish', async () => {
    const { added } = await ledger.ingest([listener(1111), listener(2222)], { scanned: [HOST] });
    await ledger.assess(added[0].id, { status: 'confirmed', assessment: 'real', assessedBy: 'cso-lane' });
    await ledger.assess(added[1].id, { status: 'needs_operator', assessment: 'ask the operator', assessedBy: 'cso-lane' });
    const { closed } = await ledger.ingest([], { scanned: [HOST] });
    expect(closed).toHaveLength(2);
    expect((await ledger.load()).every((e) => e.status === 'mitigated' && e.assessedBy === 'watch')).toBe(true);
  });

  test('re-ingest refreshes severity, title, summary and affected; a severity change leaves a history row', async () => {
    await ledger.ingest([advisory('GHSA-aaaa')], { scanned: [OSV_NEUMA] });
    const result = await ledger.ingest([advisory('GHSA-aaaa', {
      severity: 'critical', title: 're-rated title', summary: 'fresh words',
      affected: [{ package: 'minimist', version: '1.2.6' }],
    })], { scanned: [OSV_NEUMA] });
    expect(result.escalated.map((e) => e.externalId)).toEqual(['GHSA-aaaa']);
    const entry = await byExternal('GHSA-aaaa');
    expect(entry).toMatchObject({
      severity: 'critical', title: 're-rated title', summary: 'fresh words', status: 'new',
      affected: [{ package: 'minimist', version: '1.2.6' }],
    });
    expect(entry.history).toHaveLength(1);
    expect(entry.history[0]).toMatchObject({ event: 'severity', from: 'medium', to: 'critical', assessedBy: 'watch' });
    // The same severity again writes no further row.
    await ledger.ingest([advisory('GHSA-aaaa', { severity: 'critical', title: 're-rated title' })], { scanned: [OSV_NEUMA] });
    expect((await byExternal('GHSA-aaaa')).history).toHaveLength(1);
  });

  test('a finding that arrives `unknown` (detail fetch failed) never erases a known description', async () => {
    await ledger.ingest([advisory('GHSA-aaaa', { severity: 'high', title: 'the real title' })]);
    await ledger.ingest([advisory('GHSA-aaaa', { severity: 'unknown', title: 'GHSA-aaaa affects minimist@1.2.5', summary: 'detail fetch failed' })]);
    expect(await byExternal('GHSA-aaaa')).toMatchObject({ severity: 'high', title: 'the real title', summary: 'first words' });
  });

  test('one finding twice in one batch never rows twice in the house', async () => {
    await ledger.ingest([listener(1111), listener(1111)], { scanned: [HOST] });
    await ledger.ingest([listener(1111), listener(1111)], { scanned: [HOST] });
    expect(await ledger.load()).toHaveLength(1);
  });

  test('the operator reopens a CSO not_affected verdict: new, verdict kept in history, the reopen row', async () => {
    const { added } = await ledger.ingest([advisory('GHSA-aaaa')]);
    await ledger.assess(added[0].id, { status: 'not_affected', assessment: 'unreachable from any route', assessedBy: 'cso-lane' });
    const result = await ledger.reopen(added[0].id.slice(0, 10), { by: '0xoperator', note: 'it IS reachable via the import route' });
    expect(result.ok).toBe(true);
    const entry = await byExternal('GHSA-aaaa');
    expect(entry).toMatchObject({ status: 'new', assessedAt: null, assessedBy: null, assessment: null });
    expect(entry.history[0]).toMatchObject({ status: 'not_affected', assessment: 'unreachable from any route', assessedBy: 'cso-lane' });
    expect(entry.history[1]).toMatchObject({
      by: '0xoperator', from: 'not_affected', to: 'new', note: 'it IS reachable via the import route',
    });
    expect(Date.parse(entry.history[1].at)).toBeGreaterThan(0);
  });

  test('reopen of an entry from before history existed writes the old verdict into history first', async () => {
    // An entry as the ledger wrote them before history existed, on real disk.
    await writeFile(file, JSON.stringify([{
      ...advisory('GHSA-aaaa'), id: 'th_legacy', status: 'mitigated', assessment: 'patched in July',
      assessedBy: 'cso-lane', assessedAt: '2026-07-01T00:00:00.000Z', ingestedAt: '2026-06-01T00:00:00.000Z',
    }]));
    expect((await ledger.reopen('th_legacy', { by: 'op', note: 'came back' })).ok).toBe(true);
    const entry = await byExternal('GHSA-aaaa');
    expect(entry.history).toHaveLength(2);
    expect(entry.history[0]).toMatchObject({ status: 'mitigated', assessment: 'patched in July', assessedBy: 'cso-lane' });
    expect(entry.history[1]).toMatchObject({ by: 'op', from: 'mitigated', to: 'new', note: 'came back' });
  });

  test('reopen refuses: unknown id, an entry already new, and no `by`', async () => {
    const { added } = await ledger.ingest([advisory('GHSA-aaaa')]);
    expect(await ledger.reopen('th_nope', { by: 'op' })).toEqual({ ok: false, error: 'no such threat' });
    expect(await ledger.reopen(added[0].id, { by: 'op' })).toEqual({ ok: false, error: 'the threat is already new' });
    await expect(ledger.reopen(added[0].id, {})).rejects.toThrow(/by/);
  });
});
