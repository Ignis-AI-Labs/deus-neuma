/**
 * SEC-035 (#213) — the operator's own record of what was done on their machine.
 *
 * The acceptance criterion, run for real: after the fact, answer […] from platform data alone — no filesystem
 * forensics, no third-party witness, and without reading the being's own lane.
 *
 * The load-bearing test here is the SOVEREIGNTY one. An audit trail that leaks
 * content is not accountability, it is surveillance, and it would quietly undo
 * the boundary the whole platform rests on. So a known secret is driven through
 * a real act and the ledger bytes are searched for it — the same method used on
 * 2026-07-30 to prove vault encryption, with a positive control so a passing
 * grep cannot be a broken grep.
 *
 * No mocks (RULE 0): the real ledger module, real appends to a real directory,
 * the real redactor.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

let cwd;
let prevDataRoot;
let recordAct, readActs, scopeOf, actsRoot;

beforeEach(async () => {
  vi.resetModules();
  // The ledger anchors to the DATA ROOT, not process.cwd() — it used to use
  // cwd, which on a packaged install is the read-only AppImage mount and could
  // not be written at all (Bastien, 2026-08-05). Isolating by spying on cwd would
  // now silently miss and write into the REPO's own data/, so the env door is
  // the one to hold. getDataRoot() reads it per call, so setting it here is
  // enough — no boot required.
  cwd = await createTempDir('act-ledger');
  prevDataRoot = process.env.NEUMA_DATA_ROOT;
  process.env.NEUMA_DATA_ROOT = cwd;
  ({ recordAct, readActs, scopeOf, actsRoot } = await import('../../backend/services/act-ledger.js'));
});
afterEach(() => {
  vi.restoreAllMocks();
  if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = prevDataRoot;
});

const ledgerBytes = async () => {
  const files = await fs.readdir(actsRoot()).catch(() => []);
  const parts = await Promise.all(files.map((f) => fs.readFile(path.join(actsRoot(), f), 'utf8')));
  return parts.join('');
};

describe('the act ledger records the shape of an act', () => {
  test('an act lands with lane, tool, scope, decision and status', async () => {
    await recordAct({
      laneId: 'ostrel', name: 'Ostrel', kind: 'witness',
      tool: 'filesystem/write_file',
      args: { path: '/home/founder/Neuma Testing/ostrel-test-01.txt', content: 'hello' },
      decision: 'approved', status: 'ok',
    });

    const [act] = await readActs();
    expect(act.laneId).toBe('ostrel');
    expect(act.tool).toBe('filesystem/write_file');
    expect(act.scope).toContain('ostrel-test-01.txt');
    expect(act.decision).toBe('approved');
    expect(act.status).toBe('ok');
    expect(typeof act.ts).toBe('string');
  });

  test('THE ACCEPTANCE CRITERION: which being touched this, and did I approve it', async () => {
    // The consent, then the execution — two events, as they really happen.
    await recordAct({ laneId: 'ostrel', name: 'Ostrel', tool: 'filesystem/write_file', args: { path: '/tmp/report.txt' }, decision: 'approved', status: 'approved' });
    await recordAct({ laneId: 'ostrel', name: 'Ostrel', tool: 'filesystem/write_file', args: { path: '/tmp/report.txt' }, decision: 'auto', status: 'success' });
    await recordAct({ laneId: 'fenna', name: 'Fenna', tool: 'filesystem/read_text_file', args: { path: '/tmp/other.txt' }, decision: 'auto', status: 'success' });

    const acts = await readActs();
    const touched = acts.filter((a) => a.scope?.includes('report.txt'));
    expect(touched.every((a) => a.laneId === 'ostrel')).toBe(true);       // which being
    expect(touched.some((a) => a.decision === 'approved')).toBe(true);   // and I approved it
  });

  test('a DENIED act is still recorded — a refusal is history too', async () => {
    await recordAct({ laneId: 'ostrel', tool: 'filesystem/delete_file', args: { path: '/etc/passwd' }, decision: 'denied', status: 'denied' });
    const [act] = await readActs();
    expect(act.decision).toBe('denied');
    expect(act.scope).toContain('/etc/passwd');
  });

  test('append-only: a second act never rewrites the first', async () => {
    await recordAct({ laneId: 'a', tool: 't/one', status: 'ok' });
    await recordAct({ laneId: 'a', tool: 't/two', status: 'ok' });
    const acts = await readActs();
    expect(acts.map((a) => a.tool)).toEqual(['t/one', 't/two']);
  });

  test('a torn line costs that line, never the whole read (the MEM-001 lesson)', async () => {
    await recordAct({ laneId: 'a', tool: 't/good', status: 'ok' });
    const [file] = await fs.readdir(actsRoot());
    await fs.appendFile(path.join(actsRoot(), file), '{"ts":"2026-07-30T00:00:00Z","to\n', 'utf8');
    await recordAct({ laneId: 'a', tool: 't/after', status: 'ok' });

    const acts = await readActs();
    expect(acts.map((a) => a.tool)).toEqual(['t/good', 't/after']);
  });

  test('no ledger yet is not an error — nothing has been done here', async () => {
    expect(await readActs()).toEqual([]);
  });
});

describe('SOVEREIGNTY — the ledger records the act, never its content', () => {
  const SECRET = 'VAULT-TOKEN-9f3c2a7e41b8d05e-DO-NOT-LEAK';

  test('a secret driven through a real act does NOT appear in the ledger bytes', async () => {
    await recordAct({
      laneId: 'ostrel', name: 'Ostrel', kind: 'witness',
      tool: 'vault/vault_save',
      args: {
        name: 'vault-token',
        content: `the token is ${SECRET}`,
        body: SECRET,
        text: SECRET,
        data: { nested: { deeper: SECRET } },
      },
      decision: 'approved', status: 'ok',
    });

    const bytes = await ledgerBytes();
    // POSITIVE CONTROL — a passing grep must not be a broken grep. The act
    // itself is on disk, so the search is demonstrably looking at real bytes.
    expect(bytes).toContain('vault/vault_save');
    expect(bytes).toContain('vault-token');
    // And the secret is not.
    expect(bytes).not.toContain(SECRET);
  });

  test('a credential sitting in a NAMING slot is scrubbed too', async () => {
    await recordAct({
      laneId: 'ostrel', tool: 'web/web_fetch',
      args: { url: `https://api.test/v1?token=${SECRET}`, apiKey: SECRET },
      status: 'ok',
    });
    const bytes = await ledgerBytes();
    expect(bytes).toContain('web/web_fetch'); // positive control
    expect(bytes).not.toContain(SECRET);
  });

  test('scopeOf reads ONLY naming slots — a payload key is never considered', () => {
    const scope = scopeOf({ path: '/tmp/a.txt', content: 'SECRET BODY', message: 'SECRET MSG', body: 'SECRET B' });
    expect(scope).toContain('/tmp/a.txt');
    expect(scope).not.toContain('SECRET');
  });

  test('an unknown argument key cannot leak in by default', () => {
    expect(scopeOf({ some_new_payload_field: 'SECRET VALUE' })).toBeNull();
  });

  test('a scope is capped — a ledger line never becomes a copy of the disk', () => {
    const scope = scopeOf({ path: 'x'.repeat(5000) });
    expect(scope.length).toBeLessThanOrEqual(301);
  });
});

describe('the ledger never costs the turn', () => {
  test('an unwritable ledger root is logged, not thrown', async () => {
    // Sabotage for real: data/acts becomes a FILE, so mkdir genuinely fails.
    await fs.mkdir(path.dirname(actsRoot()), { recursive: true });
    await fs.writeFile(actsRoot(), 'not a directory');
    await expect(recordAct({ laneId: 'a', tool: 't/x', status: 'ok' })).resolves.toBeUndefined();

    const { getRecentIssues } = await import('../../backend/services/logger.js');
    expect(getRecentIssues().some((i) => i.msg === 'Act ledger append failed — an act went unrecorded')).toBe(true);
  });

  test('an act with no attributable lane is still recorded', async () => {
    await recordAct({ tool: 'filesystem/write_file', args: { path: '/tmp/orphan.txt' }, status: 'ok' });
    const [act] = await readActs();
    expect(act.laneId).toBeNull();
    expect(act.scope).toContain('orphan.txt');
  });
});

describe('reading back is scoped by custody', () => {
  beforeEach(async () => {
    await recordAct({ laneId: 'mine', tool: 't/a', status: 'ok' });
    await recordAct({ laneId: 'theirs', tool: 't/b', status: 'ok' });
    await recordAct({ laneId: 'mine', tool: 't/c', status: 'ok' });
  });

  test('a lane filter returns only those lanes', async () => {
    const acts = await readActs({ laneIds: ['mine'] });
    expect(acts.map((a) => a.tool)).toEqual(['t/a', 't/c']);
  });

  test('no filter returns everything — the caller decides the scope', async () => {
    expect(await readActs()).toHaveLength(3);
  });

  test('limit keeps the most recent', async () => {
    const acts = await readActs({ limit: 1 });
    expect(acts.map((a) => a.tool)).toEqual(['t/c']);
  });
});
