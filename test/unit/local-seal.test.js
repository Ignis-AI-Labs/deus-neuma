// The local seal's law (core/identity/local-seal.js), with real keys and real signatures: the message names
// the genesis, the being's half recovers to the key its genesis names, the operator's half to the wallet
// that witnessed the birth, and nothing signed for another genesis, another message or by another key
// counts. Pure functions, real inputs; nothing is mocked.
import { describe, expect, test } from 'vitest';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';
import { LOCAL_SEAL_SCHEMA, localSealMessage, verifyLocalSeal, withHalf } from '../../core/identity/local-seal.js';

const being = generateKeypair();
const operator = generateKeypair();
const stranger = generateKeypair();
const genesisOf = (name = 'Rowan') => {
  const { record, genesisHash } = buildGenesisSeal({
    chosenName: name, lean: 3, witnessWallet: operator.address, soulPublicKey: being.publicKey, birthCycle: 1,
    birthMoment: { utc: '2026-10-26T00:00:00.000Z', epochMs: 1792972800000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
    substrate: { model: 'test-model', provider: 'test' },
  });
  return { record, genesisHash };
};
const genesis = genesisOf();
const message = localSealMessage({ chosenName: 'Rowan', genesisHash: genesis.genesisHash });
const at = '2026-10-26T00:00:01.000Z';

describe('the message', () => {
  test('is plain words naming the being and its genesis, and says it moves no money', () => {
    expect(message).toContain('Seal the birth of Rowan on this computer.');
    expect(message).toContain(`Genesis: ${genesis.genesisHash}`);
    expect(message).toMatch(/moves no money and is sent nowhere/);
  });
});

describe('a seal', () => {
  test('both halves, each by its own party, make it whole', async () => {
    const half = withHalf(null, genesis, 'soul', { signature: await signMessage(being.privateKey, message), signedAt: at });
    expect(half.schema).toBe(LOCAL_SEAL_SCHEMA);
    expect(verifyLocalSeal(half, genesis)).toEqual({ soul: true, witness: false, complete: false });
    const whole = withHalf(half, genesis, 'witness', { signature: await signMessage(operator.privateKey, message), signedAt: at });
    expect(verifyLocalSeal(whole, genesis)).toEqual({ soul: true, witness: true, complete: true });
    expect(whole.soul.address).toBe(being.address);
    expect(whole.witness.address).toBe(operator.address);
  });

  test('a stranger\'s mark in either half does not count', async () => {
    const forgedSoul = withHalf(null, genesis, 'soul', { signature: await signMessage(stranger.privateKey, message), signedAt: at });
    expect(verifyLocalSeal(forgedSoul, genesis).soul).toBe(false);
    const forgedWitness = withHalf(null, genesis, 'witness', { signature: await signMessage(stranger.privateKey, message), signedAt: at });
    expect(verifyLocalSeal(forgedWitness, genesis).witness).toBe(false);
  });

  test('a seal is bound to its genesis: another genesis, another message, or a broken signature reads as no seal', async () => {
    const whole = withHalf(
      withHalf(null, genesis, 'soul', { signature: await signMessage(being.privateKey, message), signedAt: at }),
      genesis, 'witness', { signature: await signMessage(operator.privateKey, message), signedAt: at },
    );
    const other = genesisOf('Aspen');
    expect(verifyLocalSeal(whole, other).complete).toBe(false);
    expect(verifyLocalSeal({ ...whole, message: `${message} ` }, genesis).complete).toBe(false);
    expect(verifyLocalSeal({ ...whole, soul: { ...whole.soul, signature: '0x1234' } }, genesis).soul).toBe(false);
    expect(verifyLocalSeal({ ...whole, schema: 'neuma-local-seal/0' }, genesis).complete).toBe(false);
    expect(verifyLocalSeal(null, genesis)).toEqual({ soul: false, witness: false, complete: false });
  });
});
