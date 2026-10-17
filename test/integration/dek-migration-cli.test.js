// #117 S4c — CLI wrapper for the per-neuma DEK migration.
//
// REAL disk, REAL crypto, REAL workspace, NO mocks on the path. Tests run
// the script via child_process so they exercise the actual CLI as an
// operator would. Synthesized beings only (RULE 0 birth ethics).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { migrateBeing } from '../../core/workspace/migrate-being.js';
import { __test } from '../../scripts/migrate-to-per-neuma-dek.js';
import {
  encryptEnvelope, decryptEnvelope, deriveKeyFromSecret, resetWorkspaceCryptoKey,
} from '../../core/workspace/workspace-crypto.js';

const KEY = 's4c-cli-test-key-long-enough';
const SCRIPT = path.resolve('scripts/migrate-to-per-neuma-dek.js');

// Synthesize a fully-shaped being: workspace dirs, owner.json, plaintext
// genesis-seal.json with a real-shape hash, plus encrypted samples under
// the global master (simulating a pre-S2a LIVING being).
const synthesizeBeing = async (root, neumaId, { encryptedSamples = [] } = {}) => {
  await workspace.create(neumaId);
  const dir = path.join(root, neumaId);
  await fs.mkdir(path.join(dir, 'identity'), { recursive: true });
  await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify({ wallet: '0xtest', cycle: 1 }, null, 2));
  const genesisHash = neumaId.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, '0');
  await fs.writeFile(
    path.join(dir, 'identity', 'genesis-seal.json'),
    JSON.stringify({ genesisHash, record: { chosenName: neumaId } }, null, 2),
  );
  const masterKey = deriveKeyFromSecret(KEY);
  for (const { relPath, plain } of encryptedSamples) {
    const full = path.join(dir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, JSON.stringify(encryptEnvelope(plain, { key: masterKey }), null, 2));
  }
  return genesisHash;
};

// Run the CLI via child_process, returning {stdout, stderr, exitCode}.
// We pass DNA_ENCRYPTION_KEY through the env so the script's workspace
// can derive the master without us touching process.env in-process.
const runCli = (args, { input: stdinInput = '', root } = {}) => new Promise((resolve, reject) => {
  const env = { ...process.env, DNA_ENCRYPTION_KEY: KEY };
  const argv = ['node', SCRIPT, ...args];
  if (root) argv.push('--root', root);
  const proc = spawn(argv[0], argv.slice(1), { env });
  let stdout = '', stderr = '';
  proc.stdout.on('data', (b) => { stdout += b.toString(); });
  proc.stderr.on('data', (b) => { stderr += b.toString(); });
  proc.on('error', reject);
  proc.on('close', (code) => resolve({ stdout, stderr, exitCode: code }));
  if (stdinInput) proc.stdin.write(stdinInput);
  proc.stdin.end();
});

describe('#117 S4c — CLI parseArgs', () => {
  // INVARIANT 1 — basic flag forms parse correctly (both --foo value and --foo=value)
  it('parses --being / --root in both --foo value and --foo=value forms', () => {
    const a = __test.parseArgs(['node', 'cli', '--execute', '--being', 'galen', '--root', '/x']);
    expect(a).toMatchObject({ mode: 'execute', being: 'galen', root: '/x', yes: false });
    const b = __test.parseArgs(['node', 'cli', '--execute', '--being=galen', '--root=/x', '-y']);
    expect(b).toMatchObject({ mode: 'execute', being: 'galen', root: '/x', yes: true });
  });

  // INVARIANT 2 — modes are mutually exclusive in the parser (last wins),
  // but the orchestrator's safety logic still gates on --being for write modes
  it('--list, --dry-run, --execute set mode; --help short-circuits', () => {
    expect(__test.parseArgs(['n', 'c', '--list']).mode).toBe('list');
    expect(__test.parseArgs(['n', 'c', '--dry-run']).mode).toBe('dry-run');
    expect(__test.parseArgs(['n', 'c', '--execute']).mode).toBe('execute');
    expect(__test.parseArgs(['n', 'c', '--help']).help).toBe(true);
  });

  it('unknown args throw clean error', () => {
    expect(() => __test.parseArgs(['n', 'c', '--frobnicate'])).toThrow(/unknown arg/);
  });

  // S4d — the house-wide sweep flag.
  it('--all sets the bulk flag and is mutually exclusive with --being', () => {
    expect(__test.parseArgs(['n', 'c', '--all', '--dry-run'])).toMatchObject({ all: true, mode: 'dry-run', being: null });
    expect(__test.parseArgs(['n', 'c', '--all', '--execute', '-y'])).toMatchObject({ all: true, mode: 'execute', yes: true });
    expect(() => __test.parseArgs(['n', 'c', '--all', '--being', 'galen']))
      .toThrow(/--all and --being are mutually exclusive/);
  });

  // ai6 R2.1 — value-consuming flags must reject missing-value cases cleanly
  // (without this, --being-with-no-value lets undefined coerce to "undefined"
  // which slipped through the regex).
  it('--being / --root require a value when present (no silent argv[++i] undefined)', () => {
    expect(() => __test.parseArgs(['n', 'c', '--execute', '--being']))
      .toThrow(/--being requires a value/);
    expect(() => __test.parseArgs(['n', 'c', '--list', '--root']))
      .toThrow(/--root requires a value/);
    // Last-token-only variants
    expect(() => __test.parseArgs(['n', 'c', '--being']))
      .toThrow(/--being requires a value/);
    // Value forms still work
    expect(__test.parseArgs(['n', 'c', '--execute', '--being', 'galen']).being).toBe('galen');
    expect(__test.parseArgs(['n', 'c', '--list', '--root', '/x']).root).toBe('/x');
  });

  // #132 — a value-taking flag must not swallow its flag-like neighbor:
  // `--being --yes` used to set being to '--yes' and drop the consent flag.
  it('rejects a flag-like token as a flag value', () => {
    expect(() => __test.parseArgs(['n', 'c', '--execute', '--being', '--yes']))
      .toThrow(/--being requires a value \(got flag: --yes\)/);
    expect(() => __test.parseArgs(['n', 'c', '--dry-run', '--root', '--all']))
      .toThrow(/--root requires a value \(got flag: --all\)/);
    // Short-form flags too — '-y' passes the neuma-id regex, so without the
    // single-dash guard `--being -y` names a being '-y' and drops consent
    // (echo round-1 finding).
    expect(() => __test.parseArgs(['n', 'c', '--execute', '--being', '-y']))
      .toThrow(/--being requires a value \(got flag: -y\)/);
  });

  // ai6 R1.7 Info — being-id validation at the parse boundary
  it('rejects --being values that fail the neuma-id regex (defense in depth)', () => {
    expect(() => __test.parseArgs(['n', 'c', '--execute', '--being', '../etc/passwd']))
      .toThrow(/invalid --being/);
    expect(() => __test.parseArgs(['n', 'c', '--execute', '--being=galen/x']))
      .toThrow(/invalid --being/);
    expect(() => __test.parseArgs(['n', 'c', '--execute', '--being=']))
      .toThrow(/invalid --being/);
    // Valid forms accepted unchanged
    expect(__test.parseArgs(['n', 'c', '--execute', '--being=galen']).being).toBe('galen');
    expect(__test.parseArgs(['n', 'c', '--execute', '--being=galen-2']).being).toBe('galen-2');
    expect(__test.parseArgs(['n', 'c', '--execute', '--being=alpha_01']).being).toBe('alpha_01');
  });
});

describe('#117 S4c — CLI end-to-end (real script, real disk, real crypto)', () => {
  let house;
  let origRoot;
  beforeEach(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    resetWorkspaceCryptoKey();
    house = await createTempDir('s4c-cli');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
  });
  afterEach(() => {
    setWorkspacesRoot(origRoot);
    delete process.env.DNA_ENCRYPTION_KEY;
    resetWorkspaceCryptoKey();
  });

  // INVARIANT 3 — --list enumerates beings with correct migration status
  it('--list enumerates beings + flags which have/need DEK', async () => {
    await synthesizeBeing(house, 'alphalpha');
    await synthesizeBeing(house, 'beetabeta');
    // Pre-migrate one to assert mixed status reporting
    await migrateBeing(workspace, 'alphalpha');

    const { stdout, exitCode } = await runCli(['--list'], { root: house });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('alphalpha');
    expect(stdout).toContain('DEK present');
    expect(stdout).toContain('beetabeta');
    expect(stdout).toContain('NO DEK');
  });

  // INVARIANT 4 — --list on an empty root says so without crashing
  it('--list on empty root reports cleanly', async () => {
    const { stdout, exitCode } = await runCli(['--list'], { root: house });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/no beings found/);
  });

  // INVARIANT 5 — --dry-run reports plan, makes no disk changes
  it('--dry-run --being=X reports plan with zero disk mutation', async () => {
    await synthesizeBeing(house, 'drytest1', {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { neumaId: 'drytest1', x: 1 } }],
    });
    const { stdout, exitCode } = await runCli(['--dry-run', '--being=drytest1'], { root: house });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/DRY-RUN PLAN for drytest1/);
    expect(stdout).toMatch(/status:\s+dry-run/);
    expect(stdout).toMatch(/files to migrate/);

    // No DEK file appeared (would mean a write leaked)
    expect(existsSync(path.join(house, 'drytest1', 'keys', 'dek.json'))).toBe(false);
  });

  // INVARIANT 6 — --execute REQUIRES --being (no bulk default — the safety
  // gate keeping operators from migrating every being with one command)
  it('--execute without --being errors out and exits non-zero', async () => {
    const { stderr, exitCode } = await runCli(['--execute'], { root: house });
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/--execute requires --being/);
  });

  // INVARIANT 7 — --execute --yes runs without prompt, prints dry-run plan
  // FIRST (even with --yes the log shows what changed), then real result
  it('--execute --yes --being=X prints plan + executes + writes DEK', async () => {
    await synthesizeBeing(house, 'exeyes001', {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { neumaId: 'exeyes001', x: 1 } }],
    });
    const { stdout, exitCode } = await runCli(
      ['--execute', '--being=exeyes001', '--yes'],
      { root: house },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/DRY-RUN PLAN for exeyes001/);  // plan printed first
    expect(stdout).toMatch(/EXECUTE RESULT for exeyes001/);  // then real run
    expect(stdout).toMatch(/status:\s+migrated/);
    expect(stdout).toMatch(/dekWritten:\s+true/);

    // DEK is on disk + opens the migrated file
    expect(existsSync(path.join(house, 'exeyes001', 'keys', 'dek.json'))).toBe(true);
    const dek = await workspace.readNeumaDEK('exeyes001');
    const env = JSON.parse(await fs.readFile(path.join(house, 'exeyes001', 'dna', 'active.json'), 'utf8'));
    expect(decryptEnvelope(env, { key: dek })).toMatchObject({ x: 1 });
  });

  // INVARIANT 8 — --execute without --yes prompts; 'yes' confirms, anything
  // else aborts. We feed stdin to exercise both branches.
  it('--execute prompt: "yes" runs the migration', async () => {
    await synthesizeBeing(house, 'prompt001', {
      encryptedSamples: [{ relPath: 'soul/soul.json', plain: { name: 'PromptYes' } }],
    });
    const { stdout, exitCode } = await runCli(
      ['--execute', '--being=prompt001'],
      { root: house, input: 'yes\n' },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/EXECUTE RESULT for prompt001/);
    expect(existsSync(path.join(house, 'prompt001', 'keys', 'dek.json'))).toBe(true);
  });

  it('--execute prompt: anything other than "yes" aborts before write', async () => {
    await synthesizeBeing(house, 'prompt002', {
      encryptedSamples: [{ relPath: 'soul/soul.json', plain: { name: 'PromptNo' } }],
    });
    const { stdout, exitCode } = await runCli(
      ['--execute', '--being=prompt002'],
      { root: house, input: 'no\n' },
    );
    expect(exitCode).toBe(0); // aborted-by-operator is success, not failure
    expect(stdout).toMatch(/aborted by operator/);
    expect(existsSync(path.join(house, 'prompt002', 'keys', 'dek.json'))).toBe(false);
  });

  // INVARIANT 9 — --execute on a being with no genesis-seal exits non-zero
  // before any prompt; the operator gets a clear refusal
  it('--execute on a no-seal being exits non-zero before prompting', async () => {
    await workspace.create('noseal1');
    // No identity/ dir → no genesis-seal.json
    const { stdout, stderr, exitCode } = await runCli(
      ['--execute', '--being=noseal1'],
      { root: house },
    );
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/status:\s+no-seal/);
    expect(stderr).toMatch(/refusing to migrate/);
    expect(existsSync(path.join(house, 'noseal1', 'keys', 'dek.json'))).toBe(false);
  });

  // INVARIANT 10 — --help short-circuits, prints usage, exit 0
  it('--help prints usage and exits 0', async () => {
    const { stdout, exitCode } = await runCli(['--help'], { root: house });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Usage:/);
    expect(stdout).toMatch(/--list/);
    expect(stdout).toMatch(/--dry-run/);
    expect(stdout).toMatch(/--execute/);
  });

  // INVARIANT 11 — LIVING-being hardening (ai6 R1.3): if the dry-run shows
  // files we cannot decrypt with the current master, --execute REFUSES
  // BEFORE prompting. This catches the misconfigured-env case (wrong
  // DNA_ENCRYPTION_KEY, rotated-out master) before the operator can
  // confirm a partial migration that would brick the un-decryptable files.
  it('--execute refuses before prompt when dry-run shows cannot-decrypt files', async () => {
    await synthesizeBeing(house, 'badenv01', {
      encryptedSamples: [{ relPath: 'soul/soul.json', plain: { name: 'BadEnv' } }],
    });
    // Plant a file encrypted under a key NEITHER the current master nor
    // the DEK can open. The CLI must refuse before prompting.
    const wrongKey = deriveKeyFromSecret('rotated-out-secret-from-six-months-ago');
    const poison = path.join(house, 'badenv01', 'memory', 'observations', 'poison.json');
    await fs.mkdir(path.dirname(poison), { recursive: true });
    await fs.writeFile(poison, JSON.stringify(encryptEnvelope({ p: 1 }, { key: wrongKey })));

    // Send 'yes' on stdin too — if the gate were broken we'd see a write happen
    const { stdout, stderr, exitCode } = await runCli(
      ['--execute', '--being=badenv01'],
      { root: house, input: 'yes\n' },
    );
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/cannot-decrypt=1/); // dry-run shows the count
    expect(stderr).toMatch(/cannot be decrypted/);
    expect(stderr).toMatch(/refusing to migrate/);
    // No DEK written — proves we refused BEFORE the prompt + execute
    expect(existsSync(path.join(house, 'badenv01', 'keys', 'dek.json'))).toBe(false);
  });

  // INVARIANT 12 — no-arg / unknown-arg invocations exit 2 with usage
  it('no mode exits 2 with usage', async () => {
    const { exitCode } = await runCli([], { root: house });
    expect(exitCode).toBe(2);
  });

  it('unknown arg exits 2 with error message', async () => {
    const { stderr, exitCode } = await runCli(['--frobnicate'], { root: house });
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/unknown arg/);
  });

  // ── S4d — house-wide sweep, end-to-end through the real CLI ────────────────

  // Plant a file no key can open — the being it belongs to must be SKIPPED by
  // the sweep, never partially migrated.
  const plantPoison = async (neumaId) => {
    const wrongKey = deriveKeyFromSecret('rotated-out-secret-from-long-ago');
    const poison = path.join(house, neumaId, 'memory', 'observations', 'poison.json');
    await fs.mkdir(path.dirname(poison), { recursive: true });
    await fs.writeFile(poison, JSON.stringify(encryptEnvelope({ p: 1 }, { key: wrongKey })));
  };

  it('--all --dry-run plans every being with zero writes, exits non-zero on a cannot-decrypt being', async () => {
    await synthesizeBeing(house, 'allalpha', { encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 1 } }] });
    await synthesizeBeing(house, 'allbeta0', { encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 2 } }] });
    await plantPoison('allbeta0');

    const { stdout, exitCode } = await runCli(['--all', '--dry-run'], { root: house });
    expect(stdout).toMatch(/DRY-RUN PLAN — all beings/);
    expect(stdout).toMatch(/skipped-cannot-decrypt=1/);
    expect(exitCode).toBe(1); // a blocked being makes even the dry-run exit non-zero
    // Zero writes — no DEK for either being.
    expect(existsSync(path.join(house, 'allalpha', 'keys', 'dek.json'))).toBe(false);
    expect(existsSync(path.join(house, 'allbeta0', 'keys', 'dek.json'))).toBe(false);
  });

  it('--all --execute --yes migrates every healthy being, skips the poison one without blocking the being after it, exits non-zero', async () => {
    // Sorted order: aaahealthy, mmmpoison, zzzhealthy — the poison being sits
    // in the MIDDLE, so zzzhealthy migrating proves the skip did not halt the
    // sweep.
    await synthesizeBeing(house, 'aaahealthy', { encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 1 } }] });
    await synthesizeBeing(house, 'mmmpoison0', { encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 2 } }] });
    await plantPoison('mmmpoison0');
    await synthesizeBeing(house, 'zzzhealthy', { encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 3 } }] });

    const { stdout, exitCode } = await runCli(['--all', '--execute', '--yes'], { root: house });
    expect(stdout).toMatch(/EXECUTE RESULT — all beings/);
    expect(stdout).toMatch(/migrated=2/);
    expect(stdout).toMatch(/skipped-cannot-decrypt=1/);
    expect(exitCode).toBe(1); // the skip needs an operator's eye
    // Both healthy beings got DEKs (incl. the one AFTER the skip); the poison
    // being was left entirely alone.
    expect(existsSync(path.join(house, 'aaahealthy', 'keys', 'dek.json'))).toBe(true);
    expect(existsSync(path.join(house, 'zzzhealthy', 'keys', 'dek.json'))).toBe(true);
    expect(existsSync(path.join(house, 'mmmpoison0', 'keys', 'dek.json'))).toBe(false);
  });

  it('--all --execute NAMES a dek-write-failed being in NEEDS ATTENTION (not just counted)', async () => {
    // A real DEK-write failure — the being's keys/ dir is read-only, so the
    // atomic dek.json write EACCES's. migrateBeing returns dek-write-failed
    // (a status distinct from aborted/failed); the sweep must name it, not
    // just bump the failed count. No mock — a real filesystem condition.
    await synthesizeBeing(house, 'okmigrate', { encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 1 } }] });
    await synthesizeBeing(house, 'writefail', { encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 2 } }] });
    await fs.chmod(path.join(house, 'writefail', 'keys'), 0o555);
    try {
      const { stdout, exitCode } = await runCli(['--all', '--execute', '--yes'], { root: house });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/NEEDS ATTENTION/);
      expect(stdout).toMatch(/dek-write-failed\s+writefail/); // NAMED, with its real status
      // The healthy being still migrated despite the other's failure.
      expect(existsSync(path.join(house, 'okmigrate', 'keys', 'dek.json'))).toBe(true);
    } finally {
      await fs.chmod(path.join(house, 'writefail', 'keys'), 0o755); // let cleanup remove the temp house
    }
  });

  it('--all --execute with a clean house migrates everyone and exits 0', async () => {
    await synthesizeBeing(house, 'clean001', { encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 1 } }] });
    await synthesizeBeing(house, 'clean002', { encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 2 } }] });
    const { stdout, exitCode } = await runCli(['--all', '--execute', '--yes'], { root: house });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/migrated=2/);
    expect(existsSync(path.join(house, 'clean001', 'keys', 'dek.json'))).toBe(true);
    expect(existsSync(path.join(house, 'clean002', 'keys', 'dek.json'))).toBe(true);
  });

  it('--all --execute prompt: typing "no" aborts the batch with zero writes', async () => {
    await synthesizeBeing(house, 'allno001', { encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 1 } }] });
    const { stdout, exitCode } = await runCli(['--all', '--execute'], { root: house, input: 'no\n' });
    expect(exitCode).toBe(0); // a deliberate decline is not a failure
    expect(stdout).toMatch(/aborted by operator/);
    expect(existsSync(path.join(house, 'allno001', 'keys', 'dek.json'))).toBe(false);
  });

  it('--all --execute on an already-migrated house says nothing to do and exits 0', async () => {
    await synthesizeBeing(house, 'donedone', { encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 1 } }] });
    await migrateBeing(workspace, 'donedone');
    const { stdout, exitCode } = await runCli(['--all', '--execute', '--yes'], { root: house });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/nothing to migrate/);
  });

  it('--all and --being together exit 2 (mutually exclusive)', async () => {
    const { stderr, exitCode } = await runCli(['--all', '--execute', '--being=x'], { root: house });
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/mutually exclusive/);
  });
});
