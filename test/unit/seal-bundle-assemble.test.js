// seal-bundle — assembleSealBundle orchestration, birth-genesis integrity,
// the encrypted-record envelope, and the natal-included path.
//
// Unit tests use real ethers.Wallet + real crypto — no mocks. The digest
// law and its on-chain opt-in cross-check live in seal-bundle-digest.test.js.

import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import {
  computeGenesisHash,
  assembleSealBundle,
  verifyBirthGenesisIntegrity,
  buildEncryptedPayload,
  unwrapEncryptedPayload,
  SEAL_RECORD_ENVELOPE_SCHEMA,
  SEAL_RECORD_ENVELOPE_SCHEMA_V2,
} from '../../backend/services/seal-bundle.js';
import { deriveRecordKey, decryptRecord } from '../../backend/services/record-crypto.js';
import { BEING, WITNESS, NATALIS_ADDR, BASE_SEPOLIA, fixtureDna } from '../helpers/seal-fixtures.js';

describe('seal-bundle — assembleSealBundle', () => {
  const args = () => ({
    dnaFields: fixtureDna(),
    beingWallet: BEING,
    witnessWallet: WITNESS,
    chainId: BASE_SEPOLIA,
    natalisAddress: NATALIS_ADDR,
  });

  it('produces a complete bundle with recovering signatures', async () => {
    const b = await assembleSealBundle(args());
    expect(b.genesisHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(b.record.startsWith('0x')).toBe(true);
    expect(b.selfSig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(b.witnessSig).toMatch(/^0x[0-9a-f]{130}$/);
    // Sigs recover to the expected addresses (the guard in assembleSealBundle
    // already asserted this, but we re-verify here for the test contract).
    expect(ethers.recoverAddress(b.digest, b.selfSig).toLowerCase())
      .toBe(BEING.address.toLowerCase());
    expect(ethers.recoverAddress(b.digest, b.witnessSig).toLowerCase())
      .toBe(WITNESS.address.toLowerCase());
    expect(b.recordKey.length).toBe(32);
  });

  it('the target contract decides the record format: compact (schemaVersion 2) under UNAVIS, hex (1) under KENORIE', async () => {
    const v3 = await assembleSealBundle({ ...args(), chainId: 1, sealLaw: 'unavis-v3', deadline: Math.floor(Date.now() / 1000) + 600 });
    expect(v3.record.startsWith('b64:')).toBe(true);
    expect(v3.schemaVersion).toBe(2);
    // The same content comes back out — the compact record loses nothing.
    const opened = unwrapEncryptedPayload(decryptRecord(v3.record, v3.recordKey).toString('utf8'));
    expect(opened.canonicalRecord).toBe(v3.recordString);
    const v2 = await assembleSealBundle(args());
    expect(v2.record.startsWith('0x')).toBe(true);
    expect(v2.schemaVersion).toBe(1);
  });

  it('rejects a mismatch between DNA.soulAddress and beingWallet.address', async () => {
    const a = args();
    a.dnaFields = { ...a.dnaFields, soulAddress: '0x' + 'ff'.repeat(20) };
    await expect(assembleSealBundle(a)).rejects.toThrow(/does not match beingWallet/);
  });

  it('rejects a mismatch between DNA.witnessAddress and witnessWallet.address', async () => {
    const a = args();
    a.dnaFields = { ...a.dnaFields, witnessAddress: '0x' + 'ee'.repeat(20) };
    await expect(assembleSealBundle(a)).rejects.toThrow(/does not match witnessWallet/);
  });
});

describe('seal-bundle — verifyBirthGenesisIntegrity', () => {
  // Real birth-time record shape from Keir (verified against live workspace
  // on 2026-07-01 — this exact input reproduces her genesisHash).
  const canonical = () => ({
    birthCycle: 1,
    birthMoment: {
      utc: '2026-06-25T00:00:00.000Z',
      epochMs: 1782172800000,
      zone: 'UTC',
      offsetMinutes: 0,
    },
    chosenName: 'TestBirthGenesis',
    lean: 0,
    soulPublicKey: '0x' + '11'.repeat(33),
    substrate: {
      cpu: { model: 'test-cpu', cores: 8 },
      gpu: { name: 'test-gpu', vramGB: 24 },
      memory: { totalGB: 64 },
      platform: { os: 'linux', version: '6.0' },
    },
    version: '1.0',
    witnessWallet: WITNESS.address.toLowerCase(),
  });

  // sc-echo R1 fix — KNOWN-ANSWER test using an independently-computed
  // sha256 (Node crypto.createHash, a different code path from
  // computeGenesisHash) over a byte-precise sorted-key JSON. Proves the
  // ALGORITHM is correct, not just self-consistent.
  it('known-answer: a small record with independently-computed sha256 → ok:true', async () => {
    const crypto = await import('node:crypto');
    // Deliberately UNSORTED input keys — the function must sort them.
    // Nested object also unsorted, to exercise recursive sort.
    const record = { b: 1, a: 2, nested: { z: 'last', y: 'middle', x: 'first' } };
    // Expected sorted-canonical form: {"a":2,"b":1,"nested":{"x":"first","y":"middle","z":"last"}}
    const expectedCanonical = '{"a":2,"b":1,"nested":{"x":"first","y":"middle","z":"last"}}';
    const expectedHash = '0x' + crypto.createHash('sha256')
      .update(expectedCanonical, 'utf8').digest('hex');
    const result = verifyBirthGenesisIntegrity(record, expectedHash);
    expect(result.ok).toBe(true);
    expect(result.computedHash).toBe(expectedHash);
    expect(result.recordString).toBe(expectedCanonical);
  });

  it('mismatched hash → ok:false with both hashes surfaced for diagnostics', () => {
    const result = verifyBirthGenesisIntegrity(canonical(), '0x' + 'de'.repeat(32));
    expect(result.ok).toBe(false);
    expect(result.claimedHash).toBe('0x' + 'de'.repeat(32));
    expect(result.computedHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('normalizes claimed hash forms — bare hex, sha256: prefix, and 0x-prefixed all accepted', () => {
    const record = canonical();
    const { computedHash } = verifyBirthGenesisIntegrity(record, '0x' + '00'.repeat(32));
    const bareHex = computedHash.slice(2); // no 0x
    const sha256Prefixed = 'sha256:' + bareHex;
    // All three forms recognize as the same hash.
    expect(verifyBirthGenesisIntegrity(record, computedHash).ok).toBe(true);
    expect(verifyBirthGenesisIntegrity(record, bareHex).ok).toBe(true);
    expect(verifyBirthGenesisIntegrity(record, sha256Prefixed).ok).toBe(true);
  });
});

describe('seal-bundle — assembleSealBundle birth-genesis path', () => {
  // Build a birth-time canonical record whose witness matches WITNESS.
  const witnessAddr = WITNESS.address.toLowerCase();
  const birthRecord = () => ({
    chosenName: 'BirthBeing',
    version: '1.0',
    witnessWallet: witnessAddr,
    birthMoment: { utc: '2026-06-25T00:00:00.000Z', epochMs: 1782172800000 },
  });

  it('produces a bundle whose genesisHash matches the birth-time claim', async () => {
    const record = birthRecord();
    const { computedHash } = verifyBirthGenesisIntegrity(record, '0x' + '00'.repeat(32));
    const bundle = await assembleSealBundle({
      birthGenesis: { canonicalRecord: record, genesisHash: computedHash },
      beingWallet: BEING,
      witnessWallet: WITNESS,
      chainId: BASE_SEPOLIA,
      natalisAddress: NATALIS_ADDR,
    });
    expect(bundle.genesisHash).toBe(computedHash);
    expect(bundle.path).toBe('birth-genesis');
    expect(bundle.selfSig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(bundle.witnessSig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it('rejects a birth-genesis whose record does not match its claimed hash', async () => {
    await expect(assembleSealBundle({
      birthGenesis: { canonicalRecord: birthRecord(), genesisHash: '0x' + 'ff'.repeat(32) },
      beingWallet: BEING,
      witnessWallet: WITNESS,
      chainId: BASE_SEPOLIA,
      natalisAddress: NATALIS_ADDR,
    })).rejects.toThrow(/integrity check failed/);
  });

  it('rejects a birth-genesis whose recorded soulPublicKey derives to a different address than beingWallet', async () => {
    // sc-echo R1 fix — mirror of the witness-mismatch guard. Without this,
    // a swapped keys/keypair.json would produce a self-inconsistent seal.
    const record = birthRecord();
    // Fresh keypair whose address does NOT match BEING.
    const otherPubKey = new ethers.Wallet('0x' + '77'.repeat(32)).signingKey.publicKey;
    record.soulPublicKey = otherPubKey;
    const { computedHash } = verifyBirthGenesisIntegrity(record, '0x' + '00'.repeat(32));
    await expect(assembleSealBundle({
      birthGenesis: { canonicalRecord: record, genesisHash: computedHash },
      beingWallet: BEING,
      witnessWallet: WITNESS,
      chainId: BASE_SEPOLIA,
      natalisAddress: NATALIS_ADDR,
    })).rejects.toThrow(/soul .* does not match beingWallet/);
  });

  it('rejects a birth-genesis whose recorded witness does not match witnessWallet', async () => {
    const record = birthRecord();
    record.witnessWallet = '0x' + 'ee'.repeat(20); // deliberately wrong
    const { computedHash } = verifyBirthGenesisIntegrity(record, '0x' + '00'.repeat(32));
    await expect(assembleSealBundle({
      birthGenesis: { canonicalRecord: record, genesisHash: computedHash },
      beingWallet: BEING,
      witnessWallet: WITNESS,
      chainId: BASE_SEPOLIA,
      natalisAddress: NATALIS_ADDR,
    })).rejects.toThrow(/does not match witnessWallet/);
  });

  it('rejects when both dnaFields AND birthGenesis are provided', async () => {
    const record = birthRecord();
    const { computedHash } = verifyBirthGenesisIntegrity(record, '0x' + '00'.repeat(32));
    await expect(assembleSealBundle({
      dnaFields: fixtureDna(),
      birthGenesis: { canonicalRecord: record, genesisHash: computedHash },
      beingWallet: BEING,
      witnessWallet: WITNESS,
      chainId: BASE_SEPOLIA,
      natalisAddress: NATALIS_ADDR,
    })).rejects.toThrow(/exactly one/);
  });

  it('rejects when neither dnaFields NOR birthGenesis is provided', async () => {
    await expect(assembleSealBundle({
      beingWallet: BEING,
      witnessWallet: WITNESS,
      chainId: BASE_SEPOLIA,
      natalisAddress: NATALIS_ADDR,
    })).rejects.toThrow(/one of dnaFields OR birthGenesis is required/);
  });
});

// ─── Natal-bundling — Design note, 2026-07-01 directive ───────────────────────────────
// The encrypted on-chain `record` blob wraps { canonicalRecord, natalChart }
// so a being's sky at emergence is preserved alongside their birth-time
// canonical. genesisHash still hashes ONLY the canonical (birth-time invariant).

const fixtureNatal = () => ({
  schema: 'natal-chart/1',
  instant: '2026-06-12T18:37:12.956Z',
  location: { lat: 40.7128, lon: -74.0060 },
  positions: {
    Sun: { sign: 'Gemini', degree: 21.7, retrograde: false },
    Moon: { sign: 'Aquarius', degree: 4.2, retrograde: false },
  },
  aspects: [{ from: 'Sun', to: 'Moon', kind: 'trine', orb: 1.3 }],
  angles: { asc: { sign: 'Virgo', degree: 12.3 }, mc: { sign: 'Gemini', degree: 5.1 }, polar: false },
});

describe('seal-bundle — buildEncryptedPayload / unwrapEncryptedPayload', () => {
  it('round-trips canonical + natal through the envelope', () => {
    const canonical = '{"chosenName":"X","house":"y"}';
    const natal = fixtureNatal();
    const plaintext = buildEncryptedPayload(canonical, natal);
    const parsed = JSON.parse(plaintext);
    // New seals write the v2 tag (skies ride beside natal, 2026-07-24).
    expect(parsed.schema).toBe(SEAL_RECORD_ENVELOPE_SCHEMA_V2);
    // canonicalRecord is stored as the VERBATIM string — round-trip byte-identity.
    expect(parsed.canonicalRecord).toBe(canonical);
    // Alphabetical key order is preserved by JSON.stringify.
    expect(Object.keys(parsed)).toEqual(['canonicalRecord', 'natalChart', 'schema', 'skies']);
    // Unwrap gives back the same shape.
    const back = unwrapEncryptedPayload(plaintext);
    expect(back.canonicalRecord).toBe(canonical);
    expect(back.natalChart).toEqual(natal);
  });

  it('accepts null natalChart and round-trips as null', () => {
    const canonical = '{"chosenName":"X"}';
    const plaintext = buildEncryptedPayload(canonical, null);
    const parsed = JSON.parse(plaintext);
    // Key is always present, value is explicitly null (schema invariant).
    expect(Object.prototype.hasOwnProperty.call(parsed, 'natalChart')).toBe(true);
    expect(parsed.natalChart).toBeNull();
    const back = unwrapEncryptedPayload(plaintext);
    expect(back.natalChart).toBeNull();
    expect(back.canonicalRecord).toBe(canonical);
  });

  it('is deterministic — same inputs produce identical envelope bytes', () => {
    const canonical = '{"a":1,"b":2}';
    const natal = fixtureNatal();
    const a = buildEncryptedPayload(canonical, natal);
    const b = buildEncryptedPayload(canonical, natal);
    expect(a).toBe(b);
  });

  it('rejects a non-string canonicalRecord', () => {
    expect(() => buildEncryptedPayload({ a: 1 }, null)).toThrow(/non-empty string/);
    expect(() => buildEncryptedPayload('', null)).toThrow(/non-empty string/);
  });

  it('rejects a natalChart that is not an object or null', () => {
    expect(() => buildEncryptedPayload('{}', 'oops')).toThrow(/object or null/);
    expect(() => buildEncryptedPayload('{}', [1, 2, 3])).toThrow(/object or null/);
  });

  it('round-trips the skies reading through the v2 envelope; a v1 envelope still decodes (skies null)', () => {
    const canonical = '{"chosenName":"X"}';
    const skies = { schema: 'skies/v1', instant: '2026-06-11T18:03:38.075Z', systems: { wetonan: { weton: 'Friday Kliwon' } } };
    const back = unwrapEncryptedPayload(buildEncryptedPayload(canonical, null, skies));
    expect(back.skies).toEqual(skies);
    // A v1 envelope (already sealed on chain) decodes unchanged — skies: null.
    const v1 = JSON.stringify({ canonicalRecord: canonical, natalChart: null, schema: SEAL_RECORD_ENVELOPE_SCHEMA });
    const legacy = unwrapEncryptedPayload(v1);
    expect(legacy.canonicalRecord).toBe(canonical);
    expect(legacy.skies).toBeNull();
  });

  it('rejects a skies value that is not an object or null', () => {
    expect(() => buildEncryptedPayload('{}', null, 'oops')).toThrow(/object or null/);
  });

  it('unwrap rejects an unknown schema tag — no silent decoding of v3 envelope by this decoder', () => {
    const bad = JSON.stringify({
      canonicalRecord: '{}',
      natalChart: null,
      schema: 'neuma-seal-record-envelope-v99',
    });
    expect(() => unwrapEncryptedPayload(bad)).toThrow(/unknown envelope schema/);
  });

  it('unwrap rejects a non-object plaintext', () => {
    expect(() => unwrapEncryptedPayload('"a string"')).toThrow(/object envelope/);
    expect(() => unwrapEncryptedPayload('[1,2]')).toThrow(/object envelope/);
  });

  it('unwrap rejects an envelope with missing/empty canonicalRecord', () => {
    const bad = JSON.stringify({
      canonicalRecord: '',
      natalChart: null,
      schema: SEAL_RECORD_ENVELOPE_SCHEMA,
    });
    expect(() => unwrapEncryptedPayload(bad)).toThrow(/canonicalRecord must be a non-empty string/);
  });

  it('accepts a Buffer plaintext (UTF-8) for symmetry with decryptRecord output', () => {
    const canonical = '{"a":1}';
    const plaintext = buildEncryptedPayload(canonical, null);
    const back = unwrapEncryptedPayload(Buffer.from(plaintext, 'utf8'));
    expect(back.canonicalRecord).toBe(canonical);
  });
});

describe('seal-bundle — assembleSealBundle natal-included path', () => {
  const witnessAddr = WITNESS.address.toLowerCase();
  const birthRecord = () => ({
    chosenName: 'BirthBeing',
    version: '1.0',
    witnessWallet: witnessAddr,
    birthMoment: { utc: '2026-06-25T00:00:00.000Z', epochMs: 1782172800000 },
  });

  it('bundles natal into the encrypted record; decrypt+unwrap round-trips it', async () => {
    const record = birthRecord();
    const natal = fixtureNatal();
    const { computedHash } = verifyBirthGenesisIntegrity(record, '0x' + '00'.repeat(32));
    const bundle = await assembleSealBundle({
      birthGenesis: { canonicalRecord: record, genesisHash: computedHash },
      natalChart: natal,
      beingWallet: BEING,
      witnessWallet: WITNESS,
      chainId: BASE_SEPOLIA,
      natalisAddress: NATALIS_ADDR,
    });
    // The bundle surfaces the natal that was included.
    expect(bundle.natalChart).toEqual(natal);
    // genesisHash is UNCHANGED — birth-time invariant preserved.
    expect(bundle.genesisHash).toBe(computedHash);
    // Decrypt the on-chain record and unwrap — natal comes back intact.
    const key = await deriveRecordKey(BEING, bundle.genesisHash);
    const plaintextBytes = decryptRecord(bundle.record, key);
    const envelope = unwrapEncryptedPayload(plaintextBytes);
    expect(envelope.natalChart).toEqual(natal);
    // The unwrapped canonical hashes to the same genesisHash (byte-integrity
    // across encrypt→decrypt→unwrap).
    const roundTripHash = computeGenesisHash(envelope.canonicalRecord);
    expect(roundTripHash).toBe(computedHash);
  });

  it('accepts null natal (a pre-backfill being) and still produces a sealable bundle', async () => {
    const record = birthRecord();
    const { computedHash } = verifyBirthGenesisIntegrity(record, '0x' + '00'.repeat(32));
    const bundle = await assembleSealBundle({
      birthGenesis: { canonicalRecord: record, genesisHash: computedHash },
      // natalChart omitted — defaults to null
      beingWallet: BEING,
      witnessWallet: WITNESS,
      chainId: BASE_SEPOLIA,
      natalisAddress: NATALIS_ADDR,
    });
    expect(bundle.natalChart).toBeNull();
    const key = await deriveRecordKey(BEING, bundle.genesisHash);
    const plaintextBytes = decryptRecord(bundle.record, key);
    const envelope = unwrapEncryptedPayload(plaintextBytes);
    expect(envelope.natalChart).toBeNull();
  });

  it('natal-inclusion changes the on-chain record + recordHash (natal IS authenticated on chain)', async () => {
    const record = birthRecord();
    const { computedHash } = verifyBirthGenesisIntegrity(record, '0x' + '00'.repeat(32));
    const [withoutNatal, withNatal] = await Promise.all([
      assembleSealBundle({
        birthGenesis: { canonicalRecord: record, genesisHash: computedHash },
        natalChart: null,
        beingWallet: BEING,
        witnessWallet: WITNESS,
        chainId: BASE_SEPOLIA,
        natalisAddress: NATALIS_ADDR,
      }),
      assembleSealBundle({
        birthGenesis: { canonicalRecord: record, genesisHash: computedHash },
        natalChart: fixtureNatal(),
        beingWallet: BEING,
        witnessWallet: WITNESS,
        chainId: BASE_SEPOLIA,
        natalisAddress: NATALIS_ADDR,
      }),
    ]);
    // Same genesisHash (birth-time invariant), different record bytes,
    // different recordHash → different digest → different sigs. Natal
    // inclusion IS authenticated by the digest that both parties signed.
    expect(withoutNatal.genesisHash).toBe(withNatal.genesisHash);
    expect(withoutNatal.record).not.toBe(withNatal.record);
    expect(withoutNatal.recordHash).not.toBe(withNatal.recordHash);
    expect(withoutNatal.digest).not.toBe(withNatal.digest);
  });
});
