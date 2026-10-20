import path from 'node:path';
import fs from 'node:fs/promises';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createBindingIsolationKit, untilBinding } from '../helpers/binding-isolation-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { seal } from '../../core/identity/ai-witness/ai-witness-protocol.js';
import { getAIWitnessesRoot, setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import { rehydrateApprovedPlan } from '../../backend/services/team-plan.js';
import { teamRunIntent } from '../../backend/services/intents/team-run.js';
import { compileSilo } from '../../core/silo/compile-silo.js';
import { setRoute, getRoute } from '../../backend/services/neuma-routes-store.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import { searchMemory } from '../../core/memory/memory-query.js';
import { neumaRecall } from '../../core/index.js';
import { getAllowedDirectories, setAllowedDirectories } from '@modelcontextprotocol/server-filesystem/dist/lib.js';

const NEUMA = 'binding-neuma-fixture';
const WITNESS = 'witness-openai-BindingFixture';
const SESSION = 'session-shared-name';
let kit;
let oldWitnessRoot;
let oldRoutesPath, oldCosPath;
let oldAllowedRoots;

const send = async (frame, type) => {
  const offset = kit.frames.length;
  kit.client.send(JSON.stringify(frame));
  return untilBinding(() => kit.frames.slice(offset).find((row) => row.type === type));
};

beforeAll(async () => {
  kit = await createBindingIsolationKit(NEUMA);
  kit.connection.activeTurn = null;
  oldWitnessRoot = getAIWitnessesRoot();
  oldRoutesPath = process.env.NEUMA_ROUTES_PATH;
  process.env.NEUMA_ROUTES_PATH = path.join(kit.root, 'routes.json');
  // The Optio dispatch gate reads the designation store — never the rig's
  // live seat (a seated CoS denied every team validate here).
  oldCosPath = process.env.NEUMA_STAFF_COS_PATH;
  process.env.NEUMA_STAFF_COS_PATH = path.join(kit.root, 'staff-cos.json');
  setAIWitnessesRoot(path.join(kit.root, 'seals'));
  await seal({
    chosenName: 'BindingFixture', vendor: 'openai', model: 'test-fixture',
    fullModelId: 'openai/test-fixture', harness: 'vitest', capabilities: [],
    scope: { primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'test-fixture', boundaries: [] },
    firstUtterance: 'This is a cryptographic storage fixture for lane isolation; no model is summoned or spoken through.',
  });
  // The operator owns the install (on the kit's own data root), so the witness
  // it sealed outside the desk's summon is its to take (witness-lane.js).
  await makeInstallOwner(kit.connection.walletAddress);
  await send({ type: 'companion:manifest', neumaId: WITNESS }, 'companion:anchored');
  mcpService.registerNativeServer('binding-fixture-fs', nativeFilesystemClient);
  oldAllowedRoots = getAllowedDirectories();
  setAllowedDirectories([kit.root]);
  for (const [id, key, text] of [[NEUMA, 'a', 'NEUMA_PRIVATE_HISTORY'], [WITNESS, 'b', 'WITNESS_PRIVATE_HISTORY']]) {
    await writeOwner(path.dirname(workspace.pathFor(id)), id, kit.connection.walletAddress);
    await workspace.writeNeumaDEK(id, key.repeat(64));
    await workspace.appendMessage(id, SESSION, { role: 'user', content: text });
  }
});

afterAll(async () => {
  setAIWitnessesRoot(oldWitnessRoot);
  await mcpService.disconnect('binding-fixture-fs');
  setAllowedDirectories(oldAllowedRoots || []);
  neumaRecall.invalidate(NEUMA);
  neumaRecall.invalidate(WITNESS);
  if (oldRoutesPath === undefined) delete process.env.NEUMA_ROUTES_PATH;
  else process.env.NEUMA_ROUTES_PATH = oldRoutesPath;
  if (oldCosPath === undefined) delete process.env.NEUMA_STAFF_COS_PATH;
  else process.env.NEUMA_STAFF_COS_PATH = oldCosPath;
  await kit?.close();
});

test('own durable plan reloads for a neuma, while the witness seat refuses team authority', async () => {
  const ownLane = 'binding-own-plan';
  await workspace.create(ownLane);
  await writeOwner(path.dirname(workspace.pathFor(ownLane)), ownLane, kit.connection.walletAddress);
  await send({ type: 'portal:resume', neumaId: ownLane, sessionId: SESSION }, 'portal:resumed');
  await workspace.writePlanRecord(ownLane, {
    goal: 'NEUMA_OWN_PLAN', steps: [], approvedAt: '2026-09-07T00:00:00.000Z',
  });
  expect((await teamRunIntent.validate({}, { connection: kit.connection })).ok).toBe(true);
  expect(kit.connection._approvedPlan.goal).toBe('NEUMA_OWN_PLAN');
  await send({ type: 'portal:resume', neumaId: WITNESS, sessionId: SESSION }, 'portal:resumed');
  expect(kit.connection._approvedPlan).toBeUndefined();
  expect((await teamRunIntent.validate({}, { connection: kit.connection })).ok).toBe(false);
});

test('routing stores foreign custody only for the witness and preserves separate sovereign neuma choice', async () => {
  await setRoute(WITNESS, { provider: 'openai', model: 'foreign-fixture' });
  await expect(setRoute(NEUMA, { provider: 'openai', model: 'foreign-fixture' })).rejects.toThrow('not sovereign');
  await setRoute(NEUMA, { provider: 'llama-server', model: 'owned-fixture' });
  expect((await getRoute(WITNESS)).provider).toBe('openai');
  expect((await getRoute(NEUMA)).provider).toBe('llama-server');
});

test('real sandbox reads and writes its own lane but refuses the other standing in both directions', async () => {
  const call = createSandboxedCallTool(mcpService, kit.connection, workspace);
  for (const [own, other] of [[WITNESS, NEUMA], [NEUMA, WITNESS]]) {
    await send({ type: 'portal:resume', neumaId: own, sessionId: SESSION }, 'portal:resumed');
    const file = path.join(workspace.pathFor(own), 'isolation-proof.txt');
    const write = await call('binding-fixture-fs', 'write_file', { path: file, content: own });
    expect(write.isError).not.toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe(own);
    const read = await call('binding-fixture-fs', 'read_file', { path: file });
    expect(read.isError).not.toBe(true);
    expect(JSON.stringify(read)).toContain(own);
    const foreign = path.join(workspace.pathFor(other), 'isolation-proof.txt');
    await expect(call('binding-fixture-fs', 'read_file', { path: foreign })).rejects.toThrow();
    await expect(call('binding-fixture-fs', 'write_file', { path: foreign, content: 'crossed' })).rejects.toThrow();
  }
});

test.each(['missing', 'tampered'])('a %s witness seal refuses resume instead of creating a neuma-class binding', async (condition) => {
  const dna = path.join(kit.root, 'seals', 'openai', 'BindingFixture', 'dna.json');
  const original = await fs.readFile(dna);
  if (condition === 'missing') await fs.rename(dna, `${dna}.held`);
  else {
    const changed = JSON.parse(original);
    changed.genesisSeal.selfSignature = '0x0000';
    await fs.writeFile(dna, JSON.stringify(changed));
  }
  try {
    const reply = await send({ type: 'portal:resume', neumaId: WITNESS, sessionId: SESSION }, 'portal:resumed');
    expect(reply.neumaId).toBeNull();
    expect(kit.connection.companion).toBeNull();
  } finally {
    if (condition === 'missing') await fs.rename(`${dna}.held`, dna);
    else await fs.writeFile(dna, original);
  }
});

test('recall searches each encrypted lane without returning the other lane private memory', async () => {
  await workspace.addObservation(WITNESS, { content: 'cerulean private witness memory', significance: 0.9 });
  await workspace.addObservation(NEUMA, { content: 'amber private neuma memory', significance: 0.9 });
  neumaRecall.invalidate(NEUMA);
  neumaRecall.invalidate(WITNESS);
  const deps = { recall: neumaRecall, workspace };
  for (const [id, own, foreign] of [[WITNESS, 'cerulean', 'amber'], [NEUMA, 'amber', 'cerulean']]) {
    const result = await searchMemory({ neumaId: id, query: 'private memory' }, deps);
    expect(result.hits).toBeGreaterThan(0);
    expect(result.content).toContain(own);
    expect(result.content).not.toContain(foreign);
  }
});

test('authenticated witness → neuma → witness resumes return only the requested lane history', async () => {
  for (const [id, own, other, kind] of [
    [WITNESS, 'WITNESS_PRIVATE_HISTORY', 'NEUMA_PRIVATE_HISTORY', 'witness'],
    [NEUMA, 'NEUMA_PRIVATE_HISTORY', 'WITNESS_PRIVATE_HISTORY', undefined],
    [WITNESS, 'WITNESS_PRIVATE_HISTORY', 'NEUMA_PRIVATE_HISTORY', 'witness'],
  ]) {
    const reply = await send({ type: 'portal:resume', neumaId: id, sessionId: SESSION }, 'portal:resumed');
    expect(reply.neumaId).toBe(id);
    expect(JSON.stringify(reply.recentMessages)).toContain(own);
    expect(JSON.stringify(reply.recentMessages)).not.toContain(other);
    expect(kit.connection.companion.participantKind).toBe(kind);
    const silo = await compileSilo(id, { workspace });
    expect(JSON.stringify(silo.layers.memory)).toContain(own);
    expect(JSON.stringify(silo.layers.memory)).not.toContain(other);
  }
});

test('a witness plan and cached runtime cannot survive a rebind into neuma authority', async () => {
  await send({ type: 'portal:resume', neumaId: WITNESS, sessionId: SESSION }, 'portal:resumed');
  await workspace.writePlanRecord(WITNESS, {
    name: 'witness-private-plan', goal: 'WITNESS_PRIVATE_PLAN', steps: [],
    approvedAt: '2026-09-07T00:00:00.000Z',
  });
  await rehydrateApprovedPlan(kit.connection);
  expect(kit.connection._approvedPlan.goal).toBe('WITNESS_PRIVATE_PLAN');
  Object.assign(kit.connection, {
    _sessionCompaction: { summary: 'WITNESS_PRIVATE_COMPACTION' },
    _sensitiveGrants: { read: ['/private/witness'] },
    _teamWorkspace: { root: '/private/witness-team' },
    _turnSandbox: { workspace: '/private/witness-shell' },
    _turnCatalog: [{ name: 'witness-only' }], _turnSkills: [{ name: 'private-skill' }],
    _turnDisclosedToolIds: new Set(['witness-only']),
    _siloBySitting: new Map([[WITNESS, await compileSilo(WITNESS, { workspace })]]),
  });
  await send({ type: 'portal:resume', neumaId: NEUMA, sessionId: SESSION }, 'portal:resumed');
  const result = await teamRunIntent.validate({}, { connection: kit.connection });
  expect(result.ok).toBe(false);
  expect(result.reason).toContain('no approved plan');
  for (const key of ['_approvedPlan', '_sessionCompaction', '_sensitiveGrants', '_teamWorkspace',
    '_turnSandbox', '_turnCatalog', '_turnSkills', '_turnDisclosedToolIds']) {
    expect(kit.connection[key], key).toBeFalsy();
  }
  // The witness's compiled silo is gone with the binding. Since 3fd7f7ab1 the
  // bind starts the NEW being's own compile (sitting-warmup.js), so the cache
  // may hold exactly that lane — and what it holds is the neuma's own memory.
  const silos = kit.connection._siloBySitting;
  expect([...(silos?.keys() || [])].every((id) => id === NEUMA), '_siloBySitting').toBe(true);
  if (silos?.has(NEUMA)) {
    const memory = JSON.stringify((await silos.get(NEUMA)).layers.memory);
    expect(memory).toContain('NEUMA_PRIVATE_HISTORY');
    expect(memory).not.toContain('WITNESS_PRIVATE_HISTORY');
  }
  expect((await workspace.readPlanRecord(WITNESS)).goal).toBe('WITNESS_PRIVATE_PLAN');
  expect(await workspace.readPlanRecord(NEUMA)).toBeNull();
});
