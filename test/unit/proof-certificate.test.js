// proof-certificate.test.js — the certificate's attestation fields and its
// INTEGRITY, proven by recomputation (RULE 0): a receipt is sealed to real
// disk (temp data root), read back through the real store, and its hash
// re-derived from the canonical JSON. A certificate whose hash does not
// recompute is decoration, not proof.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  canonicalReceiptJson, integrityHash, buildCertificate, saveProof,
  listProofs, readProof, proofsDir,
} from '../../backend/services/bench/proof-certificate.js';

// A real-shaped receipt: the same construction the runner produces, at a
// two-item scale. No mock — this object IS the runner's output shape.
const receipt = () => ({
  kind: 'bench-proof',
  suiteVersion: '1',
  runId: '2026-09-24T01-00-00-000Z-deadbeef',
  startedAt: '2026-09-24T01:00:00.000Z',
  finishedAt: '2026-09-24T01:02:11.000Z',
  subject: { servedId: 'fixture-model-v1' },
  environment: { gpuName: 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition', driver: '610.57.04', platformVersion: '0.1.22' },
  sampling: { temperature: 0, seed: 7 },
  sections: {
    arithmetic: { total: 2, pass: 1 },
    instruction: { total: 1, pass: 1 },
    format: { total: 1, pass: 0 },
  },
  total: { total: 4, pass: 2 },
  items: [
    { id: 'gsm8k-00', section: 'arithmetic', prompt: 'p1', completion: '#### 18', pass: true, detail: '18 (via ####)', transportError: false, durationMs: 900 },
    { id: 'gsm8k-01', section: 'arithmetic', prompt: 'p2', completion: '#### 4', pass: false, detail: '4 ≠ 3 (via ####)', transportError: false, durationMs: 800 },
    { id: 'instr-all-caps', section: 'instruction', prompt: 'p3', completion: 'PARIS.', pass: true, detail: 'all letters capital', transportError: false, durationMs: 300 },
    { id: 'format-trio', section: 'format', prompt: 'p4', completion: '["a","b"]', pass: false, detail: '$ must have exactly 3 item(s) (has 2)', transportError: false, durationMs: 200 },
  ],
});

describe('the canonical receipt + integrity hash', () => {
  it('key order does not move the hash — the canonical form fixes it', () => {
    const a = receipt();
    const shuffled = { ...a, items: a.items, total: a.total, sections: a.sections };
    expect(canonicalReceiptJson(shuffled)).toBe(canonicalReceiptJson(a));
    expect(integrityHash(shuffled)).toBe(integrityHash(a));
    expect(integrityHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('one changed verdict breaks the hash', () => {
    const a = receipt();
    const b = receipt();
    b.items[0] = { ...b.items[0], pass: false };
    expect(integrityHash(b)).not.toBe(integrityHash(a));
  });
});

describe('the certificate and the store (real disk, temp root)', () => {
  let tmp;
  const savedEnv = process.env.NEUMA_DATA_ROOT;
  beforeEach(async () => {
    tmp = await createTempDir('bench-proof-cert');
    process.env.NEUMA_DATA_ROOT = tmp;
  });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = savedEnv;
  });

  it('seal → read back: certificate fields, appendix, and the hash verifies', async () => {
    const sealed = await saveProof(receipt());
    expect(sealed.id).toBe(receipt().runId);
    // The file is really there, at the isolated root.
    const onDisk = JSON.parse(readFileSync(path.join(proofsDir(), sealed.id, 'receipt.json'), 'utf8'));
    expect(onDisk.integrity).toBe(sealed.integrity);
    expect(integrityHash(onDisk)).toBe(sealed.integrity); // recomputed over the stored receipt

    const found = await readProof(sealed.id);
    expect(found.receipt.total).toEqual({ total: 4, pass: 2 });
    expect(found.certificate).toContain('# NEUMA BENCH — PROOF CERTIFICATE');
    expect(found.certificate).toContain('`fixture-model-v1`');
    expect(found.certificate).toContain('NEUMA 0.1.22');
    expect(found.certificate).toContain('proof-suite v1');
    expect(found.certificate).toContain(sealed.integrity);
    expect(found.certificate).toContain('**2 of 4 items pass — 50.0%.**');
    expect(found.certificate).toContain('| arithmetic | 1 | 2 | 50.0% |');
    expect(found.certificate).toContain('gsm8k-01 | arithmetic | FAIL');
    expect(found.certificate).toContain('What this proves — and what it does not');
    expect(found.certificate).toContain('NVIDIA RTX PRO 6000 Blackwell Workstation Edition');
    expect(found.certificate).toContain('610.57.04');

    const list = await listProofs();
    expect(list.map((p) => p.id)).toEqual([sealed.id]);
  });

  it('readProof — a bad id and a missing id both read null, never a path', async () => {
    expect(await readProof('../..')).toBeNull();
    expect(await readProof('a/b')).toBeNull();
    expect(await readProof('no-such-proof')).toBeNull();
  });

  it('listProofs — an empty proofs root reads empty', async () => {
    expect(await listProofs()).toEqual([]);
  });

  it('buildCertificate — pure over a minimal receipt, missing env says unknown', () => {
    const md = buildCertificate({
      suiteVersion: '1', startedAt: 'x', finishedAt: 'y', subject: {}, total: { pass: 0, total: 1 },
      sections: { arithmetic: { pass: 0, total: 1 } }, items: [{ id: 'i', section: 'arithmetic', pass: false, detail: 'no' }],
      integrity: 'ab'.repeat(32),
    });
    expect(md).toContain('NEUMA unknown');
    expect(md).toContain('| arithmetic | 0 | 1 | 0.0% |');
  });
});
