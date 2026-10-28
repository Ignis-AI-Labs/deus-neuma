// Real signed portal, native filesystem, encrypted policy and bwrap commands.
// No model, mock, spy, substituted IO or fabricated approval decision.
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { beforeEach, afterEach, expect, test } from 'vitest';
import { getRoots, setRoots } from '../../backend/services/user-files.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { readExecutionToolPolicy } from '../../backend/services/execution-tool-policy.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { processWitnessToolCalls, toolsForWitness } from '../../backend/services/witness-tools.js';
import { beingCodingToolsFor, stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { ensureWitnessCodingSandbox } from '../../backend/services/witness-coding-sandbox.js';
import { captureShellNetwork, requestShellNetwork, clearShellNetwork } from '../../backend/services/shell-network-grants.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { mcpService } from '../../backend/services/mcp.js';
import { withFsPrimitives } from '../../backend/services/fs-primitives.js';
import { readActs } from '../../backend/services/act-ledger.js';
import { sweepBatchIntents } from '../../backend/services/intents/intent-sweep.js';

const PRIVATE_SENTINEL = 'PRIVATE_POLICY_CONTENT_MUST_NOT_SURFACE';
const FAILURE = Object.freeze({ code: 'TOOL_POLICY_UNREADABLE',
  message: 'Tool policy is unreadable; execution is unavailable.' });
let kit, oldKey, cards, seat;
let priorRoots = null;
const policyFile = () => path.join(workspace.pathFor(kit.laneId), 'config', 'tool-policy.json');
const call = (server, toolName, args) => ({ server, toolName, tool: `${server}/${toolName}`, args });
const run = (calls) => seat === 'witness'
  ? processWitnessToolCalls(kit.ws, kit.connection, calls, kit.connection._turnCatalog, kit.connection._turnSandbox)
  : processToolCalls(kit.ws, '', kit.connection, calls);
const flushFrames = async () => {
  const pong = once(kit.ws, 'pong');
  kit.ws.ping();
  await pong;
};

beforeEach(() => {
  oldKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  resetWorkspaceCryptoKey();
  cards = 0;
});

afterEach(async () => {
  try {
    if (kit) {
      clearShellNetwork(kit.connection);
      await untilHarness(async () => (await readActs()).length >= cards);
    }
  } finally {
    try { await kit?.close(); }
    finally {
      if (priorRoots) setRoots(priorRoots);
      priorRoots = null;
      kit = null;
      if (oldKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
      else process.env.DNA_ENCRYPTION_KEY = oldKey;
      resetWorkspaceCryptoKey();
    }
  }
});

const open = async (kind = 'neuma') => {
  seat = kind;
  kit = await createHarnessTurnKit(kind === 'witness' ? 'witness-fixture-Unreadable' : 'policy-unreadable-fixture');
  kit.connection.toolWorkspace = kit.ground;
  kit.connection.toolMode = 'auto';
  // The ground stands OPEN in the Explorer, as a focused desk has it: since
  // SEC-038 (fd1498261) a focus ground reaches the filesystem organ only as
  // an opened root, never merely by being named (#566).
  priorRoots = getRoots();
  setRoots([...priorRoots, kit.ground]);
  // The fixture operator answers through the real authenticated portal. If a
  // broken policy wrongly raises a card, ALWAYS exposes any attempted widening.
  kit.client.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame.type !== 'tool:approval_request') return;
    cards++;
    kit.decide(frame, frame.tool === 'coding/shell_network' ? 'deny' : 'always');
  });
  await connectFilesystemServer();
};

const prepare = async () => {
  if (seat === 'witness') return toolsForWitness(kit.connection, kit.ground);
  const coding = await beingCodingToolsFor(kit.connection);
  return stashBeingTurnCatalog(kit.connection,
    [...withFsPrimitives(mcpService.getToolsContext().available_tools), ...coding], []);
};

// Start with a real encrypted denial document, then damage its bytes on disk.
const corruptPolicy = async (kind) => {
  await workspace.writeToolPolicy(kit.laneId, {
    fs: { denied: ['write'] }, coding: { denied: ['execute', 'inspect'] },
    intents: { denied: ['tasks.add'] },
  });
  await workspace.readToolPolicy(kit.laneId); // cached denial cannot hide corrupt disk
  const envelope = JSON.parse(await fs.readFile(policyFile(), 'utf8'));
  expect(envelope._enc).toBe(1);
  let bytes;
  if (kind === 'syntax') {
    bytes = `{"private":"${PRIVATE_SENTINEL}","_enc":1,broken`;
  } else {
    const ciphertext = Buffer.from(envelope.ct, 'base64');
    ciphertext[0] ^= 255;
    bytes = JSON.stringify({ ...envelope, ct: ciphertext.toString('base64') });
  }
  await fs.writeFile(policyFile(), bytes);
  return bytes;
};

test.each([
  ['neuma', 'syntax'], ['neuma', 'authentication'],
  ['witness', 'syntax'], ['witness', 'authentication'],
])('%s refuses %s policy damage before filesystem, command or approval widening', async (kind, corruption) => {
  await open(kind);
  await workspace.writeToolPolicy(kit.laneId, { coding: { allowed: ['execute'] } });
  await prepare();
  const baselineFile = path.join(kit.ground, 'baseline.txt');
  expect((await run([call('fs', 'write', { path: baselineFile, content: 'baseline' })]))[0].status).toBe('ok');
  expect(await fs.readFile(baselineFile, 'utf8')).toBe('baseline');
  expect((await run([call('coding', 'execute', { command: 'printf baseline > command-baseline.txt' })]))[0].status).toBe('ok');
  const upper = kit.connection._turnSandbox.workspace;
  // AUTO in the open folder: the shell works on the folder itself (open-folder-autonomy.js)
  expect(await fs.readFile(path.join(kit.ground, 'command-baseline.txt'), 'utf8')).toBe('baseline');
  await flushFrames();
  const beforeCards = cards;
  const beforeSession = structuredClone(kit.connection._sessionToolPolicy);
  const beforeFrames = kit.frames.length;
  const damaged = await corruptPolicy(corruption);
  const target = path.join(kit.ground, 'must-not-write.txt');
  // Retain the real prior catalog and active shell: corruption must stop actual
  // execution, not merely prevent a new catalog/sandbox from being prepared.
  for (const attempted of [
    call('fs', 'write', { path: target, content: 'unauthorized' }),
    call('coding', 'execute', { command: 'printf unauthorized > must-not-run.txt' }),
    call('coding', 'inspect', { command: 'printf INSPECTION_MUST_NOT_RUN' }),
  ]) {
    await expect(run([attempted])).rejects.toMatchObject(FAILURE);
  }
  await flushFrames();
  expect(cards).toBe(beforeCards);
  expect(kit.connection._pendingApprovals?.size || 0).toBe(0);
  expect(kit.connection._sessionToolPolicy).toEqual(beforeSession);
  expect(kit.frames.slice(beforeFrames).some((frame) => frame.status === 'executing')).toBe(false);
  expect(JSON.stringify(kit.frames.slice(beforeFrames))).not.toContain(PRIVATE_SENTINEL);
  expect(await fs.readFile(policyFile(), 'utf8')).toBe(damaged);
  await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.stat(path.join(upper, 'must-not-run.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.stat(path.join(kit.ground, 'must-not-run.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
}, 30000);

test('unreadable policy refuses catalog, mask and network acquisition with fixed safe errors', async () => {
  await open();
  const damaged = await corruptPolicy('syntax');
  const outcomes = await Promise.allSettled([
    readExecutionToolPolicy(kit.laneId),
    stashBeingTurnCatalog(kit.connection, [{ server: 'fs', name: 'write' }], []),
    toolsForWitness(kit.connection, null),
    ensureWitnessCodingSandbox(kit.laneId, kit.ground),
    requestShellNetwork(kit.connection, captureShellNetwork(kit.connection, kit.connection.activeTurn.signal), kit.emit),
  ]);
  for (const outcome of outcomes) {
    expect(outcome.status).toBe('rejected');
    expect(outcome.reason).toMatchObject(FAILURE);
    expect(outcome.reason.cause).toBeUndefined();
    expect(String(outcome.reason)).not.toContain(PRIVATE_SENTINEL);
  }
  await flushFrames();
  expect(cards).toBe(0);
  expect(kit.connection._turnCatalog).toBeUndefined();
  expect(kit.connection._sessionToolPolicy).toBeUndefined();
  expect(await fs.readFile(policyFile(), 'utf8')).toBe(damaged);
});

test('detached AUTO sweep leaves intent pending when policy decryption fails', async () => {
  await open();
  const dir = path.join(workspace.pathFor(kit.laneId), 'intents');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'blocked.json'), JSON.stringify({ type: 'tasks/add', title: 'must not create task' }));
  await corruptPolicy('authentication');
  expect(await sweepBatchIntents(kit.connection, kit.emit)).toEqual([]);
  expect((await workspace.readTaskLedger(kit.laneId)).tasks).toHaveLength(0);
  await expect(fs.stat(path.join(dir, 'blocked.result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await flushFrames();
  expect(cards).toBe(0);
  expect(kit.connection._pendingApprovals.size).toBe(0);
});

test('a genuinely missing policy keeps existing default access without another prompt', async () => {
  await open();
  expect(await readExecutionToolPolicy(kit.laneId)).toBeNull();
  const catalog = await stashBeingTurnCatalog(kit.connection, [{ server: 'fs', name: 'write' }], []);
  expect(catalog[0].access).toBe('allowed');
  const target = path.join(kit.ground, 'default-access.txt');
  expect((await run([call('fs', 'write', { path: target, content: 'default' })]))[0].status).toBe('ok');
  expect(await fs.readFile(target, 'utf8')).toBe('default');
  await flushFrames();
  expect(cards).toBe(0);
});
