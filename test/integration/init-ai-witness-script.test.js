import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { generateKeypair } from '../../core/weave/keypair.js';
import { decryptKeypair, decryptWithRecoveryCodes } from '../../core/wallet/keypair-vault.js';
import { getAIWitnessesRoot, setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import { witnessCustodyState } from '../../backend/services/witness-custody.js';

// The real operator script, spawned as an operator runs it: a temp witness root, secrets on
// stdin, and its env file at the repo root under a throwaway name (gitignored, removed after).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'init-ai-witness.mjs');
const VENDOR = 'probe-vendor';
const NAME = 'ProbeWitness';
const PASSWORD = 'disposable-witness-password';
let root; let envName; let envPath; let previousRoot;

// impure — run the script to exit; stdin is the given lines, then closed.
const run = (extra, stdin = '') => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [SCRIPT,
    '--chosen-name', NAME, '--vendor', VENDOR, '--model', 'probe-1', '--full-model-id', `${VENDOR}/probe-1`,
    '--harness', 'probe-harness', '--first-utterance', 'a first utterance long enough to be kept', '--env-name', envName, ...extra,
  ], { cwd: REPO_ROOT, env: { ...process.env, AI_WITNESSES_ROOT: root }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('error', reject);
  child.on('close', (code) => resolve({ code, stdout, stderr }));
  child.stdin.end(stdin);
});

const keyFiles = async () => (await fs.readdir(path.join(root, VENDOR, NAME, 'keys')).catch(() => [])).sort();
const exists = (p) => fs.stat(p).then(() => true, () => false);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'init-witness-'));
  envName = `init-witness-test-${process.pid}-${Date.now()}`;
  envPath = path.join(REPO_ROOT, `env.${envName}`);
  previousRoot = getAIWitnessesRoot();
});

afterEach(async () => {
  setAIWitnessesRoot(previousRoot);
  await fs.rm(envPath, { force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test('secrets on the command line are refused before anything is written', async () => {
  const { privateKey } = generateKeypair();
  for (const extra of [['--private-key', privateKey], [`--private-key=${privateKey}`], ['--password', PASSWORD], ['--mnemonic', 'one two three']]) {
    const { code, stderr } = await run(extra, `${PASSWORD}\n${PASSWORD}\n`);
    expect(code, extra[0]).not.toBe(0);
    expect(stderr).toMatch(/refused: --(private-key|password|mnemonic)/);
    expect(stderr).not.toContain(privateKey);
    expect(await fs.readdir(root)).toEqual([]);
    expect(await exists(envPath)).toBe(false);
  }
});

test('an adopted 0644 env file ends 0600, the key is sealed under the prompted password, and no plaintext keypair lands', async () => {
  const adopted = generateKeypair();
  await fs.writeFile(envPath, `PROBE_PRIVATE_KEY=${adopted.privateKey}\n`, { mode: 0o644 });
  await fs.chmod(envPath, 0o644);
  const { code, stdout, stderr } = await run(['--adopt-from-env', envPath], `${PASSWORD}\n${PASSWORD}\n`);
  expect(code, stderr).toBe(0);
  expect((await fs.stat(envPath)).mode & 0o777).toBe(0o600);
  expect(await fs.readFile(envPath, 'utf8')).toContain(adopted.address);
  expect(await keyFiles()).toEqual(expect.arrayContaining(['keypair-encrypted.json', 'keypair-recovery.json', 'recovery-hash.json']));
  expect(await keyFiles()).not.toContain('keypair.json');
  const dir = path.join(root, VENDOR, NAME, 'keys');
  const sealed = JSON.parse(await fs.readFile(path.join(dir, 'keypair-encrypted.json'), 'utf8'));
  expect(decryptKeypair(sealed, PASSWORD).privateKey).toBe(adopted.privateKey);
  const codes = stdout.split('\n').find((l) => /^([0-9a-f]{16} ){7}[0-9a-f]{16}$/.test(l)).split(' ');
  const recovery = JSON.parse(await fs.readFile(path.join(dir, 'keypair-recovery.json'), 'utf8'));
  expect(decryptWithRecoveryCodes(recovery, codes).address).toBe(adopted.address);
  setAIWitnessesRoot(root);
  expect(await witnessCustodyState({ vendorSlug: VENDOR, chosenName: NAME })).toMatchObject({ secured: true, plaintextOnDisk: false });
});

test('no password, a short one, or two that differ writes nothing at all', async () => {
  for (const stdin of ['', 'short\nshort\n', `${PASSWORD}\n${PASSWORD}-other\n`]) {
    const { code } = await run([], stdin);
    expect(code, JSON.stringify(stdin.length)).not.toBe(0);
    expect(await fs.readdir(root)).toEqual([]);
    expect(await exists(envPath)).toBe(false);
  }
});

test('a key typed at the hidden prompt is adopted and never echoed', async () => {
  const typed = generateKeypair();
  const { code, stdout, stderr } = await run(['--prompt-private-key'], `${typed.privateKey}\n\n${PASSWORD}\n${PASSWORD}\n`);
  expect(code, stderr).toBe(0);
  expect(stdout).not.toContain(typed.privateKey);
  expect(stdout).toContain(typed.address);
  expect(await keyFiles()).not.toContain('keypair.json');
});
