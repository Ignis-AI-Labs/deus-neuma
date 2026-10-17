// Real encrypted temp files and asynchronous transform inputs. No mocked IO.
import fs from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { beforeEach, afterEach, expect, test } from 'vitest';
import workspace, { getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey, parseAndDecrypt } from '../../core/workspace/workspace-crypto.js';
import { addAllowedTool, addGrantedReadRoot, addGrantedWriteRoot, removeAllowedTool } from '../../backend/services/tool-policy.js';
import { addSensitiveGrant } from '../../backend/services/sensitive-grants.js';

const LANE = 'permission-transaction-fixture';
let root, oldRoot, oldWitnesses, oldKey, file;
const input = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'permission-transactions-'));
  oldRoot = workspace.root;
  oldWitnesses = getWitnessesRoot();
  oldKey = process.env.DNA_ENCRYPTION_KEY;
  workspace.root = path.join(root, 'lanes');
  setWitnessesRoot(path.join(root, 'witnesses'));
  process.env.DNA_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  resetWorkspaceCryptoKey();
  file = path.join(workspace.pathFor(LANE), 'config', 'tool-policy.json');
});

afterEach(async () => {
  workspace._toolPolicyCache?.delete(file);
  workspace._dekCache.delete(LANE);
  workspace.root = oldRoot;
  setWitnessesRoot(oldWitnesses);
  if (oldKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = oldKey;
  resetWorkspaceCryptoKey();
  await fs.rm(root, { recursive: true, force: true });
});

test('parallel updates preserve every family and cannot resurrect an earlier revoked execute', async () => {
  await workspace.writeNeumaDEK(LANE, randomBytes(32).toString('hex'));
  await workspace.writeToolPolicy(LANE, { coding: { allowed: ['execute', 'ground_git'] } });
  await workspace.readToolPolicy(LANE); // prime the real envelope cache
  const started = input(), supplied = input();
  const first = workspace.updateToolPolicy(LANE, async (policy) => {
    started.resolve();
    return addAllowedTool(policy, 'web', await supplied.promise);
  });
  await started.promise;
  const revoke = workspace.updateToolPolicy(LANE, (policy) => removeAllowedTool(policy, 'coding', 'execute'));
  const updates = [
    (p) => addGrantedReadRoot(p, '/fixture/read'),
    (p) => addGrantedWriteRoot(p, '/fixture/write'),
    (p) => addSensitiveGrant(p, 'read', '/fixture/.env'),
    (p) => addSensitiveGrant(p, 'edit', '/fixture/.env'),
    (p) => ({ ...p, shellNetwork: true }),
    ...Array.from({ length: 12 }, (_, i) => (p) => addAllowedTool(p, 'fixture', `tool-${i}`)),
  ].map((transform) => workspace.updateToolPolicy(LANE, transform));
  supplied.resolve('web_search');
  await Promise.all([first, revoke, ...updates]);
  const policy = await workspace.readToolPolicy(LANE);
  expect(policy.coding.allowed).toEqual(['ground_git']);
  expect(policy.web.allowed).toEqual(['web_search']);
  expect(policy.fixture.allowed).toHaveLength(12);
  expect(policy.pathGrants).toEqual({ read: ['/fixture/read'], write: ['/fixture/write'] });
  expect(policy.sensitiveGrants).toEqual({ read: ['/fixture/.env'], edit: ['/fixture/.env'] });
  expect(policy.shellNetwork).toBe(true);
  const bytes = await fs.readFile(file, 'utf8');
  expect(JSON.parse(bytes)._enc).toBe(1);
  expect(bytes).not.toContain('ground_git');
  expect(parseAndDecrypt(bytes, { key: await workspace.readNeumaDEK(LANE) })).toEqual(policy);
  expect(await fs.readdir(path.dirname(file))).toEqual(['tool-policy.json']);
});

test('reads, replacements and updates share the existing facade file queue in call order', async () => {
  await workspace.writeToolPolicy(LANE, { revision: 0 });
  const started = input(), supplied = input();
  const blocker = workspace._withFileLock(file, async () => { started.resolve(); await supplied.promise; });
  await started.promise;
  let readFinished = false;
  const replace = workspace.writeToolPolicy(LANE, { revision: 1 });
  const read = workspace.readToolPolicy(LANE).then((value) => { readFinished = true; return value; });
  const update = workspace.updateToolPolicy(LANE, (current) => ({ revision: current.revision + 1 }));
  // A separate policy file makes real IO progress while this one stays queued.
  await workspace.writeToolPolicy('independent-fixture', { revision: 100 });
  expect(readFinished).toBe(false);
  supplied.resolve();
  await blocker;
  await replace;
  expect(await read).toEqual({ revision: 1 });
  await update;
  expect(await workspace.readToolPolicy(LANE)).toEqual({ revision: 2 });
  const detached = await workspace.readToolPolicy(LANE);
  detached.revision = 999;
  expect(await workspace.readToolPolicy(LANE)).toEqual({ revision: 2 });
});

test('new-turn reads wait for runtime invalidation even after the encrypted rename', async () => {
  await workspace.writeToolPolicy(LANE, { coding: { allowed: ['execute'] } });
  const committed = input(), invalidate = input();
  let runtimeGrant = true, readFinished = false;
  const revoke = workspace.updateToolPolicy(LANE, (p) => removeAllowedTool(p, 'coding', 'execute'), {
    afterCommit: async () => { committed.resolve(); await invalidate.promise; runtimeGrant = false; },
  });
  await committed.promise;
  const read = workspace.readToolPolicy(LANE).then((p) => { readFinished = true; return p; });
  expect(parseAndDecrypt(await fs.readFile(file, 'utf8')).coding.allowed).not.toContain('execute');
  expect(readFinished).toBe(false);
  invalidate.resolve();
  await revoke;
  expect((await read).coding.allowed).not.toContain('execute');
  expect(runtimeGrant).toBe(false);
});

test('ENOENT alone is absence; malformed JSON, corrupt encryption and directory reads fail closed', async () => {
  expect(await workspace.readToolPolicy(LANE)).toBeNull();
  await workspace.writeToolPolicy(LANE, { coding: { allowed: ['execute'] } });
  await workspace.readToolPolicy(LANE);
  for (const bytes of ['{broken', JSON.stringify({ _enc: 1, iv: 'bad', tag: 'bad', ct: 'bad' })]) {
    await fs.writeFile(file, bytes);
    await expect(workspace.readToolPolicy(LANE)).rejects.toThrow();
    await expect(workspace.updateToolPolicy(LANE, (p) => addAllowedTool(p, 'web', 'web_search'))).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  }
  await fs.unlink(file);
  await fs.mkdir(file);
  await expect(workspace.readToolPolicy(LANE)).rejects.toThrow();
  await expect(workspace.updateToolPolicy(LANE, () => ({}))).rejects.toThrow();
});

test('a failed transform or cancelled queued update leaves the policy intact and the queue usable', async () => {
  await workspace.writeToolPolicy(LANE, { revision: 0 });
  await expect(workspace.updateToolPolicy(LANE, () => { throw new Error('invalid input'); })).rejects.toThrow('invalid input');
  const supplied = input(), started = input(), controller = new AbortController();
  const first = workspace.updateToolPolicy(LANE, async (p) => {
    started.resolve(); await supplied.promise; return { ...p, revision: 1 };
  });
  await started.promise;
  const cancelled = workspace.updateToolPolicy(LANE, () => ({ revision: 99 }), { signal: controller.signal });
  const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  supplied.resolve();
  await first;
  await rejected;
  expect(await workspace.readToolPolicy(LANE)).toEqual({ revision: 1 });
});

test.each(['abort', 'guard', 'root'])('%s at the actual pre-rename boundary cleans the temp file', async (action) => {
  await workspace.writeToolPolicy(LANE, { revision: 0 });
  const original = await fs.readFile(file, 'utf8');
  const controller = new AbortController();
  let reachedTemp = false;
  const pending = workspace.updateToolPolicy(LANE, () => ({ revision: 1 }), {
    signal: controller.signal,
    beforeCommit: () => {
      if (!readdirSync(path.dirname(file)).some((name) => name.endsWith('.tmp'))) return;
      reachedTemp = true;
      if (action === 'abort') controller.abort();
      if (action === 'guard') throw new Error('origin no longer current');
      if (action === 'root') workspace.root = path.join(root, 'other-lanes');
    },
  });
  await expect(pending).rejects.toThrow();
  expect(reachedTemp).toBe(true);
  expect(await fs.readFile(file, 'utf8')).toBe(original);
  expect(await fs.readdir(path.dirname(file))).toEqual(['tool-policy.json']);
});

test('a witness-ground switch during an async transform refuses both destinations', async () => {
  const laneId = 'witness-fixture-Policy';
  await workspace.writeToolPolicy(laneId, { revision: 0 });
  const originalPath = path.join(workspace.pathFor(laneId), 'config', 'tool-policy.json');
  const pending = workspace.updateToolPolicy(laneId, async () => {
    setWitnessesRoot(path.join(root, 'other-witnesses'));
    return { revision: 1 };
  });
  await expect(pending).rejects.toThrow('root changed');
  expect(parseAndDecrypt(await fs.readFile(originalPath, 'utf8'))).toEqual({ revision: 0 });
  expect(await workspace.readToolPolicy(laneId)).toBeNull();
});

test('two-argument encrypted JSON consumers still write and decrypt normally', async () => {
  const target = path.join(workspace.pathFor(LANE), 'config', 'settings.json');
  await workspace._writeJSON(target, { ordinary: true });
  expect(await workspace._readJSON(target)).toEqual({ ordinary: true });
});
