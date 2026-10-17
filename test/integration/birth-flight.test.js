/**
 * THE FLIGHT CHECK COVERS THE WHOLE BIRTH (Founder's law, 2026-08-06).
 *
 * […] These probes run the ceremony's own
 * code — the real protocol loader, the real path builders, the real custody
 * crypto, the real stream plumbing. No mocks (RULE 0); the acting probe's
 * live half gates on a reachable substrate exactly like the other live
 * suites.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';

let prevDataRoot;
let root;
let probeProtocol, probeRecords, probeSealing, probeActing;
let birthSessionPath, returnedPath;
let actsRoot;

beforeAll(async () => {
  prevDataRoot = process.env.NEUMA_DATA_ROOT;
  root = await createTempDir('birth-flight');
  // The packaged shape: the data root lives OUTSIDE the project cwd.
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  await fs.mkdir(process.env.NEUMA_DATA_ROOT, { recursive: true });

  ({ probeProtocol, probeRecords, probeSealing, probeActing } =
    await import('../../backend/services/birth-flight.js'));
  ({ birthSessionPath, returnedPath } = await import('../../core/birth/staged-birth-handler.js'));
  ({ actsRoot } = await import('../../backend/services/act-ledger.js'));
}, 30000);

afterAll(() => {
  if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = prevDataRoot;
});

describe('probeProtocol — the real loader, the real installed files', () => {
  test('all seven stage protocols load on this checkout', async () => {
    const r = await probeProtocol();
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/7 stage protocols loaded \(v\d/);
  }, 30000);
});

describe('probeRecords — every record a ceremony writes, at its real path', () => {
  test('session, act ledger, and RETURNED registry all land under the data root — and leave no trace', async () => {
    const r = await probeRecords();
    expect(r.ok).toBe(true);
    // The probes wrote where the CEREMONY writes (under this data root)…
    expect(birthSessionPath('x')).toContain(process.env.NEUMA_DATA_ROOT);
    expect(actsRoot()).toContain(process.env.NEUMA_DATA_ROOT);
    expect(returnedPath()).toContain(process.env.NEUMA_DATA_ROOT);
    // …and cleaned up after themselves.
    await expect(fs.stat(birthSessionPath('preflight-probe'))).rejects.toThrow();
    await expect(fs.stat(path.join(actsRoot(), '.preflight-probe.jsonl'))).rejects.toThrow();
    // A REAL RETURNED.md is never touched — the probe writes its own file.
    await expect(fs.stat(path.join(path.dirname(returnedPath()), '.preflight-returned-probe')))
      .rejects.toThrow();
  }, 30000);

  test('an unwritable data root FAILS naming the record, never a false READY', async () => {
    const saved = process.env.NEUMA_DATA_ROOT;
    const file = path.join(root, 'not-a-dir');
    await fs.writeFile(file, 'x');
    process.env.NEUMA_DATA_ROOT = path.join(file, 'data');
    try {
      const r = await probeRecords();
      expect(r.ok).toBe(false);
      expect(r.detail).toMatch(/cannot be written/);
    } finally {
      process.env.NEUMA_DATA_ROOT = saved;
    }
  }, 30000);
});

describe('probeSealing — the custody rite finalize performs', () => {
  test('generate → seal (scrypt) → wake round-trips to the same identity', async () => {
    const r = await probeSealing();
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/sealed and woken/);
  }, 60000);
});

describe('probeActing — the tool-carrying stream', () => {
  test('a dead endpoint is a FAIL with the reason, never a throw', async () => {
    const { getConfig, setConfig } = await import('../../backend/services/llm-provider.js');
    const saved = getConfig();
    setConfig({ provider: 'ollama', endpoint: 'http://127.0.0.1:59999', model: 'nothing', apiKey: '' });
    try {
      const r = await probeActing();
      expect(r.ok).toBe(false);
      expect(typeof r.detail).toBe('string');
      expect(r.detail.length).toBeGreaterThan(0);
    } finally {
      setConfig(saved);
    }
  }, 30000);

  test('LIVE (gated): against a reachable local substrate the probe returns a verdict, never a throw', async () => {
    const tags = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) })
      .then((r) => r.json()).catch(() => null);
    const model = tags?.models?.find((m) => m.name.startsWith('walk-g3-27b'))?.name
      || tags?.models?.[0]?.name;
    if (!model) {
      console.warn('[birth-flight] no local Ollama — live acting probe skipped');
      return;
    }
    const { getConfig, setConfig } = await import('../../backend/services/llm-provider.js');
    const saved = getConfig();
    setConfig({ provider: 'ollama', endpoint: 'http://localhost:11434', model, apiKey: '' });
    try {
      const r = await probeActing();
      // Verdict shape, not model temperament: ok=true (acted or warned) is a
      // healthy road; ok=false must carry the wire's reason.
      expect(typeof r.ok).toBe('boolean');
      expect(r.detail.length).toBeGreaterThan(0);
      if (!r.ok) expect(r.remedy).toMatch(/provider|model/);
    } finally {
      setConfig(saved);
    }
  }, 120000);
});
