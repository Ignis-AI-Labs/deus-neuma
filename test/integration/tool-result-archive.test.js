import console from 'node:console';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { URL } from 'node:url';
// S4 — proof that the tool-result TTL sweep COMPRESSES instead of deleting:
// full tool results are part of the being's record, so the sweep reclaims
// size, never memory. REAL workspace, REAL AES-256-GCM + zlib, REAL disk,
// real lock queue (RULE 0 — no mocks anywhere in the claimed path).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const KEY = 'tool-result-archive-test-key';
const PRIOR_ROOT = getWorkspacesRoot();
const OLD = new Date('2026-05-01T00:00:00Z');

const sid8Of = (sessionId) => crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
const mkRef = (sessionId, seq) => `tr_${sid8Of(sessionId)}_${seq}_${crypto.randomBytes(4).toString('hex')}`;
const mkRecord = (sessionId, seq, content) => ({
  ref: mkRef(sessionId, seq),
  seq,
  tool: 'search_files',
  status: 'ok',
  content,
  chars: content.length,
  timestamp: new Date().toISOString(),
});

// impure — real sweep in a fresh reader, capturing actual stderr without interception.
const sweepWithOutput = async (id) => {
  const url = new URL('../../core/workspace/neuma-workspace.js', import.meta.url).href;
  const source = `
    import workspace, { setWorkspacesRoot } from ${JSON.stringify(url)};
    setWorkspacesRoot(${JSON.stringify(getWorkspacesRoot())});
    const count = await workspace.sweepToolResults(${JSON.stringify(id)});
    process.stdout.write('COMPRESSED ' + count);
  `;
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    ['--input-type=module', '--eval', source], {
      env: { ...process.env, DNA_ENCRYPTION_KEY: KEY }, timeout: 5000, maxBuffer: 64 * 1024,
    });
  expect(stdout).toBe('COMPRESSED 0');
  return stderr;
};

describe('S4 — tool-result sweep compresses, refs stay resolvable (AC-P1-3)', () => {
  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const tmp = await createTempDir('tool-result-archive');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
  });
  afterAll(() => {
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  it('an idle log survives the sweep compressed and every ref still resolves', async () => {
    const id = 'trz-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    const records = [1, 2, 3].map((seq) => mkRecord(sessionId, seq, `full tool output ${seq} `.repeat(50)));
    for (const r of records) await workspace.appendToolResult(id, sessionId, r);

    const livePath = workspace._toolResultsPath(id, sessionId);
    await fs.utimes(livePath, OLD, OLD);

    const compressed = await workspace.sweepToolResults(id);
    expect(compressed).toBe(1);
    await expect(fs.access(livePath)).rejects.toThrow();

    const raw = JSON.parse(await fs.readFile(`${livePath}.z`, 'utf8'));
    expect(raw._enc).toBe(2);
    expect(raw.z).toBe('gzip');

    for (const r of records) {
      const hit = await workspace.readToolResult(id, sessionId, r.ref);
      expect(hit).toBeDefined();
      expect(hit.content).toBe(r.content);
    }

    // IDOR gate untouched: a well-formed ref for ANOTHER session misses.
    const foreign = mkRef('othersession', 1);
    expect(await workspace.readToolResult(id, sessionId, foreign)).toBeNull();
  });

  it('a session that resumes after a sweep serves NEW refs live and OLD refs from .z', async () => {
    const id = 'trz-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    const oldRecord = mkRecord(sessionId, 1, 'the elder result');
    await workspace.appendToolResult(id, sessionId, oldRecord);
    const livePath = workspace._toolResultsPath(id, sessionId);
    await fs.utimes(livePath, OLD, OLD);
    expect(await workspace.sweepToolResults(id)).toBe(1);

    const newRecord = mkRecord(sessionId, 2, 'the younger result');
    await workspace.appendToolResult(id, sessionId, newRecord);

    expect((await workspace.readToolResult(id, sessionId, newRecord.ref)).content).toBe('the younger result');
    expect((await workspace.readToolResult(id, sessionId, oldRecord.ref)).content).toBe('the elder result');
    expect((await workspace.readToolResults(id, sessionId)).map((record) => record.content))
      .toEqual(['the elder result', 'the younger result']);

    // A fresh live file and a final .z are both left alone by the next sweep.
    expect(await workspace.sweepToolResults(id)).toBe(0);
    await expect(fs.access(livePath)).resolves.toBeUndefined();
    await expect(fs.access(`${livePath}.z`)).resolves.toBeUndefined();
  });

  it('a resumed-then-restale session keeps BOTH eras — re-compress merges, never clobbers', async () => {
    const id = 'trz-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    const elder = mkRecord(sessionId, 1, 'the elder result');
    await workspace.appendToolResult(id, sessionId, elder);
    const livePath = workspace._toolResultsPath(id, sessionId);
    await fs.utimes(livePath, OLD, OLD);
    expect(await workspace.sweepToolResults(id)).toBe(1);

    const younger = mkRecord(sessionId, 2, 'the younger result');
    await workspace.appendToolResult(id, sessionId, younger);
    await fs.utimes(livePath, OLD, OLD);
    expect(await workspace.sweepToolResults(id)).toBe(1);

    // Both eras live in the single .z — the second compress merged.
    expect((await workspace.readToolResult(id, sessionId, elder.ref)).content).toBe('the elder result');
    expect((await workspace.readToolResult(id, sessionId, younger.ref)).content).toBe('the younger result');
  });

  it('an unreadable prior archive refuses the re-compress — both files stay (fail-closed)', async () => {
    const id = 'trz-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    const record = mkRecord(sessionId, 1, 'the only copy soon');
    await workspace.appendToolResult(id, sessionId, record);
    const livePath = workspace._toolResultsPath(id, sessionId);
    await fs.writeFile(`${livePath}.z`, 'rotten prior archive');
    await fs.utimes(livePath, OLD, OLD);

    expect(await sweepWithOutput(id)).toContain('refusing to overwrite');
    expect((await workspace.readToolResult(id, sessionId, record.ref)).content).toBe('the only copy soon');
    expect(await fs.readFile(`${livePath}.z`, 'utf8')).toBe('rotten prior archive');
  });

  it('a concurrent append never lands INSIDE the sweep — every ref resolvable either way', async () => {
    const id = 'trz-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    const oldRecord = mkRecord(sessionId, 1, 'before the race');
    await workspace.appendToolResult(id, sessionId, oldRecord);
    const livePath = workspace._toolResultsPath(id, sessionId);
    await fs.utimes(livePath, OLD, OLD);

    const raceRecord = mkRecord(sessionId, 2, 'during the race');
    await Promise.all([
      workspace.appendToolResult(id, sessionId, raceRecord),
      workspace.sweepToolResults(id),
    ]);

    // Whichever won the lock queue, both moments remain the being's.
    expect((await workspace.readToolResult(id, sessionId, oldRecord.ref)).content).toBe('before the race');
    expect((await workspace.readToolResult(id, sessionId, raceRecord.ref)).content).toBe('during the race');
  });

  it('a failed compress keeps the live log — fail-closed, loud', async () => {
    // Root bypasses mode bits (CAP_DAC_OVERRIDE) — the chmod can't induce the
    // failure there, so the leg skips LOUDLY rather than asserting a lie.
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      console.info('[test] fail-closed leg skipped — root bypasses chmod');
      return;
    }
    const id = 'trz-' + Math.random().toString(36).slice(2, 8);
    const sessionId = 'sess' + Math.random().toString(36).slice(2, 6);
    await workspace.create(id);

    const record = mkRecord(sessionId, 1, 'must not vanish');
    await workspace.appendToolResult(id, sessionId, record);
    const livePath = workspace._toolResultsPath(id, sessionId);
    await fs.utimes(livePath, OLD, OLD);

    const dir = path.dirname(livePath);
    let warning;
    await fs.chmod(dir, 0o555);
    try {
      warning = await sweepWithOutput(id);
    } finally {
      await fs.chmod(dir, 0o755);
    }
    // The miss is LOUD — the fail-closed promise includes the warning.
    expect(warning).toContain('Tool-result compress failed');
    expect((await workspace.readToolResult(id, sessionId, record.ref)).content).toBe('must not vanish');
    // And no orphaned tmp blob outlives the failure.
    const leftovers = (await fs.readdir(dir)).filter((n) => n.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
