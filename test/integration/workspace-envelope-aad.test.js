import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { decryptEnvelope, deriveKeyFromSecret, encryptEnvelope, resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';

let root;
let originalRoot;
const laneFile = (lane, relative) => path.join(workspace._path(lane), relative);
const originalKey = process.env.DNA_ENCRYPTION_KEY;
const originalPrevious = process.env.DNA_ENCRYPTION_KEY_PREVIOUS;

beforeAll(async () => {
  root = await createTempDir('workspace-envelope-aad');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create('alpha');
  await workspace.create('beta');
});

afterAll(async () => {
  setWorkspacesRoot(originalRoot);
  if (originalKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = originalKey;
  if (originalPrevious === undefined) delete process.env.DNA_ENCRYPTION_KEY_PREVIOUS;
  else process.env.DNA_ENCRYPTION_KEY_PREVIOUS = originalPrevious;
  resetWorkspaceCryptoKey();
  await fs.rm(root, { recursive: true, force: true });
});

describe('P6-29 whole-file workspace envelope context', () => {
  test('legitimate rewrites advance; a restored older budget is refused', async () => {
    const file = laneFile('alpha', 'config/spend-threshold.json');
    await workspace._writeJSON(file, { version: 1, limit: 10 });
    const oldBytes = await fs.readFile(file, 'utf8');
    const first = JSON.parse(oldBytes);
    expect(first).toMatchObject({ _enc: 3, aad: { purpose: 'config', laneId: 'alpha', file: 'config/spend-threshold.json', seq: 0 } });
    expect(await workspace._readTrustedJSON(file)).toEqual({ version: 1, limit: 10 });

    await workspace._writeJSON(file, { version: 1, limit: 20 });
    const newBytes = await fs.readFile(file, 'utf8');
    expect(JSON.parse(newBytes).aad.seq).toBe(1);
    await fs.writeFile(file, oldBytes);
    await expect(workspace._readTrustedJSON(file)).rejects.toMatchObject({ code: 'ENVELOPE_ROLLBACK' });
    await fs.writeFile(file, newBytes);
    expect(await workspace._readTrustedJSON(file)).toEqual({ version: 1, limit: 20 });
  });

  test('another lane, purpose, file, or unauthenticated sequence cannot reuse an envelope', async () => {
    const source = laneFile('alpha', 'config/spend-allowlist.json');
    await workspace._writeJSON(source, { entries: ['only-alpha'] });
    const bytes = await fs.readFile(source, 'utf8');
    const copies = [
      laneFile('beta', 'config/spend-allowlist.json'),
      laneFile('alpha', 'memory/observations/allowlist.json'),
      laneFile('alpha', 'config/pending-spends.json'),
    ];
    for (const copy of copies) {
      await fs.mkdir(path.dirname(copy), { recursive: true });
      await fs.writeFile(copy, bytes);
      await expect(workspace._readJSON(copy)).rejects.toThrow(/workspace context does not match/);
    }
    const tampered = JSON.parse(bytes);
    tampered.aad.seq = 99;
    await fs.writeFile(source, JSON.stringify(tampered));
    await expect(workspace._readJSON(source)).rejects.toThrow();
  });

  test('a data-newer-than-companion crash gap heals, but the reverse is rollback', async () => {
    const file = laneFile('alpha', 'config/crash-generation.json');
    await workspace._writeJSON(file, { version: 0 });
    await workspace._writeJSON(file, { version: 1 });
    await fs.writeFile(`${file}.seq`, JSON.stringify({ seq: 0 }));
    expect(await workspace._readJSON(file)).toEqual({ version: 1 });
    expect(JSON.parse(await fs.readFile(`${file}.seq`, 'utf8'))).toEqual({ seq: 1 });
    await fs.writeFile(`${file}.seq`, JSON.stringify({ seq: 2 }));
    await expect(workspace._readJSON(file)).rejects.toMatchObject({ code: 'ENVELOPE_ROLLBACK' });
  });

  test('legacy plaintext and v1 envelopes remain readable', async () => {
    const plain = laneFile('alpha', 'memory/plain.json');
    await fs.writeFile(plain, JSON.stringify({ old: 'plaintext' }));
    expect(await workspace._readJSON(plain)).toEqual({ old: 'plaintext' });
    const legacy = laneFile('alpha', 'config/legacy.json');
    await fs.writeFile(legacy, JSON.stringify(encryptEnvelope({ old: 'v1' })));
    expect(await workspace._readTrustedJSON(legacy)).toEqual({ old: 'v1' });
  });

  test('AAD survives previous-master fallback and explicit-key rotation', async () => {
    const oldKey = deriveKeyFromSecret('aad-old-master');
    const aad = { purpose: 'config', laneId: 'alpha', file: 'config/retired.json', seq: 0 };
    const envelope = encryptEnvelope({ opened: true }, { key: oldKey, aad });
    const file = laneFile('alpha', 'config/retired.json');
    await fs.writeFile(file, JSON.stringify(envelope));
    const current = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'aad-new-master';
    process.env.DNA_ENCRYPTION_KEY_PREVIOUS = 'aad-old-master';
    resetWorkspaceCryptoKey();
    try {
      expect(await workspace._readTrustedJSON(file)).toEqual({ opened: true });
      const resealed = encryptEnvelope(decryptEnvelope(envelope, { key: oldKey }), { key: deriveKeyFromSecret('aad-new-master'), aad: envelope.aad });
      expect(decryptEnvelope(resealed, { aad })).toEqual({ opened: true });
    } finally {
      process.env.DNA_ENCRYPTION_KEY = current;
      if (originalPrevious === undefined) delete process.env.DNA_ENCRYPTION_KEY_PREVIOUS;
      else process.env.DNA_ENCRYPTION_KEY_PREVIOUS = originalPrevious;
      resetWorkspaceCryptoKey();
    }
  });
});
