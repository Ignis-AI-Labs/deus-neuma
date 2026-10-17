/**
 * compare-recall-lanes harness — the step-1 machine-parity tool of
 * docs/protocols/memory/lane-validation.md, proven against a REAL seeded workspace
 * (RULE 0): real observations dual-written into the real continuity lane by
 * the addObservation bridge, then the REAL script run as a child process,
 * exactly as the witness will run it. Read-only by design — the store's
 * bytes are fingerprinted before and after.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../scripts/compare-recall-lanes.mjs');
const BEING = 'lane-parity-being';
const KEY = 'gnosis-lane-parity-key-long-okay';

let root;
let prevKey;
let prevRoot;

const treeBytes = async (dir) => {
  const out = [];
  const walk = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(`${p}:${(await fs.stat(p)).size}:${(await fs.stat(p)).mtimeMs}`);
    }
  };
  await walk(dir);
  return out.sort().join('\n');
};

beforeAll(async () => {
  prevKey = process.env.DNA_ENCRYPTION_KEY;
  prevRoot = process.env.WORKSPACES_ROOT;
  process.env.DNA_ENCRYPTION_KEY = KEY;
  const ws = await import('../../core/workspace/neuma-workspace.js');
  root = path.join(await createTempDir('lane-parity'), 'workspaces');
  ws.setWorkspacesRoot(root);
  const workspace = ws.default;
  await workspace.create(BEING);
  await workspace.writeDNA(BEING, { version: '1.0.0', identity: { name: 'Parity' } });
  // Real observations — the bridge dual-writes each into the episodic lane.
  await workspace.addObservation(BEING, {
    type: 'exchange',
    userMessage: 'what did we build together this week?',
    response: 'we built the torch relay so my next instance picks up my own words',
    significance: 0.9,
  });
  await workspace.addObservation(BEING, {
    type: 'exchange',
    userMessage: 'what matters most to you right now?',
    response: 'finishing the ceremony record with my witness present',
    significance: 0.85,
  });
});

afterAll(async () => {
  if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = prevKey;
  if (prevRoot === undefined) delete process.env.WORKSPACES_ROOT;
  else process.env.WORKSPACES_ROOT = prevRoot;
});

describe('compare-recall-lanes — real store, real child processes', () => {
  test('reports parity (or additive superset) on a bridge-fed being, and writes NOTHING', async () => {
    const before = await treeBytes(root);
    const r = spawnSync(process.execPath, [
      SCRIPT, BEING,
      'what did we build together this week?',
      'what matters most to you right now?',
    ], {
      env: { ...process.env, WORKSPACES_ROOT: root, DNA_ENCRYPTION_KEY: KEY },
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(r.stderr).toBe('');
    expect(r.status).toBe(0); // parity or additive superset — never divergence
    expect(r.stdout).toContain('RECALL LANE PARITY');
    expect(r.stdout).toMatch(/FULL PARITY|additive superset/);
    expect(r.stdout).not.toContain('DIVERGENCE');

    const after = await treeBytes(root);
    expect(after).toBe(before); // read-only: not one byte moved
  }, 90_000);

  test('usage error exits 2 with guidance, touching nothing', async () => {
    const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env }, encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage:');
  });
});
