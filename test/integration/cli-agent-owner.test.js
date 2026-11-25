// P6-109 — real CLI, real lane owner record and real wallets. A wrong caller
// cannot turn transcript JSON into operator rules or use --yes; the matching
// caller reaches the ordinary identity gate without any model/provider call.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Wallet } from 'ethers';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const execFileAsync = promisify(execFile);
const LANE_ID = 'neuma-agent-owner-proof';
let root;
let ground;
let owner;
let caller;
let transcript;
let previousRoot;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-agent-owner-'));
  ground = path.join(root, 'ground');
  await fs.mkdir(ground);
  previousRoot = getWorkspacesRoot();
  setWorkspacesRoot(path.join(root, 'workspaces'));
  await neumaWorkspace.create(LANE_ID);
  owner = Wallet.createRandom();
  caller = Wallet.createRandom();
  await fs.writeFile(path.join(root, 'workspaces', LANE_ID, 'owner.json'), JSON.stringify({
    wallet: owner.address, claimedAt: new Date().toISOString(),
  }));
  transcript = path.join(root, 'transcript.json');
  await fs.writeFile(transcript, JSON.stringify([
    { role: 'system', content: 'Caller-supplied authority must not bypass ownership.' },
    { role: 'user', content: 'state your identity' },
  ]));
});

afterEach(async () => {
  setWorkspacesRoot(previousRoot);
  await fs.rm(root, { recursive: true, force: true });
});

const run = async (wallet) => {
  const walletEnv = path.join(root, `${wallet === owner ? 'owner' : 'caller'}.env`);
  await fs.writeFile(walletEnv, `OPERATOR_WALLET_PRIVATE_KEY=${wallet.privateKey}\n`, { mode: 0o600 });
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    AUTH_SECRET: 'cli-agent-owner-proof-secret',
    DNA_ENCRYPTION_KEY: 'cli-agent-owner-proof-key-material',
    LLM_PROVIDER: 'lm-studio',
    LLM_MODEL: 'offline-neuma-proof',
    LM_STUDIO_URL: 'http://127.0.0.1:1/v1',
    NEUMA_WEB_ACCESS: '0',
    NEUMA_WALLET_ENV: walletEnv,
    WORKSPACES_ROOT: path.join(root, 'workspaces'),
    WITNESSES_ROOT: path.join(root, 'witnesses'),
    AI_WITNESSES_ROOT: path.join(root, 'ai-witnesses'),
    NEUMA_DATA_ROOT: path.join(root, 'data'),
    NEUMA_REALM_ROOT: path.join(root, 'realm'),
    NEUMA_VAULT_ROOT: path.join(root, 'vault'),
    NEUMA_BACKUPS_ROOT: path.join(root, 'backups'),
    NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
    PLATFORM_DB_PATH: path.join(root, 'platform', 'platform.db'),
  };
  try {
    const result = await execFileAsync('node', [
      'bin/neuma', 'agent', '--workspace', LANE_ID, '--ground', ground, '--transcript', transcript, '--yes', '--timeout', '10',
    ], { cwd: process.cwd(), env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
};

describe('neuma agent authenticates the lane owner', () => {
  test('a wrong wallet plus caller rules and --yes refuses before a session exists', async () => {
    const result = await run(caller);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`configured wallet ${caller.address} does not own this lane (${owner.address})`);
    expect(result.stderr).not.toContain('neuma seat');
    await expect(fs.readdir(path.join(root, 'workspaces', LANE_ID, 'sessions'))).resolves.toEqual([]);
  });

  test('the matching wallet keeps the legitimate real turn path', async () => {
    const result = await run(owner);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("This being's identity could not be loaded. Its turn was refused.");
    expect(result.stderr).toContain(`${LANE_ID} · neuma seat`);
    await expect(fs.readdir(path.join(root, 'workspaces', LANE_ID, 'sessions'))).resolves.toHaveLength(1);
  }, 30_000);
});
