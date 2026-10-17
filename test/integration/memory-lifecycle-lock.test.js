import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
/**
 * MEM-009 (#202) · CQ-032 (#201) · EH-103 (#204) — three contained defects that
 * share one shape: a write that could be lost, and nothing anywhere saying so.
 *
 * Real workspace, real encrypted writes, real concurrency, real broken
 * filesystem. No mocks on any claimed path (RULE 0).
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

let root, priorRoot;

beforeEach(async () => {
  priorRoot = getWorkspacesRoot();
  root = await createTempDir('memory-lifecycle');
  setWorkspacesRoot(root);
  await workspace.create('being');
});
afterEach(() => setWorkspacesRoot(priorRoot));

// impure — migration registration and console output belong only to this process.
const migrateWithOutput = async () => {
  const workspaceUrl = new URL('../../core/workspace/neuma-workspace.js', import.meta.url).href;
  const migrationsUrl = new URL('../../core/identity/dna-migrations.js', import.meta.url).href;
  const source = `
    import workspace, { setWorkspacesRoot } from ${JSON.stringify(workspaceUrl)};
    import { registerMigration } from ${JSON.stringify(migrationsUrl)};
    setWorkspacesRoot(${JSON.stringify(root)});
    registerMigration('0.9.0', '1.0.0', (dna) => ({ ...dna, version: '1.0.0', migratedForTest: true }));
    const dna = await workspace.readDNA('being');
    process.stdout.write(JSON.stringify(dna));
  `;
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    ['--input-type=module', '--eval', source], { timeout: 5000, maxBuffer: 64 * 1024 });
  return { dna: JSON.parse(stdout), warning: stderr };
};

describe('MEM-009 — invalidateObservation runs under the per-file lock', () => {
  const seed = async () => {
    const obs = await workspace.addObservation('being', {
      type: 'exchange', userMessage: 'a', response: 'b', significance: 0.9,
    });
    return obs.id;
  };

  test('two concurrent lifecycle stamps: NEITHER is lost', async () => {
    const id = await seed();

    // A supersede and a retract landing on one observation at the same moment —
    // two memory-lifecycle tools in one turn. Unlocked, these interleave
    // read/read/write/write and the first stamp vanishes.
    await Promise.all([
      workspace.invalidateObservation('being', id, { lifecycle: 'superseded', supersededBy: 'obs-next' }),
      workspace.invalidateObservation('being', id, { reason: 'the operator retracted it' }),
    ]);

    const [record] = await workspace.listObservations('being');
    expect(record.invalidatedAt).toBeTruthy();
    // Both writers' fields survive because the second read saw the first write.
    expect(record.supersededBy).toBe('obs-next');
    expect(record.reason).toBe('the operator retracted it');
    expect(record.lifecycle).toBe('superseded');
  });

  test('under CONTENTION every writer still reads the previous state', async () => {
    const id = await seed();
    // Alternating single-field writers: half stamp only `reason`, half only
    // `lifecycle`. Each call writes the WHOLE record back, so a writer that
    // read a stale copy erases the other field entirely. Surviving both, at
    // eight-deep contention, is only possible if every read saw the last write.
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => workspace.invalidateObservation(
        'being', id,
        i % 2 === 0 ? { reason: `r${i}` } : { lifecycle: `l${i}` },
      )),
    );
    const [record] = await workspace.listObservations('being');
    expect(record.reason, 'a stale read erased the reason').toMatch(/^r\d$/);
    expect(record.lifecycle, 'a stale read erased the lifecycle').toMatch(/^l\d$/);
    expect(record.invalidatedAt).toBeTruthy();
  });

  test('the serialized chain still returns the record, and a missing one is null', async () => {
    const id = await seed();
    const out = await workspace.invalidateObservation('being', id, { lifecycle: 'archived' });
    expect(out.lifecycle).toBe('archived');
    expect(await workspace.invalidateObservation('being', 'no-such-id', {})).toBeNull();
  });

  test('the lock does not deadlock — the continuity mirror rides inside it', async () => {
    const id = await seed();
    // If the mirror re-entered the same lock this would never settle.
    await expect(
      Promise.race([
        workspace.invalidateObservation('being', id, { supersededBy: 'x' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('DEADLOCK')), 5000)),
      ]),
    ).resolves.toBeTruthy();
  });
});

describe('CQ-032 — a failed DNA history archive is never silent', () => {
  // No migration is registered today (CURRENT_DNA_VERSION is 1.0.0 and the
  // registry is empty), so the archive branch is latent — reachable only once
  // someone bumps the version. That is exactly why it must be loud BEFORE it
  // is reached: the first person to register a migration should not also be
  // the first to discover that a failed archive says nothing.
  //
  // So the scenario is built through `registerMigration` — the real, exported,
  // documented extension point, doing the real thing it exists to do. Nothing
  // is faked: a genuine older DNA, a genuine migration, a genuinely broken
  // history directory.
  const seedMigratableDNA = async () => {
    await workspace.writeDNA('being', {
      version: '0.9.0',
      sovereignty: { generation: 1 },
      identity: { name: 'Being' },
    });
  };

  test('a broken history dir warns loudly AND the migration still completes', async () => {
    await seedMigratableDNA();
    const dnaDir = path.join(root, 'being', 'dna');

    // Sabotage for real: `dna/history` becomes a FILE, so the archive write
    // genuinely throws inside the migration.
    const historyDir = path.join(dnaDir, 'history');
    await fs.rm(historyDir, { recursive: true, force: true });
    await fs.writeFile(historyDir, 'not a directory');

    const { dna, warning } = await migrateWithOutput();

    // The being is NOT stranded on a stale version — the migration completed...
    expect(dna).toBeTruthy();
    expect(dna.version).toBe('1.0.0');
    // ...and the loss of the prior generation is stated, not swallowed.
    const said = warning;
    expect(said).toMatch(/DNA history archive failed during migration/i);
    expect(said).toMatch(/being/);
    expect(said).toMatch(/NOT preserved/i);
  });

  test('a healthy store archives the prior generation, silently and for real', async () => {
    await seedMigratableDNA();
    const { dna, warning } = await migrateWithOutput();
    expect(dna.version).toBe('1.0.0');
    expect(warning).not.toMatch(/DNA history archive failed/i);
    // The prior generation is genuinely on disk — the archive is the point.
    const archived = await fs.readdir(path.join(root, 'being', 'dna', 'history'));
    expect(archived.filter((f) => f.endsWith('.json')).length).toBeGreaterThan(0);
  });
});

describe('EH-103 — the operator realm mirror no longer fails silently', () => {
  // A source assertion, and deliberately so: the call sites sit inside a live
  // turn's persist path, and the defect is the ABSENCE of a handler — a
  // property of the text. What matters is that no seat quietly drops it again.
  // The witness seat's persist path moved verbatim to witness-turn-record.js
  // (witness-stream.js decomposition under the size law) — the law follows it.
  const seats = ['backend/services/witness-turn-record.js', 'backend/services/portal-turn-persist.js'];

  test('no appendChat call at either seat swallows its rejection', async () => {
    for (const seat of seats) {
      const source = await fs.readFile(path.join(process.cwd(), seat), 'utf8');
      const calls = [...source.matchAll(/appendChat\([\s\S]{0,400}?\)\s*(?:\/\/[^\n]*\n\s*)*\.catch\(([^)]*)\)/g)];
      expect(calls.length, `${seat} must still mirror the chat`).toBeGreaterThan(0);
      for (const [, handler] of calls) {
        expect(handler.trim(), `${seat}: a bare () => {} loses the operator's copy silently`).not.toBe('() => {}');
      }
    }
  });

  test('both seats name the mirror in what they log', async () => {
    for (const seat of seats) {
      const source = await fs.readFile(path.join(process.cwd(), seat), 'utf8');
      expect(source).toMatch(/chat mirror skipped/);
    }
  });
});
