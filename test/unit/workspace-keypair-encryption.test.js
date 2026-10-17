/**
 * Keypair encryption at rest (Stage 1 custody critical #3).
 *
 * The interim birth keypair (written before the witness sets a password) must
 * never be a plaintext private key on disk. writeKeypair now uses the encrypted
 * envelope; readKeypair stays backward-compatible with already-born neuma whose
 * keypairs were written raw before this fix.
 */
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { generateKeypair } from '../../core/weave/keypair.js';

describe('NeumaWorkspace keypair encryption at rest', () => {
  let workspace, tempDir;
  const neumaId = 'neuma-keytest';

  beforeEach(async () => {
    tempDir = await createTempDir('ws-keypair');
    vi.resetModules();
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = tempDir;
    await fs.mkdir(path.join(tempDir, neumaId, 'keys'), { recursive: true });
  });

  afterEach(() => vi.restoreAllMocks());

  const keyFile = () => path.join(tempDir, neumaId, 'keys', 'keypair.json');

  test('writeKeypair never leaves the private key or mnemonic in plaintext', async () => {
    const kp = generateKeypair();
    await workspace.writeKeypair(neumaId, kp);

    const raw = await fs.readFile(keyFile(), 'utf8');
    expect(raw).not.toContain(kp.privateKey);
    expect(raw).not.toContain(kp.mnemonic);
    expect(JSON.parse(raw)._enc).toBeTruthy(); // an encrypted envelope, not the secret
  });

  test('readKeypair round-trips the encrypted keypair', async () => {
    const kp = generateKeypair();
    await workspace.writeKeypair(neumaId, kp);

    const read = await workspace.readKeypair(neumaId);
    expect(read.privateKey).toBe(kp.privateKey);
    expect(read.address).toBe(kp.address);
  });

  test('readKeypair still loads a legacy raw-plaintext keypair (backward compat)', async () => {
    const kp = generateKeypair();
    // Simulate a pre-fix neuma: raw JSON on disk, no envelope.
    await fs.writeFile(keyFile(), JSON.stringify(
      { address: kp.address, privateKey: kp.privateKey, publicKey: kp.publicKey }, null, 2,
    ));

    const read = await workspace.readKeypair(neumaId);
    expect(read.privateKey).toBe(kp.privateKey);
    expect(read.address).toBe(kp.address);
  });
});
