// vault-sync.test.js — the collective vault exporter proven on the real
// stack: a real SQLite store built with claude-mem's schema, real markdown
// written to and re-read from a real temp vault, and the real CLI run as a
// real subprocess. No mock anywhere (RULE 0).

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTempDir } from '../helpers/temp-fs.js';
import { runVaultSync } from '../../cli/lib/vault-sync.js';

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL('../../cli/index.js', import.meta.url));

const SESSION = '1a00c6a1-af68-41f0-9ef4-2558fb066a4e';

const createFixtureDb = (dbPath) => {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, type TEXT,
      title TEXT, subtitle TEXT, narrative TEXT, facts TEXT, concepts TEXT,
      files_read TEXT, files_modified TEXT, created_at TEXT, content_hash TEXT
    );
    CREATE TABLE session_summaries (
      id INTEGER PRIMARY KEY, memory_session_id TEXT, project TEXT, request TEXT,
      investigated TEXT, learned TEXT, completed TEXT, next_steps TEXT,
      notes TEXT, created_at TEXT
    );
  `);
  const insertObs = db.prepare(
    'INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  insertObs.run(1, SESSION, 'neuma', 'discovery',
    'CLI uses yargs', 'Modular registration', 'The CLI follows a testable pattern.',
    '["entry is cli/index.js"]', '["pattern"]', '["cli/index.js"]', '[]',
    '2026-07-05T19:46:07.831Z', 'hash-obs-1');
  insertObs.run(2, SESSION, 'neuma', 'feature',
    'Vault exporter shipped', null, 'Notes now flow to the vault.',
    '[]', '["vault"]', '[]', '["cli/lib/vault-sync.js"]',
    '2026-07-05T20:00:00.000Z', 'hash-obs-2');
  insertObs.run(3, 'other-session', 'kenorie', 'change',
    'Web layer tweak', null, 'Unrelated project row.',
    '[]', '[]', '[]', '[]', '2026-07-05T21:00:00.000Z', 'hash-obs-3');
  db.prepare('INSERT INTO session_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(10, SESSION, 'neuma', 'Ship the vault exporter',
      'Existing memory stores.', 'A vault is just markdown.', 'Exporter built.',
      'Wire personal vaults.', 'Consent-shaped by design.', '2026-07-05T20:30:00.000Z');
  db.close();
  return dbPath;
};

describe('runVaultSync (real SQLite, real disk)', () => {
  let dbPath;
  let outDir;

  beforeEach(async () => {
    const dir = await createTempDir('vault-sync');
    dbPath = createFixtureDb(join(dir, 'claude-mem.db'));
    outDir = join(dir, 'vault');
  });

  it('materializes wikilinked notes from the store', async () => {
    const result = await runVaultSync({ dbPath, outDir });
    expect(result).toMatchObject({ created: 4, updated: 0, unchanged: 0, preserved: [] });

    const obs = await readFile(join(outDir, 'observations/neuma/1-cli-uses-yargs.md'), 'utf8');
    expect(obs).toContain('# CLI uses yargs');
    expect(obs).toContain('- entry is cli/index.js');
    expect(obs).toContain('**Session:** [[S10-ship-the-vault-exporter]]');
    expect(obs).toContain('source_hash: "hash-obs-1"');

    const moc = await readFile(join(outDir, 'sessions/neuma/S10-ship-the-vault-exporter.md'), 'utf8');
    expect(moc).toContain('[[1-cli-uses-yargs|CLI uses yargs]]');
    expect(moc).toContain('[[2-vault-exporter-shipped|Vault exporter shipped]]');
    expect(moc).toContain('## Learned');

    const other = await readFile(join(outDir, 'observations/kenorie/3-web-layer-tweak.md'), 'utf8');
    expect(other).not.toContain('**Session:**');
  });

  it('is idempotent — a second run changes nothing', async () => {
    await runVaultSync({ dbPath, outDir });
    const again = await runVaultSync({ dbPath, outDir });
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 4, preserved: [] });
  });

  it('rewrites a note when its source row changed', async () => {
    await runVaultSync({ dbPath, outDir });
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE observations SET narrative = ?, content_hash = ? WHERE id = 1')
      .run('The pattern was revised.', 'hash-obs-1-v2');
    db.close();

    const result = await runVaultSync({ dbPath, outDir });
    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 3 });
    const obs = await readFile(join(outDir, 'observations/neuma/1-cli-uses-yargs.md'), 'utf8');
    expect(obs).toContain('The pattern was revised.');
  });

  it('preserves a hand-edited note across source changes, until --force', async () => {
    await runVaultSync({ dbPath, outDir });
    const notePath = join(outDir, 'observations/neuma/1-cli-uses-yargs.md');
    await writeFile(notePath, (await readFile(notePath, 'utf8')) + '\nMy own annotation.\n');
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE observations SET content_hash = ? WHERE id = 1').run('hash-obs-1-v2');
    db.close();

    const soft = await runVaultSync({ dbPath, outDir });
    expect(soft.preserved).toEqual(['observations/neuma/1-cli-uses-yargs.md']);
    expect(await readFile(notePath, 'utf8')).toContain('My own annotation.');

    const forced = await runVaultSync({ dbPath, outDir, force: true });
    expect(forced.updated).toBeGreaterThanOrEqual(1);
    expect(await readFile(notePath, 'utf8')).not.toContain('My own annotation.');
  });

  it('scopes to one project when asked', async () => {
    const result = await runVaultSync({ dbPath, outDir, project: 'neuma' });
    expect(result.created).toBe(3);
    await expect(access(join(outDir, 'observations/kenorie'))).rejects.toThrow();
  });

  it('mirrors a curated markdown memory dir into memory/', async () => {
    const memoryDir = await createTempDir('vault-memory-src');
    await writeFile(join(memoryDir, 'MEMORY.md'), '# Index\n- [[project-x]]\n');
    await writeFile(join(memoryDir, 'not-markdown.txt'), 'skipped');

    const first = await runVaultSync({ dbPath, outDir, memoryDir });
    expect(first.memoryCopied).toBe(1);
    expect(await readFile(join(outDir, 'memory/MEMORY.md'), 'utf8')).toContain('[[project-x]]');
    await expect(access(join(outDir, 'memory/not-markdown.txt'))).rejects.toThrow();

    const second = await runVaultSync({ dbPath, outDir, memoryDir });
    expect(second.memoryCopied).toBe(0);
  });

  it('writes nothing under dry-run while reporting the plan', async () => {
    const result = await runVaultSync({ dbPath, outDir, dryRun: true });
    expect(result).toMatchObject({ created: 4, dryRun: true });
    await expect(access(join(outDir, 'observations'))).rejects.toThrow();
  });
});

describe('neuma vault sync (real subprocess)', () => {
  it('runs the real CLI end to end', async () => {
    const dir = await createTempDir('vault-cli');
    const dbPath = createFixtureDb(join(dir, 'claude-mem.db'));
    const outDir = join(dir, 'vault');

    const { stdout } = await execFileAsync(
      process.execPath, [CLI, 'vault', 'sync', '--db', dbPath, '--out', outDir],
    );
    expect(stdout).toContain('vault sync: 4 created, 0 updated, 0 unchanged');
    const moc = await readFile(join(outDir, 'sessions/neuma/S10-ship-the-vault-exporter.md'), 'utf8');
    expect(moc).toContain('# Ship the vault exporter');
  });

  it('fails loudly when the store is missing', async () => {
    const dir = await createTempDir('vault-cli-missing');
    await expect(execFileAsync(
      process.execPath, [CLI, 'vault', 'sync', '--db', join(dir, 'absent.db'), '--out', join(dir, 'vault')],
    )).rejects.toMatchObject({ code: 1 });
  });
});
