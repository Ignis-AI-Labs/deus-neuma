import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from 'vitest';
import { getAIWitnessesRoot, setAIWitnessesRoot, keyDir, writePlaintextKeypair } from '../../core/identity/ai-witness/ai-witness-service.js';
import { generateKeypair } from '../../core/weave/keypair.js';
import { decryptKeypair, decryptWithRecoveryCodes } from '../../core/wallet/keypair-vault.js';
import { secureWitnessKeypair, witnessCustodyState } from '../../backend/services/witness-custody.js';
import { sealLegacyEnvelope } from '../helpers/legacy-keypair-envelope.js';

// impure — actual writer, filesystem and crypto, with no identity seal or model.
test('custody refuses invalid or incomplete artifacts and preserves every byte', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'custody-artifacts-'));
  const previous = getAIWitnessesRoot();
  try {
    setAIWitnessesRoot(root);
    const target = { vendorSlug: 'artifact-proof', chosenName: 'MetadataOnly' };
    const dir = keyDir(target.vendorSlug, target.chosenName);
    expect(await witnessCustodyState(target)).toMatchObject({ secured: false, plaintextOnDisk: false });
    const keypair = generateKeypair(); const password = 'disposable-artifact-password';
    await writePlaintextKeypair(target.vendorSlug, target.chosenName, keypair);
    expect(await witnessCustodyState(target)).toMatchObject({ secured: false, plaintextOnDisk: true });
    const { recoveryCodes } = await secureWitnessKeypair({ ...target, password });
    const files = ['keypair-encrypted.json', 'keypair-recovery.json', 'recovery-hash.json'];
    const originals = Object.fromEntries(await Promise.all(files.map(async file => [file, await fs.readFile(path.join(dir, file), 'utf8')])));
    expect(decryptKeypair(JSON.parse(originals[files[0]]), password).privateKey).toBe(keypair.privateKey);
    expect(decryptWithRecoveryCodes(JSON.parse(originals[files[1]]), recoveryCodes).privateKey).toBe(keypair.privateKey);
    expect(await witnessCustodyState(target)).toMatchObject({ secured: true, encrypted: true });
    for (const file of ['keypair.json', ...files]) {
      for (const bytes of ['null', 'false', '{}', '[]', 'true', '"not an envelope"', '{']) {
        await fs.writeFile(path.join(dir, file), bytes);
        await expect(witnessCustodyState(target), `${file}: ${bytes}`).rejects.toThrow();
        expect(await fs.readFile(path.join(dir, file), 'utf8')).toBe(bytes);
      }
      if (file === 'keypair.json') await fs.unlink(path.join(dir, file));
      else await fs.writeFile(path.join(dir, file), originals[file]);
    }
    for (const file of files) {
      await fs.unlink(path.join(dir, file));
      await expect(witnessCustodyState(target), `missing ${file}`).rejects.toThrow();
      for (const other of files.filter(name => name !== file)) expect(await fs.readFile(path.join(dir, other), 'utf8')).toBe(originals[other]);
      await fs.writeFile(path.join(dir, file), originals[file]);
    }
    const envelope = JSON.parse(originals[files[0]]);
    for (const patch of [{ version: '9' }, { algorithm: 'none' }, { kdf: 'none' }, { kdfIterations: 1 }, { salt: 'xx' }, { iv: 'ab' }, { tag: 'aa' }, { ciphertext: '1' }, { address: 'invalid' }]) {
      await fs.writeFile(path.join(dir, files[0]), JSON.stringify({ ...envelope, ...patch }));
      await expect(witnessCustodyState(target)).rejects.toThrow();
    }
    await fs.writeFile(path.join(dir, files[0]), originals[files[0]]);
    await fs.writeFile(path.join(dir, files[1]), JSON.stringify({ ...JSON.parse(originals[files[1]]), address: generateKeypair().address }));
    await expect(witnessCustodyState(target)).rejects.toThrow();
    await fs.writeFile(path.join(dir, files[1]), originals[files[1]]);
    expect(await witnessCustodyState(target)).toMatchObject({ secured: true });
  } finally {
    setAIWitnessesRoot(previous); await fs.rm(root, { recursive: true, force: true });
  }
});

// impure — real files through the real reader: an envelope sealed at the old count and one at
// the new count are both valid custody; a count outside the bounded range is not.
test('custody accepts envelopes at the old and the new derivation count, and refuses out-of-range counts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'custody-kdf-'));
  const previous = getAIWitnessesRoot();
  try {
    setAIWitnessesRoot(root);
    const target = { vendorSlug: 'artifact-proof', chosenName: 'CountProof' };
    const dir = keyDir(target.vendorSlug, target.chosenName);
    const keypair = generateKeypair(); const password = 'disposable-artifact-password';
    await writePlaintextKeypair(target.vendorSlug, target.chosenName, keypair);
    const { recoveryCodes } = await secureWitnessKeypair({ ...target, password });
    const file = path.join(dir, 'keypair-encrypted.json');
    const current = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(current.kdfIterations).toBe(600_000);
    expect(await witnessCustodyState(target)).toMatchObject({ secured: true });
    const legacy = sealLegacyEnvelope(keypair, password, { iterations: 100_000 });
    await fs.writeFile(file, JSON.stringify(legacy));
    expect(await witnessCustodyState(target)).toMatchObject({ secured: true });
    expect(decryptKeypair(JSON.parse(await fs.readFile(file, 'utf8')), password).privateKey).toBe(keypair.privateKey);
    expect(decryptWithRecoveryCodes(JSON.parse(await fs.readFile(path.join(dir, 'keypair-recovery.json'), 'utf8')), recoveryCodes).address).toBe(keypair.address);
    for (const kdfIterations of [99_999, 10_000_001, 600_000.5, '600000']) {
      await fs.writeFile(file, JSON.stringify({ ...legacy, kdfIterations }));
      await expect(witnessCustodyState(target), String(kdfIterations)).rejects.toThrow('Invalid witness custody artifact');
    }
  } finally {
    setAIWitnessesRoot(previous); await fs.rm(root, { recursive: true, force: true });
  }
});
