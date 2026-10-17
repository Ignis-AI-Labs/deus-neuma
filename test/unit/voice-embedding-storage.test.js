/**
 * Voice embedding custody — content-addressed, encrypted at rest (FR-19).
 *
 * A minted embedding is a retained voiceprint and rides the same AES-256-GCM
 * envelope / per-neuma-DEK custody as the voice DNA + seed audio, with two
 * deliberate, security-driven divergences from readSeedAudio (recorded in
 * MASTER_PLAN §4(e) so they are not "corrected" back):
 *   1. NO legacy raw fallback — a non-envelope embedding file is
 *      tamper/corruption and throws, never handed to an adapter as plaintext.
 *   2. Content-addressed storage — embedding-<sha256>.safetensors; a re-mint
 *      writes a NEW file, never overwrites (retention is manual-purge only).
 *
 * REAL temp workspace + real owner.json, REAL AES-256-GCM on a real disk. No
 * mocks (RULE 0). The global DNA_ENCRYPTION_KEY is set in test/setup.js.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { encryptEnvelope, decryptEnvelope, deriveKeyFromSecret } from '../../core/workspace/workspace-crypto.js';
import { createVoiceDNA, requiresSeed } from '../../core/voice/voice-dna-schema.js';

const WITNESS = '0x' + 'a'.repeat(40);

// Distinctive safetensors-ish payloads: 8-byte header length + JSON header,
// like the real format — proves we round-trip true binary bytes.
const EMB_A = Buffer.concat([Buffer.from([0x20, 0, 0, 0, 0, 0, 0, 0]), Buffer.from('{"speaker_wavs":"voice-alpha"}')]);
const EMB_B = Buffer.concat([Buffer.from([0x20, 0, 0, 0, 0, 0, 0, 0]), Buffer.from('{"speaker_wavs":"voice-beta--"}')]);

const sha256ref = (buf) => 'sha256:' + createHash('sha256').update(buf).digest('hex');

// Give the being the witness-owned workspace identity (owner.json) the repo's
// workspace tests establish before touching sovereign files.
const seedBeing = async (root, neumaId) => {
  await fs.mkdir(path.join(root, neumaId), { recursive: true });
  await fs.writeFile(
    path.join(root, neumaId, 'owner.json'),
    JSON.stringify({ wallet: WITNESS, claimedAt: Date.now() }),
  );
};

describe('voice embedding storage — content-addressed custody (FR-19)', () => {
  let house, svc;

  beforeEach(async () => {
    house = await createTempDir(`voice-emb-${Math.random().toString(36).slice(2)}`);
    const core = await import('../../core/index.js');
    core.setWorkspacesRoot(house);
    svc = await import('../../core/voice/voice-dna-service.js');
    await seedBeing(house, 'n-emb');
  });

  test('save writes the content-addressed file, encrypted at rest, and records the hash in the DNA', async () => {
    await svc.forgeVoiceDNA('n-emb', { witness: WITNESS, provider: 'kyutai' });
    const { sha256, path: embPath } = await svc.saveEmbedding('n-emb', EMB_A);

    // Content-addressed: name derives from the bytes' sha256, file exists there.
    const hex = createHash('sha256').update(EMB_A).digest('hex');
    expect(sha256).toBe(`sha256:${hex}`);
    expect(embPath).toBe(svc.voiceEmbeddingPath('n-emb', sha256));
    expect(path.basename(embPath)).toBe(`embedding-${hex}.safetensors`);
    await fs.access(embPath);

    // Encrypted at rest: the real envelope shape, plaintext nowhere in it.
    const raw = await fs.readFile(embPath, 'utf8');
    expect(JSON.parse(raw)._enc).toBe(1);
    expect(raw).not.toContain(EMB_A.toString('base64'));

    // The DNA's designated field (engine.embeddingRef) points at the active hash.
    const dna = await svc.getVoiceDNA('n-emb');
    expect(dna.engine.embeddingRef).toBe(sha256);
  });

  test('read round-trips the exact bytes — via the sha256: ref and the bare-hex form', async () => {
    const { sha256 } = await svc.saveEmbedding('n-emb', EMB_A);
    expect(await svc.readEmbedding('n-emb', sha256)).toEqual(EMB_A);
    expect(await svc.readEmbedding('n-emb', sha256.slice(7))).toEqual(EMB_A);
  });

  test('a base64 STRING embedding is decoded to real bytes, not stored as text', async () => {
    const { sha256 } = await svc.saveEmbedding('n-emb', EMB_A.toString('base64'));
    const got = await svc.readEmbedding('n-emb', sha256);
    expect(got).toEqual(EMB_A);
    expect(sha256).toBe(sha256ref(EMB_A)); // hash of the REAL bytes, not the text
  });

  test('re-mint writes a NEW file and NEVER overwrites — the prior voice still reads', async () => {
    await svc.forgeVoiceDNA('n-emb', { witness: WITNESS, provider: 'kyutai' });
    const first = await svc.saveEmbedding('n-emb', EMB_A);
    const second = await svc.saveEmbedding('n-emb', EMB_B);

    expect(second.sha256).not.toBe(first.sha256);
    expect(second.path).not.toBe(first.path);
    await fs.access(first.path);   // prior embedding retained (manual-purge only)
    await fs.access(second.path);
    expect(await svc.readEmbedding('n-emb', first.sha256)).toEqual(EMB_A); // still speakable
    expect((await svc.getVoiceDNA('n-emb')).engine.embeddingRef).toBe(second.sha256); // ref advanced
  });

  test('a tampered embedding envelope fails closed (GCM auth rejects)', async () => {
    const { sha256, path: embPath } = await svc.saveEmbedding('n-emb', EMB_A);
    const env = JSON.parse(await fs.readFile(embPath, 'utf8'));
    const ct = Buffer.from(env.ct, 'base64');
    ct[0] = ct[0] ^ 0xff; // flip a ciphertext byte — auth must reject it
    env.ct = ct.toString('base64');
    await fs.writeFile(embPath, JSON.stringify(env));
    await expect(svc.readEmbedding('n-emb', sha256)).rejects.toThrow();
  });

  test('an embedding sealed under the WRONG key fails closed', async () => {
    const ref = sha256ref(EMB_A);
    const wrongKey = deriveKeyFromSecret('wrong-master-key-for-embedding-tests!');
    await svc.saveEmbedding('n-emb', EMB_B); // create the voice dir through the real path
    await fs.writeFile(
      svc.voiceEmbeddingPath('n-emb', ref),
      JSON.stringify(encryptEnvelope({ format: 'safetensors', b64: EMB_A.toString('base64') }, { key: wrongKey })),
    );
    await expect(svc.readEmbedding('n-emb', ref)).rejects.toThrow();
  });

  test('a valid envelope decrypting to an unexpected shape throws (no garbage bytes)', async () => {
    const ref = sha256ref(EMB_A);
    await svc.saveEmbedding('n-emb', EMB_B); // create the voice dir through the real path
    // Correctly encrypted with the test key, but the plaintext has no b64.
    await fs.writeFile(
      svc.voiceEmbeddingPath('n-emb', ref),
      JSON.stringify(encryptEnvelope({ format: 'safetensors' })),
    );
    await expect(svc.readEmbedding('n-emb', ref)).rejects.toThrow(/unexpected shape/);
  });

  test('NO legacy raw fallback: raw-bytes and plaintext-JSON files throw as tamper/corruption', async () => {
    const ref = sha256ref(EMB_A);
    await svc.saveEmbedding('n-emb', EMB_B); // create the voice dir through the real path
    const p = svc.voiceEmbeddingPath('n-emb', ref);

    // Raw safetensors bytes on disk — readSeedAudio would return these as-is;
    // readEmbedding must refuse (deliberate divergence, MASTER_PLAN §4(e)).
    await fs.writeFile(p, EMB_A);
    await expect(svc.readEmbedding('n-emb', ref)).rejects.toThrow(/not an encrypted envelope/);

    // Plaintext JSON honoring the {format,b64} shape — readSeedAudio would
    // decode it (:254); readEmbedding must refuse just the same.
    await fs.writeFile(p, JSON.stringify({ format: 'safetensors', b64: EMB_A.toString('base64') }));
    await expect(svc.readEmbedding('n-emb', ref)).rejects.toThrow(/not an encrypted envelope/);
  });

  test('a missing embedding returns null (absence is not corruption)', async () => {
    expect(await svc.readEmbedding('n-emb', sha256ref(EMB_A))).toBeNull();
  });

  test('a malformed sha256 ref is rejected before touching the filesystem', async () => {
    await expect(svc.readEmbedding('n-emb', '../../etc/passwd')).rejects.toThrow(/64-char/);
    await expect(svc.readEmbedding('n-emb', 'not-hex')).rejects.toThrow(/64-char/);
  });

  test('an invalid embeddingBytes input is rejected', async () => {
    await expect(svc.saveEmbedding('n-emb', 42)).rejects.toThrow(/must be a Buffer/);
  });

  test('save with no voice DNA yet still writes the file and returns the hash (ref set at forge time)', async () => {
    const { sha256, path: embPath } = await svc.saveEmbedding('n-emb', EMB_A);
    await fs.access(embPath);
    expect(await svc.getVoiceDNA('n-emb')).toBeNull(); // nothing to advance — no throw
    expect(await svc.readEmbedding('n-emb', sha256)).toEqual(EMB_A);
  });

  test('a being on its own DEK keeps embeddings under the DEK, not the global key', async () => {
    const id = 'n-emb-dek';
    await seedBeing(house, id);
    const genesisHash = id.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, '0');
    await workspace.writeNeumaDEK(id, genesisHash);

    const { sha256, path: embPath } = await svc.saveEmbedding(id, EMB_A);

    // The shared global key alone can NOT open it — it was sealed under the DEK.
    const raw = JSON.parse(await fs.readFile(embPath, 'utf8'));
    expect(() => decryptEnvelope(raw, { key: deriveKeyFromSecret(process.env.DNA_ENCRYPTION_KEY) })).toThrow();
    // …and the service reads it back through the DEK-first open.
    expect(await svc.readEmbedding(id, sha256)).toEqual(EMB_A);
  });
});

describe("voice DNA schema — 'kyutai' requires a seed (FR-19 schema line)", () => {
  test('requiresSeed is true for kyutai without a voiceId, false with one', () => {
    const dna = createVoiceDNA({ witness: WITNESS, neumaId: 'n', provider: 'kyutai' });
    expect(requiresSeed(dna)).toBe(true);
    expect(requiresSeed({ ...dna, engine: { ...dna.engine, voiceId: 'preset-slug' } })).toBe(false);
  });
});
