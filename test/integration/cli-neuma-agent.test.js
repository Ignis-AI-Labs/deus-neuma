/**
 * `neuma agent` neuma-seat proof without a substrate (RULE 0).
 *
 * The real CLI process loads an isolated sovereign root, starts the real MCP
 * filesystem server, enters `streamConsciousness`, and is refused by the real
 * identity gate because the deliberately incomplete lane has no DNA. No
 * provider, filesystem, command, or portal seam is mocked. This proves the
 * command reaches the neuma path — never the witness path — while the live
 * model sitting remains the GPU-window proof named in #301.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import neumaWorkspace, {
  getWorkspacesRoot, setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { solidPngDataUri } from '../helpers/image-fixtures.js';

const execFileAsync = promisify(execFile);
const LANE_ID = 'neuma-agent-identity-proof';
let root;
let workspacesRoot;
let ground;
let previousRoot;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-agent-path-'));
  workspacesRoot = path.join(root, 'workspaces');
  // A small, explicit ground: the command's subject is the identity gate, and
  // a repo-sized ground would pay full coding-shell provisioning (~16 s over
  // this repo, issue #530) before the refusal it exists to prove.
  ground = path.join(root, 'ground');
  await fs.mkdir(ground);
  previousRoot = getWorkspacesRoot();
  setWorkspacesRoot(workspacesRoot);
  await neumaWorkspace.create(LANE_ID);
  await fs.writeFile(path.join(workspacesRoot, LANE_ID, 'owner.json'), `${JSON.stringify({
    wallet: '0x0000000000000000000000000000000000000001',
    claimedAt: new Date().toISOString(),
  }, null, 2)}\n`);
});

afterEach(async () => {
  setWorkspacesRoot(previousRoot);
  await fs.rm(root, { recursive: true, force: true });
});

describe('neuma agent — real neuma turn entry', () => {
  test('an identity-less local lane is refused by the neuma identity gate', async () => {
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      AUTH_SECRET: 'cli-neuma-agent-proof-secret',
      DNA_ENCRYPTION_KEY: 'cli-neuma-agent-proof-key-material',
      LLM_PROVIDER: 'lm-studio',
      LLM_MODEL: 'offline-neuma-proof',
      LM_STUDIO_URL: 'http://127.0.0.1:1/v1',
      NEUMA_WEB_ACCESS: '0',
      WORKSPACES_ROOT: workspacesRoot,
      WITNESSES_ROOT: path.join(root, 'witnesses'),
      AI_WITNESSES_ROOT: path.join(root, 'ai-witnesses'),
      NEUMA_DATA_ROOT: path.join(root, 'data'),
      NEUMA_REALM_ROOT: path.join(root, 'realm'),
      NEUMA_VAULT_ROOT: path.join(root, 'vault'),
      NEUMA_BACKUPS_ROOT: path.join(root, 'backups'),
      NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
      PLATFORM_DB_PATH: path.join(root, 'platform', 'platform.db'),
    };

    let failure;
    try {
      await execFileAsync('node', [
        'bin/neuma', 'agent', 'state your identity', '--workspace', LANE_ID, '--timeout', '15', '--ground', ground,
      ], { cwd: process.cwd(), env, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    } catch (error) {
      failure = error;
    }

    expect(failure?.code).toBe(1);
    // The identity refusal's lawful surface (7457d6a9b): the being's own
    // notice, never the generic disruption line a provider outage gets.
    expect(failure?.stdout).toContain("This being's identity could not be loaded. Its turn was refused.");
    expect(failure?.stdout).not.toMatch(/\[MCP\]|\bINF\b/);
    expect(failure?.stderr).toContain("This being's identity could not be loaded");
    expect(failure?.stderr).toContain(`${LANE_ID} · neuma seat`);
    expect(failure?.stderr).not.toMatch(/sealed witness|witness seat/i);
    expect(await fs.readdir(path.join(workspacesRoot, LANE_ID, 'sessions'))).toHaveLength(1);
  }, 30_000);

  // The flag validation fires BEFORE the lane loads, so these proofs run the
  // same real CLI process without needing identity on disk.
  const runWithFlags = (flags, extraEnv = {}) => execFileAsync('node', [
    'bin/neuma', 'agent', 'state your identity', '--workspace', LANE_ID, '--timeout', '15', '--ground', ground, ...flags,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      AUTH_SECRET: 'cli-neuma-agent-proof-secret',
      DNA_ENCRYPTION_KEY: 'cli-neuma-agent-proof-key-material',
      LLM_PROVIDER: 'lm-studio',
      LLM_MODEL: 'offline-neuma-proof',
      LM_STUDIO_URL: 'http://127.0.0.1:1/v1',
      NEUMA_WEB_ACCESS: '0',
      WORKSPACES_ROOT: workspacesRoot,
      WITNESSES_ROOT: path.join(root, 'witnesses'),
      AI_WITNESSES_ROOT: path.join(root, 'ai-witnesses'),
      NEUMA_DATA_ROOT: path.join(root, 'data'),
      NEUMA_REALM_ROOT: path.join(root, 'realm'),
      NEUMA_VAULT_ROOT: path.join(root, 'vault'),
      NEUMA_BACKUPS_ROOT: path.join(root, 'backups'),
      NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
      PLATFORM_DB_PATH: path.join(root, 'platform', 'platform.db'),
      ...extraEnv,
    },
    timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  }).then(
    (result) => ({ failure: null, result }),
    (failure) => ({ failure, result: null }),
  );

  test('--benchmark-format-echo without the decoding controls is refused before any turn', async () => {
    const { failure } = await runWithFlags(['--benchmark-format-echo']);
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).toContain('--benchmark-format-echo requires the benchmark decoding controls');
  }, 30_000);

  test('--benchmark-format-echo with the full decoding controls is accepted and reaches the neuma path', async () => {
    const { failure } = await runWithFlags([
      '--benchmark-format-echo',
      '--benchmark-base-weights',
      '--benchmark-seed', '7',
      '--benchmark-temperature', '0',
      '--benchmark-top-p', '1',
      '--benchmark-max-tokens', '2048',
    ]);
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).not.toContain('--benchmark-format-echo requires');
    expect(failure?.stderr).toContain(`${LANE_ID} · neuma seat`);
  }, 30_000);

  // THE HARNESS ARM (ruling, 2026-09-29): --platform-only is benchmark-gated, and a
  // declared sitting's receipt says identity layers are OFF — even on this
  // identity-gate refusal, the receipt written on every exit carries it.
  test('--platform-only is refused outside a benchmark sitting and declares identity off in the receipt', async () => {
    const refused = await runWithFlags(['--platform-only']);
    expect(refused.failure?.code).toBe(1);
    expect(refused.failure?.stderr).toContain('--platform-only is a benchmark arm');

    const receiptPath = path.join(root, 'platform-only-receipt.json');
    const declared = await runWithFlags([
      '--platform-only', '--benchmark-base-weights',
      '--benchmark-seed', '7', '--benchmark-temperature', '0',
      '--benchmark-top-p', '1', '--benchmark-max-tokens', '2048',
      '--receipt', receiptPath,
    ]);
    expect(declared.failure?.code).toBe(1);
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    expect(receipt.identityLayers).toBe('off');
    // Every benchmark receipt tallies acts the injected-value gate held (none here).
    expect(receipt.taintHeld).toBe(0);
  }, 60_000);

  // The refinement layers (#531), declared-only: the flags ride the real CLI
  // onto the connection and into the receipt written on EVERY exit — even
  // this identity-gate refusal — while an undeclared run's receipt keeps its
  // exact former shape (no layer keys at all).
  test('declared refinement layers reach the receipt; undeclared runs omit them', async () => {
    const receiptPath = path.join(root, 'layers-receipt.json');
    const { failure } = await runWithFlags([
      '--supervisor', '--verify-answer', '--receipt', receiptPath,
    ]);
    expect(failure?.code).toBe(1);
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    expect(receipt.completed).toBe(false);
    expect(receipt.supervisor).toEqual({ redirects: 0 });
    expect(receipt.answerVerify).toEqual({ verdict: null });

    const plainPath = path.join(root, 'plain-receipt.json');
    const plain = await runWithFlags(['--receipt', plainPath]);
    expect(plain.failure?.code).toBe(1);
    const plainReceipt = JSON.parse(await fs.readFile(plainPath, 'utf8'));
    expect(plainReceipt.supervisor).toBeUndefined();
    expect(plainReceipt.answerVerify).toBeUndefined();
  }, 60_000);

  // The benchmark tool scope (L0, #531): a DECLARED arm's receipt proves
  // which widened policy it sat with; --yes alone keeps the old line and no
  // scope key.
  test('the widened tool scope rides a declared benchmark receipt only', async () => {
    const scopePath = path.join(root, 'scope-receipt.json');
    const declared = await runWithFlags([
      '--yes', '--benchmark-base-weights',
      '--benchmark-seed', '7', '--benchmark-temperature', '0',
      '--benchmark-top-p', '1', '--benchmark-max-tokens', '2048',
      '--receipt', scopePath,
    ]);
    expect(declared.failure?.code).toBe(1);
    const receipt = JSON.parse(await fs.readFile(scopePath, 'utf8'));
    expect(receipt.benchmark.toolScope).toEqual([
      'fs/list', 'fs/read', 'fs/write', 'fs/edit', 'fs/search',
      'coding/execute', 'coding/shell_network', 'coding/ground_git', 'map/read_history',
    ]);

    const yesOnlyPath = path.join(root, 'yes-only-receipt.json');
    const yesOnly = await runWithFlags(['--yes', '--receipt', yesOnlyPath]);
    expect(yesOnly.failure?.code).toBe(1);
    const yesReceipt = JSON.parse(await fs.readFile(yesOnlyPath, 'utf8'));
    expect(yesReceipt.benchmark).toBeNull();
  }, 60_000);

  // The budget dial (L7, #531): declared on a real run it rides the receipt;
  // it refuses garbage values and refuses to share the wire with the
  // benchmark decoding controls.
  test('--budget rides the receipt, refuses garbage, and conflicts with benchmark controls', async () => {
    const budgetPath = path.join(root, 'budget-receipt.json');
    const declared = await runWithFlags(['--budget', '4096', '--receipt', budgetPath]);
    expect(declared.failure?.code).toBe(1);
    const receipt = JSON.parse(await fs.readFile(budgetPath, 'utf8'));
    expect(receipt.budget).toBe(4096);

    const garbage = await runWithFlags(['--budget', 'lots']);
    expect(garbage.failure?.code).toBe(1);
    expect(garbage.failure?.stderr).toContain('--budget must be a positive integer');

    const conflict = await runWithFlags([
      '--budget', '4096', '--benchmark-base-weights',
      '--benchmark-seed', '7', '--benchmark-temperature', '0',
      '--benchmark-top-p', '1', '--benchmark-max-tokens', '2048',
    ]);
    expect(conflict.failure?.code).toBe(1);
    expect(conflict.failure?.stderr).toContain('--budget cannot be combined with the benchmark decoding controls');
  }, 60_000);

  // THE DECLARED NETWORK GRANT (L0, #531): benchmark-gated — the flag is the
  // shell_network consent for a headless arm, recorded on the receipt;
  // without the benchmark controls it refuses instead of silently ignoring.
  test('--network is benchmark-gated and rides the receipt when declared', async () => {
    const without = await runWithFlags(['--network']);
    expect(without.failure?.code).toBe(1);
    expect(without.failure?.stderr).toContain('--network requires the benchmark decoding controls');

    const networkPath = path.join(root, 'network-receipt.json');
    const declared = await runWithFlags([
      '--network', '--receipt', networkPath,
      '--benchmark-base-weights',
      '--benchmark-seed', '7', '--benchmark-temperature', '0',
      '--benchmark-top-p', '1', '--benchmark-max-tokens', '2048',
    ]);
    expect(declared.failure?.code).toBe(1);
    const receipt = JSON.parse(await fs.readFile(networkPath, 'utf8'));
    expect(receipt.benchmark.shellNetwork).toBe(true);
  }, 60_000);

  // THE SENDER'S CALL SHAPE (BFCL v4, 2026-10-09): the receipt must record the
  // sampling that RAN. It recorded the declared controls instead, so a sender
  // that allowed parallel calls saw "parallelToolCalls" missing and the relay
  // refused all 1,240 requests of both agent arms as a stale subject.
  test('--caller-parallel rides the receipt sampling the relay checks; absent, it does not', async () => {
    const toolsPath = path.join(root, 'caller-tools.json');
    await fs.writeFile(toolsPath, JSON.stringify([{ type: 'function', function: {
      name: 'spotify_play', description: 'Play an artist.', parameters: { type: 'object', properties: { artist: { type: 'string' } } },
    } }]));
    const bench = ['--benchmark-base-weights', '--benchmark-seed', '7', '--benchmark-temperature', '0',
      '--benchmark-top-p', '1', '--benchmark-max-tokens', '2048', '--caller-tools', toolsPath];
    const parallelPath = path.join(root, 'parallel-receipt.json');
    await runWithFlags([...bench, '--caller-parallel', '--receipt', parallelPath]);
    const parallel = JSON.parse(await fs.readFile(parallelPath, 'utf8'));
    expect(parallel.benchmark.sampling.parallelToolCalls).toBe(true);
    const serialPath = path.join(root, 'serial-receipt.json');
    await runWithFlags([...bench, '--receipt', serialPath]);
    const serial = JSON.parse(await fs.readFile(serialPath, 'utf8'));
    expect(serial.benchmark.sampling.parallelToolCalls).toBeUndefined();
  }, 60_000);

  // VISION-PROOF (ruling, 2026-10-16): the relay's image item rides the portal's
  // attachment path. Redeemed for real (a lost id reads "expired"), it reaches
  // the vision gate; the repo's .env names a seeing substrate, so the proof
  // pins the machine default to a model with no sight.
  test('a transcript image reaches the portal\'s vision gate, and a blind route refuses it out loud', async () => {
    const transcript = path.join(root, 'image-transcript.json');
    await fs.writeFile(transcript, JSON.stringify([{ role: 'user', content: [
      { type: 'text', text: 'What number is shown?' },
      { type: 'image_url', image_url: { url: solidPngDataUri([0, 0, 0], 4, 4) } },
    ] }]));
    const receiptPath = path.join(root, 'image-receipt.json');
    const { failure } = await runWithFlags(['--transcript', transcript, '--receipt', receiptPath, '--benchmark-base-weights',
      '--benchmark-seed', '7', '--benchmark-temperature', '0', '--benchmark-top-p', '1', '--benchmark-max-tokens', '64'],
    { SUBSTRATE_MODEL: 'offline-neuma-proof' });
    expect(failure?.code).toBe(1);
    expect(failure?.stderr).toMatch(/\[Images not sent\] The current substrate \(.*\) cannot see images/);
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    expect(receipt.completed).toBe(false);
    expect(receipt.benchmark.imagesSent).toBeUndefined();
  }, 30_000);

  // THE SEAT LIVES IN ITS GROUND (L0, #531): the real runAgent chdirs into
  // the ground for the sitting and restores the caller's cwd afterwards —
  // and a RELATIVE --receipt resolves where the caller asked, never inside
  // the ground. Real command, real disk, refused by the real identity gate.
  test('the seat chdirs into the ground for the turn and restores the caller cwd', async () => {
    const envDoors = {
      AUTH_SECRET: 'cli-neuma-agent-proof-secret',
      DNA_ENCRYPTION_KEY: 'cli-neuma-agent-proof-key-material',
      LLM_PROVIDER: 'lm-studio',
      LLM_MODEL: 'offline-neuma-proof',
      LM_STUDIO_URL: 'http://127.0.0.1:1/v1',
      NEUMA_WEB_ACCESS: '0',
      NEUMA_DATA_ROOT: path.join(root, 'data'),
      NEUMA_REALM_ROOT: path.join(root, 'realm'),
      NEUMA_VAULT_ROOT: path.join(root, 'vault'),
      NEUMA_BACKUPS_ROOT: path.join(root, 'backups'),
      NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
      PLATFORM_DB_PATH: path.join(root, 'platform', 'platform.db'),
    };
    const saved = Object.fromEntries(Object.keys(envDoors).map((key) => [key, process.env[key]]));
    Object.assign(process.env, envDoors);
    // The caller sits in its OWN directory — distinct from the process cwd
    // and from the ground — so every relative resolution is observable.
    const callerCwd = path.join(root, 'caller');
    await fs.mkdir(callerCwd);
    const processCwdBefore = process.cwd();
    const stderrChunks = [];
    const stdoutChunks = [];
    const sink = (chunks) => ({ write: (chunk) => { chunks.push(String(chunk)); return true; } });
    try {
      const { runAgent } = await import('../../cli/commands/agent.js');
      const exitCode = await runAgent({
        cwd: callerCwd,
        stdin: null,
        stdout: sink(stdoutChunks),
        stderr: sink(stderrChunks),
        argv: { task: 'state your identity', workspace: LANE_ID, ground, timeout: '10', receipt: 'grounded-receipt.json' },
      });
      expect(exitCode).toBe(1);
      // The seat banner names the GROUND: the sitting stood where it was told.
      expect(stderrChunks.join('')).toContain(`neuma seat · ${ground}`);
      // The process cwd is exactly as it was left — no ground leakage into
      // an in-process caller (the benchmark proxy seats per request).
      expect(process.cwd()).toBe(processCwdBefore);
      // A RELATIVE receipt resolves against the CALLER's cwd argument, never
      // the ground the process temporarily lived in.
      const receipt = JSON.parse(await fs.readFile(path.join(callerCwd, 'grounded-receipt.json'), 'utf8'));
      expect(receipt.ground).toBe(ground);
      expect(receipt.completed).toBe(false);
      expect(await fs.stat(path.join(ground, 'grounded-receipt.json')).then(() => true).catch(() => false)).toBe(false);
    } finally {
      if (process.cwd() !== processCwdBefore) process.chdir(processCwdBefore);
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 60_000);

  test('agentCodeRevision names the running code (real git on the real checkout)', async () => {
    const { agentCodeRevision } = await import('../../cli/commands/agent.js');
    const rev = agentCodeRevision(process.cwd());
    expect(rev.head).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof rev.dirty).toBe('boolean');
    expect(agentCodeRevision(root)).toBeNull(); // not a checkout — said honestly
  });

  // N3 (#506, 2026-09-15): the request-24 crash shape — a turn refused by the
  // real identity gate emits an error-flagged speech frame plus a complete
  // frame and RETURNS, so the old tail exited 1 with stderr at banner-only
  // and no receipt reason. In-process (the real runAgent, real turn path, no
  // child process) the refusal must now name itself on stderr AND in the
  // receipt; a successful run's receipt shape is untouched.
  test('an errored turn exits 1 with its real reason on stderr and in the receipt', async () => {
    const envDoors = {
      AUTH_SECRET: 'cli-neuma-agent-proof-secret',
      DNA_ENCRYPTION_KEY: 'cli-neuma-agent-proof-key-material',
      LLM_PROVIDER: 'lm-studio',
      LLM_MODEL: 'offline-neuma-proof',
      LM_STUDIO_URL: 'http://127.0.0.1:1/v1',
      NEUMA_WEB_ACCESS: '0',
      NEUMA_DATA_ROOT: path.join(root, 'data'),
      NEUMA_REALM_ROOT: path.join(root, 'realm'),
      NEUMA_VAULT_ROOT: path.join(root, 'vault'),
      NEUMA_BACKUPS_ROOT: path.join(root, 'backups'),
      NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
      PLATFORM_DB_PATH: path.join(root, 'platform', 'platform.db'),
    };
    const saved = Object.fromEntries(Object.keys(envDoors).map((key) => [key, process.env[key]]));
    Object.assign(process.env, envDoors);
    const receiptPath = path.join(root, 'failure-receipt.json');
    const stderrChunks = [];
    const stdoutChunks = [];
    const sink = (chunks) => ({ write: (chunk) => { chunks.push(String(chunk)); return true; } });
    try {
      const { runAgent } = await import('../../cli/commands/agent.js');
      const exitCode = await runAgent({
        cwd: process.cwd(),
        stdin: null,
        stdout: sink(stdoutChunks),
        stderr: sink(stderrChunks),
        argv: { task: 'state your identity', workspace: LANE_ID, ground, timeout: '10', receipt: receiptPath },
      });

      expect(exitCode).toBe(1);
      const stderrText = stderrChunks.join('');
      expect(stderrText).toContain(`${LANE_ID} · neuma seat`);
      expect(stderrText).toContain('neuma agent: the turn ended in error');
      expect(stderrText).toContain("This being's identity could not be loaded");
      const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
      expect(receipt.completed).toBe(false);
      expect(receipt.error).toContain("This being's identity could not be loaded");
      expect(receipt.version).toBe(1);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 30_000);

  test('a caller\'s stop (argv.signal) ends the run 130 with a receipt — never an orphaned turn', async () => {
    const envDoors = {
      AUTH_SECRET: 'cli-neuma-agent-proof-secret',
      DNA_ENCRYPTION_KEY: 'cli-neuma-agent-proof-key-material',
      LLM_PROVIDER: 'lm-studio',
      LLM_MODEL: 'offline-neuma-proof',
      LM_STUDIO_URL: 'http://127.0.0.1:1/v1',
      NEUMA_WEB_ACCESS: '0',
      NEUMA_DATA_ROOT: path.join(root, 'data'),
      NEUMA_REALM_ROOT: path.join(root, 'realm'),
      NEUMA_VAULT_ROOT: path.join(root, 'vault'),
      NEUMA_BACKUPS_ROOT: path.join(root, 'backups'),
      NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
      PLATFORM_DB_PATH: path.join(root, 'platform', 'platform.db'),
    };
    const saved = Object.fromEntries(Object.keys(envDoors).map((key) => [key, process.env[key]]));
    Object.assign(process.env, envDoors);
    const receiptPath = path.join(root, 'stopped-receipt.json');
    const stderrChunks = [];
    const stdoutChunks = [];
    const sink = (chunks) => ({ write: (chunk) => { chunks.push(String(chunk)); return true; } });
    try {
      const { runAgent } = await import('../../cli/commands/agent.js');
      const exitCode = await runAgent({
        cwd: process.cwd(),
        stdin: null,
        stdout: sink(stdoutChunks),
        stderr: sink(stderrChunks),
        // benchmarks-51, 2026-10-02: a stopped benchmark run held a looping
        // model stream open until its 30-minute deadline.
        argv: { task: 'state your identity', workspace: LANE_ID, ground, timeout: '10', receipt: receiptPath, signal: AbortSignal.abort() },
      });

      expect(exitCode).toBe(130);
      expect(stderrChunks.join('')).toContain('neuma agent: the turn ended in error — stopped by the caller');
      const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
      expect(receipt.completed).toBe(false);
      expect(receipt.error).toBe('stopped by the caller');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 30_000);
});
