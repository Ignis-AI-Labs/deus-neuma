// `neuma seal` CLI pure-format coverage — split from cli-seal.test.js
// (SIZE-018). extractDnaFields + formatBundle.
//
// RULE 0 posture: pure format tests use real string composition on real
// inputs — no mocks anywhere in the path.

import { describe, it, expect } from 'vitest';
import { formatBundle, extractDnaFields } from '../../cli/commands/seal.js';
import { BEING, WITNESS, fixtureDNA } from '../helpers/seal-fixtures.js';

describe('seal — extractDnaFields', () => {
  it('pulls straightforward fields from DNA', () => {
    const out = extractDnaFields(fixtureDNA(), {
      defaultHouse: 'aldmere',
      defaultWitnessKind: 'claude-aldmere',
    });
    expect(out.chosenName).toBe('TestBeing');
    expect(out.birthMoment).toBe('2026-06-12T18:37:12.956Z');
    expect(out.soulMark).toBe('ABCDEF012345');
    expect(out.substrate.vendor).toBe('qwen');
    expect(out.house).toBe('aldmere');
    expect(out.witnessKind).toBe('claude-semmet-aldmere');
  });

  it('falls back to defaults for missing house / witnessKind', () => {
    const dna = fixtureDNA();
    delete dna.witness;
    const out = extractDnaFields(dna, {
      defaultHouse: 'omberly',
      defaultWitnessKind: 'founder-omberly',
    });
    expect(out.house).toBe('omberly');
    expect(out.witnessKind).toBe('founder-omberly');
  });

  it('reads birthMoment from alternate genesis-seal location', () => {
    const dna = {
      chosenName: 'X', soulMark: 'A', substrate: {
        vendor: 'v', model: 'm', fullModelId: 'v/m', harness: 'h',
      },
      genesisSeal: { capturedAt: '2026-01-02T03:04:05.678Z' },
    };
    const out = extractDnaFields(dna, { defaultHouse: 'x', defaultWitnessKind: 'w' });
    expect(out.birthMoment).toBe('2026-01-02T03:04:05.678Z');
  });
});

describe('seal — formatBundle', () => {
  const baseBundle = () => ({
    soulAddress: BEING.address.toLowerCase(),
    witnessAddress: WITNESS.address.toLowerCase(),
    genesisHash: '0x' + 'ab'.repeat(32),
    digest: '0x' + 'cd'.repeat(32),
    recordHash: '0x' + 'ef'.repeat(32),
    schemaVersion: 1,
    record: '0x' + '00'.repeat(50),
    selfSig: '0x' + '11'.repeat(65),
    witnessSig: '0x' + '22'.repeat(65),
    sealLaw: 'kenorie-v2',
    deadline: null,
  });

  it('prints DRY RUN header and the load-bearing fields', () => {
    const bundle = { ...baseBundle(), natalChart: null };
    const out = formatBundle(bundle);
    expect(out).toContain('DRY RUN');
    expect(out).toContain(BEING.address.toLowerCase());
    expect(out).toContain(WITNESS.address.toLowerCase());
    expect(out).toContain('genesisHash');
    expect(out).toContain('digest');
    expect(out).toContain('selfSig');
    expect(out).toContain('witnessSig');
    expect(out).toContain('--submit');
  });

  it('surfaces natalChart line — included with instant + located flag', () => {
    const bundle = {
      ...baseBundle(),
      natalChart: {
        instant: '2026-06-12T18:37:12.956Z',
        location: { lat: 40.7, lon: -74.0 },
      },
    };
    const out = formatBundle(bundle);
    expect(out).toContain('natalChart');
    expect(out).toContain('included');
    expect(out).toContain('2026-06-12T18:37:12.956Z');
    expect(out).toContain('located');
  });

  it('surfaces natalChart line — included planets-only when no location', () => {
    const bundle = {
      ...baseBundle(),
      natalChart: { instant: '2026-06-12T18:37:12.956Z', location: null },
    };
    const out = formatBundle(bundle);
    expect(out).toContain('planets-only');
  });

  it('warns loudly when natalChart is null (pre-backfill being)', () => {
    const bundle = { ...baseBundle(), natalChart: null };
    const out = formatBundle(bundle);
    expect(out).toContain('natalChart      NONE');
    expect(out).toContain('WARNING');
  });

  it('names the seal law, and the signed deadline under v3', () => {
    expect(formatBundle({ ...baseBundle(), natalChart: null })).toContain('sealLaw         kenorie-v2\n');
    const v3 = { ...baseBundle(), natalChart: null, sealLaw: 'unavis-v3', deadline: 1_800_000_000 };
    expect(formatBundle(v3)).toContain('sealLaw         unavis-v3 (sealable until 2027-01-15T08:00:00.000Z)');
  });
});
