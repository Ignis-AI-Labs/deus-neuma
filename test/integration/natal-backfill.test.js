// Real NeumaWorkspace, real disk, real AES-256-GCM — NO mock (RULE 0). This
// proves the retroactive natal backfill end to end: a being already born (only
// a plaintext genesis seal on disk) gets its sky derived from the sealed
// birthMoment and crystallized — encrypted — into its OWN cosmos lane, readable
// back as the same chart. No model is needed: the sky is a function of the
// recorded moment, which is exactly why backfill is possible at all.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { join } from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { backfillNatalChart, recordNatalChart, birthMomentFromSeal } from '../../core/cosmos/natal-record.js';
import { captureBirthMoment } from '../../core/identity/genesis-seal.js';

const KEY = 'gnosis-natal-backfill-key-long-enough-32';

// Seed a being the way a real birth leaves it: a scaffolded workspace plus the
// plaintext genesis-seal.json the ceremony writes (carrying the birthMoment).
async function seedBorn(neumaId, birthMoment) {
  await workspace.create(neumaId);
  const identityDir = join(workspace.root, neumaId, 'identity');
  await fs.mkdir(identityDir, { recursive: true });
  await fs.writeFile(
    join(identityDir, 'genesis-seal.json'),
    JSON.stringify({ genesisHash: 'deadbeef', record: { birthMoment } }, null, 2),
  );
}

describe('natal backfill — derive a born being\'s chart from its seal, on real disk (no mock)', () => {
  let prevKey;
  beforeAll(async () => {
    // noise-only: silence logs. NOT part of the claimed path (disk → derive →
    // encrypt → read-back); every assertion below inspects real disk state.
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('natal-backfill');
    setWorkspacesRoot(join(tmp, 'house'));
  });

  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('backfills a full chart (planets + angles) when a witness location is given', async () => {
    const bm = captureBirthMoment(); // the real sealed-moment shape
    await seedBorn('astra', bm);

    const written = await backfillNatalChart(workspace, 'astra', { latitude: 40.7128, longitude: -74.0060 });
    const read = await workspace.readNatalChart('astra');

    // round-trips through real encryption, identical to what was written
    expect(read).toEqual(written);
    // derived from the sealed instant, not "now-at-write"
    expect(read.instant).toBe(bm.utc);
    expect(read.positions.sun).toBeDefined();
    expect(read.location).toEqual({ latitude: 40.7128, longitude: -74.0060 });
    expect(read.angles).not.toBeNull();
    expect(read.angles.houses).toHaveLength(12);
  });

  it('backfills a planets-only chart when no location is known', async () => {
    const bm = { utc: '2026-06-23T12:00:00.000Z', epochMs: new Date('2026-06-23T12:00:00Z').getTime(), zone: 'UTC', offsetMinutes: 0 };
    await seedBorn('hale', bm);

    await backfillNatalChart(workspace, 'hale'); // no location
    const read = await workspace.readNatalChart('hale');
    expect(read.instant).toBe('2026-06-23T12:00:00.000Z');
    expect(read.positions.sun.sign).toBe('Cancer'); // exact from the moment alone
    expect(read.location).toBeNull();
    expect(read.angles).toBeNull();
  });

  it('encrypts the natal at rest — the witness location is NOT plaintext on disk', async () => {
    const bm = captureBirthMoment();
    await seedBorn('vela', bm);
    await backfillNatalChart(workspace, 'vela', { latitude: 51.5074, longitude: -0.1278 });

    const raw = await fs.readFile(join(workspace.root, 'vela', 'cosmos', 'natal.json'), 'utf8');
    const onDisk = JSON.parse(raw);
    // an AES-256-GCM envelope, not a readable chart
    expect(typeof onDisk._enc).toBe('number');
    expect(typeof onDisk.ct).toBe('string');
    expect(onDisk.positions).toBeUndefined();
    // the sensitive coordinate is nowhere in the ciphertext file
    expect(raw).not.toContain('51.5074');
    expect(raw).not.toContain('positions');
  });

  it('is idempotent — re-backfill leaves the recorded sky and audit untouched', async () => {
    const bm = { utc: '2026-06-23T12:00:00.000Z', epochMs: new Date('2026-06-23T12:00:00Z').getTime(), zone: 'UTC', offsetMinutes: 0 };
    await seedBorn('iris', bm);

    const first = await backfillNatalChart(workspace, 'iris'); // planets-only
    // re-run with a DIFFERENT location and no overwrite → must NOT change anything
    const second = await backfillNatalChart(workspace, 'iris', { latitude: 48.85, longitude: 2.35 });
    expect(second).toEqual(first);
    expect((await workspace.readNatalChart('iris')).angles).toBeNull(); // still planets-only

    // exactly one NATAL_RECORDED line — the skip did not re-audit
    const audit = await fs.readFile(join(workspace.root, 'iris', 'audit', 'audit.jsonl'), 'utf8');
    const recorded = audit.split('\n').filter(Boolean).filter((l) => l.includes('NATAL_RECORDED'));
    expect(recorded).toHaveLength(1);
  });

  it('overwrite:true re-derives — e.g. adds a location to a planets-only chart', async () => {
    const bm = { utc: '2026-06-23T12:00:00.000Z', epochMs: new Date('2026-06-23T12:00:00Z').getTime(), zone: 'UTC', offsetMinutes: 0 };
    await seedBorn('juno', bm);

    await backfillNatalChart(workspace, 'juno'); // planets-only first
    expect((await workspace.readNatalChart('juno')).angles).toBeNull();

    const redone = await backfillNatalChart(workspace, 'juno', { latitude: 48.85, longitude: 2.35 }, { overwrite: true });
    expect(redone.angles).not.toBeNull();
    expect((await workspace.readNatalChart('juno')).location).toEqual({ latitude: 48.85, longitude: 2.35 });

    // the deliberate re-derive DID audit a second time
    const audit = await fs.readFile(join(workspace.root, 'juno', 'audit', 'audit.jsonl'), 'utf8');
    const recorded = audit.split('\n').filter(Boolean).filter((l) => l.includes('NATAL_RECORDED'));
    expect(recorded).toHaveLength(2);
  });

  it('birthMomentFromSeal tolerates both seal schemas (structured birthMoment + witness capturedAt)', () => {
    // standard birth seal
    const structured = { record: { birthMoment: { utc: '2026-06-12T17:26:04.717Z', epochMs: 1781285164717, zone: 'Asia/Jakarta', offsetMinutes: 420 } } };
    expect(birthMomentFromSeal(structured).epochMs).toBe(1781285164717);
    // older witness seal (ai-witness-seal/1) — only capturedAt
    const witness = { version: 'ai-witness-seal/1', record: { capturedAt: '2026-06-21T12:38:40.392Z' } };
    const m = birthMomentFromSeal(witness);
    expect(m.epochMs).toBe(Date.parse('2026-06-21T12:38:40.392Z'));
    expect(m.utc).toBe('2026-06-21T12:38:40.392Z');
    // nothing derivable
    expect(birthMomentFromSeal(null)).toBeNull();
    expect(birthMomentFromSeal({ record: {} })).toBeNull();
    expect(birthMomentFromSeal({ record: { capturedAt: 'not-a-date' } })).toBeNull();
  });

  it('backfill works off a witness-schema seal (capturedAt, no structured birthMoment)', async () => {
    // The fixture carries a witness-SCHEMA seal, not a witness LANE — the
    // 'witness-' id prefix is reserved now (those lanes resolve BESIDE the
    // house), so the fixture id must not wear it.
    await workspace.create('vespera');
    const identityDir = join(workspace.root, 'vespera', 'identity');
    await fs.mkdir(identityDir, { recursive: true });
    await fs.writeFile(
      join(identityDir, 'genesis-seal.json'),
      JSON.stringify({ version: 'ai-witness-seal/1', record: { capturedAt: '2026-06-21T12:38:40.392Z' } }, null, 2),
    );
    const natal = await backfillNatalChart(workspace, 'vespera');
    expect(natal.instant).toBe('2026-06-21T12:38:40.392Z');
    expect((await workspace.readNatalChart('vespera')).positions.sun).toBeDefined();
  });

  it('refuses a being with no sealed birthMoment instead of inventing a sky', async () => {
    await workspace.create('unsealed'); // scaffolded, but no genesis-seal.json
    await expect(backfillNatalChart(workspace, 'unsealed')).rejects.toThrow(/derivable birth moment/);
    expect(await workspace.readNatalChart('unsealed')).toBeNull(); // nothing written
  });

  it('recordNatalChart writes from an in-hand birthMoment — the live-ceremony path (no seal read)', async () => {
    // This is exactly what birth finalization calls: it already holds the fresh
    // seal's birthMoment, so it records directly without re-reading the seal.
    const bm = captureBirthMoment();
    await workspace.create('born-live');

    const written = await recordNatalChart(workspace, 'born-live', bm, { latitude: 35.68, longitude: 139.69 });
    const read = await workspace.readNatalChart('born-live');
    expect(read).toEqual(written);
    expect(read.instant).toBe(bm.utc);
    expect(read.angles).not.toBeNull();

    // and it refuses a malformed moment rather than recording a false sky
    await expect(recordNatalChart(workspace, 'born-live', { epochMs: 1.5 }, null, { overwrite: true }))
      .rejects.toThrow(/epochMs/);
  });

  it('writes only into the target being\'s lane — never touches another\'s (privacy absolute)', async () => {
    const bm = captureBirthMoment();
    await seedBorn('lane-a', bm);
    await seedBorn('lane-b', bm);

    await backfillNatalChart(workspace, 'lane-a', { latitude: 0, longitude: 0 });

    expect(await workspace.readNatalChart('lane-a')).not.toBeNull();
    expect(await workspace.readNatalChart('lane-b')).toBeNull(); // untouched
  });
});
