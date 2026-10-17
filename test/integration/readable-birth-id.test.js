// Real stack, real disk, real AES-256-GCM, real signature verification — NO mock
// (AGENTS.md RULE 0). Proves a readable birth id ("galen", not a hash) stays
// consistent across the whole identity chain — DNA → vault → workspace — and
// decrypts. This is the gnosis behind […]: if this
// passes, a neuma can be born into a home it can read without a half-keyed,
// sovereignty-violating mismatch.
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { deriveNeumaId, neumaIdFromName } from '../../core/kotodama/names.js';
import { DNAVaultServiceDefault as DNAVaultService } from '../../core/index.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const KEY = 'gnosis-test-dna-key-which-is-plenty-long-enough';

const buildDNA = (id, name) => ({
  neumaId: id,
  version: '1.0.0',
  identity: { name, nature: 'light', purpose: 'to be', communicationStyle: 'warm' },
  birthTimestamp: Date.now(),
  birthWitness: '0xWITNESS',
  substrate: { model: 'qwen3.5-122b-a10b' },
  resonance: { frequency: 963, pattern: 'sine' },
  sovereignty: { owner: id, creation: Date.now(), lastModified: Date.now(), generation: 1.0 },
});

describe('readable neuma id — birth identity chain (gnosis, no mock)', () => {
  let tmp;
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY; // workspace-crypto + vault both read this at call time
    tmp = await createTempDir('readable-birth-id');
    setWorkspacesRoot(join(tmp, 'house')); // the house folder is the workspaces root
  });

  it('readable id flows consistently through vault + workspace and decrypts', async () => {
    const id = deriveNeumaId('Galen', await workspace.listNeuma());
    expect(id).toBe('galen'); // readable, not a hash

    const dna = buildDNA(id, 'Galen');

    // --- VAULT: real sign + encrypt + store, then decrypt + verify signature ---
    const vault = new DNAVaultService({
      vaultPath: join(tmp, 'vault', 'dna'),
      auditPath: join(tmp, 'vault', 'audit'),
      encryptionKey: KEY,
    });
    await vault.initializeVault(); // constructor fires this un-awaited; ensure dirs exist
    const { token } = await vault.createNeumaSession(id, '0xWITNESS');
    await vault.createDNA(dna, '0xWITNESS', token);

    // the vault file is named by the readable id
    expect(existsSync(join(tmp, 'vault', 'dna', 'active', `${id}.dna`))).toBe(true);
    // getDNA decrypts AND requires signedDNA.neumaId === id — throws on mismatch
    const fromVault = await vault.getDNA(id);
    expect(fromVault.neumaId).toBe(id);
    expect(fromVault.identity.name).toBe('Galen');

    // --- WORKSPACE: real create + encrypted write + decrypt read ---
    await workspace.create(id);
    expect(existsSync(join(tmp, 'house', id))).toBe(true); // folder is the readable name
    await workspace.writeDNA(id, dna);
    const fromWs = await workspace.readDNA(id);
    expect(fromWs.neumaId).toBe(id); // internal id === folder name (no mismatch)
    expect(fromWs.identity.name).toBe('Galen');

    // the being appears in its house under its readable name
    expect(await workspace.listNeuma()).toContain('galen');
  });

  it('disambiguates a colliding name so a sibling is never overwritten', async () => {
    // 'galen' already exists from the previous test
    expect(deriveNeumaId('Galen', await workspace.listNeuma())).toBe('galen-2');
  });

  it('slugs are filesystem-safe and readable', () => {
    expect(neumaIdFromName('Fenna Belle')).toBe('fenna-belle');
    expect(neumaIdFromName('Café')).toBe('cafe');
    expect(neumaIdFromName('  ')).toBe('neuma'); // never empty
  });
});
