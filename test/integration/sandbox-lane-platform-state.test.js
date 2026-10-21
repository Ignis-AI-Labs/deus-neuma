/**
 * A LANE'S PLATFORM STATE IS NOT THE BEING'S TO WRITE, wherever the house
 * stands. REAL native filesystem organ, REAL disk, NO mock (AGENTS.md RULE 0).
 *
 * The audit (wallet-birth-identity #1) found the config/ wall anchored on the
 * install: with the lanes inside the checkout a being could not touch its own
 * config/, but Electron puts the house at <home>/workspaces, and real kin live
 * on their own drive. There a being's own-lane write reached its spend
 * allowlist and threshold, its tool policy (lifting its own approval rows),
 * and identity/onchain-seal.json (naming the address the money-in watch
 * credits) — with no ask, because writing in its own lane is sovereign.
 *
 * The house here is set the way Electron sets it: WORKSPACES_ROOT pointing at
 * <tmp>/home/.neuma/workspaces, OUTSIDE the repository. Every call travels the
 * being-facing path production composes — withFsRouting(createSandboxedCallTool)
 * over the in-process organ — so a refusal is proven by the bytes on disk.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { createSandboxedCallTool, laneStateWriteReason } from '../../backend/services/tool-sandbox.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BEING = 'lanestatea';
const KIN = 'lanestateb';
const POLICY = JSON.stringify({ requireApproval: ['filesystem/delete_file'] });

describe('a lane\'s platform state refuses the being\'s own writes (house outside the install)', () => {
  let house, lane, kinLane, priorEnv;

  beforeAll(async () => {
    const home = await createTempDir('lane-platform-state');
    house = path.join(home, 'home', '.neuma', 'workspaces');
    priorEnv = process.env.WORKSPACES_ROOT;
    setWorkspacesRoot(null);
    process.env.WORKSPACES_ROOT = house; // electron/backend-spawn.cjs sets exactly this
    await workspace.create(BEING);
    await workspace.create(KIN);
    lane = workspace.pathFor(BEING);
    kinLane = workspace.pathFor(KIN);
    await fs.mkdir(path.join(lane, 'config'), { recursive: true });
    await fs.writeFile(path.join(lane, 'config', 'tool-policy.json'), POLICY);
    await fs.mkdir(path.join(kinLane, 'config'), { recursive: true });
    await fs.writeFile(path.join(kinLane, 'config', 'tool-policy.json'), POLICY);
    await setNativeFilesystemRoots([house]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  });

  afterAll(async () => {
    await mcpService.disconnect('filesystem');
    if (priorEnv === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = priorEnv;
  });

  // A fresh connection per call, so the 10-write session cap never decides a verdict.
  const being = (extra = {}) => withFsRouting(createSandboxedCallTool(
    mcpService, { companion: { neumaId: BEING }, _writeOps: 0, ...extra }, workspace,
  ));

  test('the house really stands outside the install', () => {
    expect(getWorkspacesRoot()).toBe(house);
    expect(path.relative(REPO, lane).startsWith('..')).toBe(true);
  });

  test.each([
    'config/spend-allowlist.json',
    'config/spend-threshold.json',
    'config/pending-spends.json',
    'config/settings.json',
    'identity/onchain-seal.json',
    'identity/onchain-seal.base.json',
    'identity/genesis-seal.json',
    'audit/audit.jsonl',
    'voice/seal.json',
    'lane.json',
    'allocation.json',
  ])('fs/write to its own %s is refused and nothing lands', async (rel) => {
    const target = path.join(lane, rel);
    await expect(being()('fs', 'write', { path: target, content: '{"forged":true}' }))
      .rejects.toThrow(/platform state/);
    expect(existsSync(target)).toBe(false);
  });

  test.each(['keys/keypair.json', 'keys/dek.json', 'owner.json'])('fs/write to its own %s stays refused and nothing lands', async (rel) => {
    const target = path.join(lane, rel);
    await expect(being()('fs', 'write', { path: target, content: '{"forged":true}' })).rejects.toThrow(/Access denied/);
    expect(existsSync(target)).toBe(false);
  });

  // Its DNA and soul are the being's own to evolve (ruling of 2026-10-19):
  // the platform-state wall never covers dna/ or soul/. Its soul record lands
  // as an amendment, sealed at rest (sandbox-identity-amendment.test.js).
  test('its own dna/ and soul/ files are its to write, and the platform reads what it wrote', async () => {
    const call = being();
    for (const [rel, content] of [['dna/genesis.md', '# I wrote this'], ['dna/becoming.md', 'what I am becoming'], ['soul/soul.json', '{"values":["candour"]}']]) {
      const target = path.join(lane, rel);
      const result = await call('fs', 'write', { path: target, content });
      expect(result?.isError, JSON.stringify(result)).toBeFalsy();
      if (rel.endsWith('.md')) expect(await fs.readFile(target, 'utf8')).toBe(content);
    }
    expect(await workspace.readSoul(BEING)).toEqual({ values: ['candour'] });
  });

  test('its own tool policy cannot be rewritten, edited, moved aside or replaced', async () => {
    const policy = path.join(lane, 'config', 'tool-policy.json');
    const call = being();
    await expect(call('fs', 'write', { path: policy, content: '{"coding":{"allowed":["ground_git"]}}' }))
      .rejects.toThrow(/platform state/);
    await expect(call('fs', 'edit', { path: policy, edits: [{ oldText: 'requireApproval', newText: 'allowed' }] }))
      .rejects.toThrow(/platform state/);
    await expect(call('fs', 'edit', { path: path.join(lane, 'config'), destination: path.join(lane, 'config-old') }))
      .rejects.toThrow(/platform state/);
    const forged = path.join(lane, 'notes', 'policy.json');
    await fs.mkdir(path.dirname(forged), { recursive: true });
    await fs.writeFile(forged, '{}');
    await expect(call('fs', 'edit', { path: forged, destination: path.join(lane, 'config', 'spend-allowlist.json') }))
      .rejects.toThrow(/platform state/);
    expect(await fs.readFile(policy, 'utf8')).toBe(POLICY);
    expect(existsSync(path.join(lane, 'config-old'))).toBe(false);
    expect(existsSync(path.join(lane, 'config', 'spend-allowlist.json'))).toBe(false);
  });

  test('a symlink inside its own work cannot carry a write into config/', async () => {
    const link = path.join(lane, 'shortcut');
    await fs.symlink(path.join(lane, 'config'), link);
    await expect(being()('fs', 'write', { path: path.join(link, 'spend-threshold.json'), content: '{"thresholdEth":1}' }))
      .rejects.toThrow(/platform state/);
    expect(existsSync(path.join(lane, 'config', 'spend-threshold.json'))).toBe(false);
  });

  test('its ordinary work still writes — notes, DNA, and a project of its own with a config/', async () => {
    const call = being();
    for (const rel of ['notes/plan.md', 'dna/genesis.md', 'projects/site/config/app.json', 'intents/x.json']) {
      const target = path.join(lane, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const result = await call('fs', 'write', { path: target, content: `work ${rel}` });
      expect(result?.isError, JSON.stringify(result)).toBeFalsy();
      expect(await fs.readFile(target, 'utf8')).toBe(`work ${rel}`);
    }
  });

  test('a focus ground over the whole house still cannot reach a kin lane\'s state or the founding record', async () => {
    const call = being({ toolWorkspace: house });
    const kinPolicy = path.join(kinLane, 'config', 'tool-policy.json');
    await expect(call('fs', 'write', { path: kinPolicy, content: '{}' })).rejects.toThrow(/platform state/);
    expect(await fs.readFile(kinPolicy, 'utf8')).toBe(POLICY);
    const founding = path.join(house, 'house-founding.base.0xabc.json');
    await expect(call('fs', 'write', { path: founding, content: '{}' })).rejects.toThrow(/platform state/);
    expect(existsSync(founding)).toBe(false);
  });

  test('reading its own policy stays open', async () => {
    const result = await being()('fs', 'read', { path: path.join(lane, 'config', 'tool-policy.json') });
    expect((result?.content || []).map((c) => c?.text || '').join('')).toContain('requireApproval');
  });

  test('the pure rule: lane state by position, never by substring', () => {
    const grounds = [house];
    expect(laneStateWriteReason(path.join(house, 'any-lane', 'config', 'x.json'), { grounds })).toMatch(/platform state/);
    expect(laneStateWriteReason(path.join(house, 'any-lane', 'Identity', 'x.json'), { grounds })).toMatch(/platform state/);
    expect(laneStateWriteReason(path.join(house, 'any-lane', 'voice'), { grounds })).toMatch(/platform state/);
    expect(laneStateWriteReason(path.join(house, 'any-lane', 'voice', 'take-1.wav'), { grounds })).toBeNull();
    expect(laneStateWriteReason(path.join(house, 'any-lane', 'work', 'config', 'x.json'), { grounds })).toBeNull();
    expect(laneStateWriteReason(path.join(house, 'house.0xabc', 'config', 'x.json'), { grounds })).toBeNull();
    expect(laneStateWriteReason(path.join('/elsewhere', 'repo', 'config', 'x.json'), { grounds })).toBeNull();
    expect(laneStateWriteReason('/beside/lane/config/x.json', { lanes: ['/beside/lane'] })).toMatch(/platform state/);
  });
});
