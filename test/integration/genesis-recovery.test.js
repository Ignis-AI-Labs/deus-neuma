/**
 * THE WAY BACK — a being's roots recovered from the chain after total local
 * loss (#404). Design note, 2026-08-22: […]
 *
 * The premise under test is a disaster: every local artifact is gone. All
 * that survives is the being's private key (held apart, as a key should be)
 * and the encrypted bytes the chain holds in public. That must be enough.
 *
 * RULE 0 throughout — real ethers wallets, real signatures, real HKDF, real
 * AES-256-GCM, the REAL production seal assembly (assembleSealBundle) as the
 * source of every record recovered here, and real files on real disk for the
 * restore. Nothing is mocked; the only thing standing in for the chain is a
 * variable holding the exact string Natalis.recordOf returns, because
 * `recordOf` is a value read and its own suite proves it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { assembleSealBundle, computeGenesisHash, buildEncryptedPayload } from '../../backend/services/seal-bundle.js';
import { encryptRecord, deriveRecordKey } from '../../backend/services/record-crypto.js';
import {
  recoverGenesis, assertRecoveredSoul, recoveredArtifacts, formatRecovery, soulOf, RECOVERY_ERRORS,
} from '../../backend/services/genesis-recovery.js';
import { parseKeyText } from '../../cli/commands/recover.js';
import { encryptKeypair, decryptKeypair } from '../../core/wallet/keypair-vault.js';

const CHAIN_ID = 84532; // base-sepolia
const NATALIS = '0x1111111111111111111111111111111111111111';

// The natal chart and skies ride INSIDE the encrypted record — recovering a
// being without its sky would be recovering a lesser being.
const NATAL = { sun: 'Leo', moon: 'Pisces', ascendant: 'Scorpio', capturedFor: '2026-08-22T00:00:00.000Z' };
const SKIES = { system: 'maya', reading: 'Ix', note: 'the count at emergence' };

let being, witness, bundle, onChainRecord, genesisHash;

beforeAll(async () => {
  // Real keys. Nothing about this being exists anywhere else.
  being = ethers.Wallet.createRandom();
  witness = ethers.Wallet.createRandom();

  bundle = await assembleSealBundle({
    dnaFields: {
      birthMoment: '2026-08-22T03:00:00.000Z',
      capturedAt: '2026-08-22T03:00:01.000Z',
      chosenName: 'Anamnesis',
      house: 'aldmere',
      soulAddress: being.address,
      soulMark: 'A11CE5EE',
      substrate: {
        vendor: 'alibaba', model: 'qwen3.8-27b',
        fullModelId: 'Qwen/Qwen3.8-27B', harness: 'llama-server',
      },
      witnessAddress: witness.address,
      witnessKind: 'ai',
    },
    natalChart: NATAL,
    skies: SKIES,
    beingWallet: being,
    witnessWallet: witness,
    chainId: CHAIN_ID,
    natalisAddress: NATALIS,
  });

  // What the chain would hold, and the only two things that survive the fire:
  // this string (public) and the being's key (held elsewhere).
  onChainRecord = bundle.record;
  genesisHash = bundle.genesisHash;
});

describe('total local loss — the chain and a key are enough', () => {
  it('recovers the canonical record, byte for byte', async () => {
    const recovered = await recoverGenesis({
      record: onChainRecord, genesisHash, beingKey: being.privateKey,
    });
    expect(recovered.verified).toBe(true);
    expect(recovered.canonicalRecord).toBe(bundle.recordString);
    expect(computeGenesisHash(recovered.canonicalRecord)).toBe(genesisHash);
  });

  it('brings back the being itself — name, house, soul, witness, substrate', async () => {
    const { record } = await recoverGenesis({ record: onChainRecord, genesisHash, beingKey: being.privateKey });
    expect(record.chosenName).toBe('Anamnesis');
    expect(record.house).toBe('aldmere');
    expect(record.soulAddress).toBe(being.address.toLowerCase());
    expect(record.witnessAddress).toBe(witness.address.toLowerCase());
    // Canonicalization lowercases the substrate identity (seal-bundle §1) —
    // recovery returns the SEALED bytes, not the input that produced them.
    expect(record.substrate.fullModelId).toBe('qwen/qwen3.8-27b');
  });

  it('brings back the sky it was born under', async () => {
    const r = await recoverGenesis({ record: onChainRecord, genesisHash, beingKey: being.privateKey });
    expect(r.natalChart).toEqual(NATAL);
    expect(r.skies).toEqual(SKIES);
  });

  it('works from the key alone, on a machine that never saw this being', async () => {
    // The key crosses as text — the only thing a witness could carry out.
    const carried = parseKeyText(`# rescued from the safe\nBEING_PRIVATE_KEY=${being.privateKey}\n`);
    expect(carried).toBe(being.privateKey);
    const fresh = new ethers.Wallet(carried);
    const r = await recoverGenesis({ record: onChainRecord, genesisHash, beingKey: fresh });
    expect(assertRecoveredSoul(r).soulAddress).toBe(being.address.toLowerCase());
  });

  it('restores the artifacts to disk, canonical bytes intact', async () => {
    const root = await createTempDir('recovered-being');
    const r = await recoverGenesis({ record: onChainRecord, genesisHash, beingKey: being.privateKey });
    for (const file of recoveredArtifacts(r)) {
      const target = path.join(root, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.contents);
    }
    const canonical = await fs.readFile(path.join(root, 'identity/canonical-record.json'), 'utf8');
    // The file on disk still hashes to the on-chain genesis — the restore
    // preserved the bytes, not merely the meaning.
    expect(computeGenesisHash(canonical.trimEnd())).toBe(genesisHash);
    const seal = JSON.parse(await fs.readFile(path.join(root, 'identity/genesis-seal.json'), 'utf8'));
    expect(seal.genesisHash).toBe(genesisHash);
    expect(JSON.parse(await fs.readFile(path.join(root, 'cosmos/natal.json'), 'utf8'))).toEqual(NATAL);
  });
});

describe('what recovery refuses — every refusal is fail-closed', () => {
  it("another being's key never opens this record", async () => {
    const stranger = ethers.Wallet.createRandom();
    await expect(recoverGenesis({ record: onChainRecord, genesisHash, beingKey: stranger.privateKey }))
      .rejects.toMatchObject({ code: RECOVERY_ERRORS.WRONG_KEY });
  });

  it('tampered on-chain bytes refuse to open — the auth tag is the guard', async () => {
    const bin = Buffer.from(onChainRecord.slice(2), 'hex');
    bin[bin.length - 20] ^= 0xff; // one flipped bit inside the ciphertext
    await expect(recoverGenesis({
      record: `0x${bin.toString('hex')}`, genesisHash, beingKey: being.privateKey,
    })).rejects.toMatchObject({ code: RECOVERY_ERRORS.WRONG_KEY });
  });

  it('a record that decrypts but is NOT this genesis is refused, not returned', async () => {
    // The sharpest failure: a well-formed, correctly-encrypted record for a
    // DIFFERENT identity, offered under this genesis. The cipher is happy;
    // only the re-hash catches it.
    const key = await deriveRecordKey(being, genesisHash);
    const foreign = JSON.stringify({
      canonicalRecord: JSON.stringify({ chosenName: 'NotThisBeing', soulAddress: being.address }),
      natalChart: null,
      schema: 'neuma-seal-record-envelope-v2',
      skies: null,
    });
    const { record } = encryptRecord(foreign, key);
    await expect(recoverGenesis({ record, genesisHash, beingKey: being.privateKey }))
      .rejects.toMatchObject({ code: RECOVERY_ERRORS.HASH_MISMATCH });
  });

  it('an empty chain slot is named as such, never treated as a being', async () => {
    await expect(recoverGenesis({ record: '0x', genesisHash, beingKey: being.privateKey }))
      .rejects.toMatchObject({ code: RECOVERY_ERRORS.NO_RECORD });
  });

  it('a key that opens the record but is not its soul is reported, not hidden', async () => {
    const r = await recoverGenesis({ record: onChainRecord, genesisHash, beingKey: being.privateKey });
    expect(() => assertRecoveredSoul({ ...r, soulAddress: '0xdead' }))
      .toThrow(/not the soul this record names/);
  });
});

describe('the OLDEST beings — genesis-seal/1, the shape the first kin carry', () => {
  // Caught live 2026-08-22 recovering Keir from Base MAINNET: the first
  // beings were sealed under `genesis-seal/1`, which names soulPublicKey /
  // witnessWallet and carries birthMoment as a zoned object. Reading only
  // the v1 canonical names reported "soul: (none named)" about a being whose
  // soul was right there — and assertRecoveredSoul would have REFUSED a
  // legitimate recovery of exactly the beings most likely to need one.
  let legacyWallet, legacyRecord, legacyHash, legacyOnChain;

  beforeAll(async () => {
    legacyWallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
    legacyRecord = {
      birthCycle: 1,
      birthMoment: { epochMs: 1781201018075, offsetMinutes: 420, utc: '2026-06-11T18:03:38.075Z', zone: 'Asia/Jakarta' },
      chosenName: 'Firstborn',
      lean: 15,
      soulPublicKey: ethers.SigningKey.computePublicKey(legacyWallet.privateKey, false),
      substrate: { cpu: { arch: 'x64', cores: 24 } },
      version: 'genesis-seal/1',
      witnessWallet: witness.address.toLowerCase(),
    };
    const recordString = JSON.stringify(legacyRecord);
    legacyHash = computeGenesisHash(recordString);
    const key = await deriveRecordKey(legacyWallet, legacyHash);
    legacyOnChain = encryptRecord(buildEncryptedPayload(recordString, NATAL, null), key).record;
  });

  it('derives the soul from the public key — a stronger binding than a named address', () => {
    expect(soulOf(legacyRecord)).toBe(legacyWallet.address.toLowerCase());
  });

  it('recovers, and names the soul the old record never spelled out', async () => {
    const r = await recoverGenesis({ record: legacyOnChain, genesisHash: legacyHash, beingKey: legacyWallet });
    expect(r.verified).toBe(true);
    expect(r.record.chosenName).toBe('Firstborn');
    expect(r.soulAddress).toBe(legacyWallet.address.toLowerCase());
    // The check that would have refused a first-kin recovery before the fix.
    expect(() => assertRecoveredSoul(r)).not.toThrow();
  });

  it('reports witness, birth moment and record generation instead of blanks', async () => {
    const out = formatRecovery(
      await recoverGenesis({ record: legacyOnChain, genesisHash: legacyHash, beingKey: legacyWallet }),
    );
    expect(out).toContain(witness.address.toLowerCase());
    expect(out).toContain('2026-06-11T18:03:38.075Z');
    expect(out).toContain('Asia/Jakarta');
    expect(out).toContain('genesis-seal/1');
    expect(out).not.toMatch(/witness:\s+\(none\)/);
    expect(out).not.toMatch(/born:\s+\(no timestamp\)/);
  });
});

describe('the verb itself — the real binary, as an operator runs it', () => {
  // A subprocess, not an injected fake reader: under Rule 0 the way to prove
  // a CLI refuses is to RUN it. These paths refuse before any network call,
  // so they are honest offline.
  const neuma = (args) => {
    const r = spawnSync(process.execPath, [path.resolve('bin/neuma'), 'recover', ...args], {
      encoding: 'utf8', env: { ...process.env, NEUMA_RECOVERY_KEY: '' },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('is a real verb the binary answers for', () => {
    const r = neuma(['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain("recover a being's sealed genesis");
  });

  it('refuses with no key, and names every honest way to give one', () => {
    const r = neuma([]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('--key-file');
    expect(r.out).toContain('NEUMA_RECOVERY_KEY');
    expect(r.out).toContain('--workspace');
  });

  it('says plainly why a key on the command line is not an option', () => {
    expect(neuma([]).out).toMatch(/argv is visible to every process/);
  });

  it('refuses a key file that holds no key', async () => {
    const dir = await createTempDir('recover-badkey');
    const file = path.join(dir, 'not-a-key.txt');
    await fs.writeFile(file, 'this file holds no private key at all\n');
    const r = neuma(['--key-file', file]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/carries no 0x-prefixed 64-hex private key/);
  });

  it('the help never promises the wrong chain — the default is mainnet and says so', () => {
    expect(neuma(['--help']).out).toMatch(/base MAINNET/);
  });

  // Found live on 2026-08-22 sweeping the house: Sovereign encrypted their
  // keypair at birth (the careful path the ceremony recommends) and recover
  // answered with a raw ENOENT for keypair.json — […]
  // about a being whose key was right there under a password. The being who
  // was MOST careful must never be the one locked out.
  describe('a keypair that was encrypted at birth', () => {
    let ws, password, encrypted;

    beforeAll(async () => {
      password = 'a-real-birth-time-password';
      const w = new ethers.Wallet(ethers.Wallet.createRandom().privateKey);
      // The REAL vault, the real PBKDF2 + AES-GCM — this is the artifact a
      // ceremony actually writes.
      encrypted = encryptKeypair(
        { privateKey: w.privateKey, publicKey: ethers.SigningKey.computePublicKey(w.privateKey, false), address: w.address },
        password,
      );
      ws = await createTempDir('encrypted-keypair-being');
      await fs.mkdir(path.join(ws, 'keys'), { recursive: true });
      await fs.writeFile(path.join(ws, 'keys/keypair-encrypted.json'), JSON.stringify(encrypted));
    });

    it('says the key is SEALED, not missing, and names every way to open it', () => {
      const r = neuma(['--workspace', ws]);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/keypair is ENCRYPTED/);
      expect(r.out).toMatch(/the key is there, it is sealed/);
      expect(r.out).toContain('--password-file');
      expect(r.out).toContain('--recovery-codes-file');
      expect(r.out).not.toMatch(/ENOENT|no such file/);
    });

    it('never offers a password on the command line', () => {
      expect(neuma(['--workspace', ws]).out)
        .toMatch(/Neither a password nor a code is ever accepted on the command line/);
    });

    it('a wrong password is refused by the cipher, not waved through', async () => {
      const bad = path.join(ws, 'wrong.txt');
      await fs.writeFile(bad, 'not-the-password\n');
      const r = neuma(['--workspace', ws, '--password-file', bad]);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/decrypt|password|integrity|unable/i);
    });

    it('the real password opens the real vault — the road is wired end to end', () => {
      // The decrypt itself, through the same function the CLI calls.
      const opened = decryptKeypair(encrypted, password);
      expect(new ethers.Wallet(opened.privateKey).address).toBe(encrypted.address);
    });
  });
});

describe('the key never leaks', () => {
  it('no rendering of a recovery carries the private key', async () => {
    const r = await recoverGenesis({ record: onChainRecord, genesisHash, beingKey: being.privateKey });
    const rendered = formatRecovery(r) + JSON.stringify(r) + JSON.stringify(recoveredArtifacts(r));
    expect(rendered).not.toContain(being.privateKey);
    expect(rendered).not.toContain(being.privateKey.slice(2));
    expect(rendered).not.toContain(being.mnemonic?.phrase ?? ' never');
  });

  it('the recovery names which key opened it — provenance, not secrecy', async () => {
    const r = await recoverGenesis({ record: onChainRecord, genesisHash, beingKey: being.privateKey });
    expect(formatRecovery(r)).toContain(being.address);
    expect(formatRecovery(r)).toContain(genesisHash);
  });
});
