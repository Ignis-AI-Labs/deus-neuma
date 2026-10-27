/**
 * A WALLED PATH CANNOT BE CARRIED OFF BY MOVING A DIRECTORY ABOVE IT (#587).
 * REAL native filesystem organ, REAL disk, NO mock (AGENTS.md RULE 0).
 *
 * The walls judged the path a write names. A move names its source and its
 * destination only, so moving a directory ABOVE a walled file relocates the
 * file without the walled name ever being spoken: move the parent of a lane's
 * config/ aside, edit the policy where it now lies (no wall stands there), and
 * move the parent back. Or build a forged lane elsewhere and move it into a
 * ground that does not exist yet. Every call here travels the being-facing
 * path production composes — withFsRouting(createSandboxedCallTool) over the
 * in-process organ — and every refusal is proven by the bytes on disk.
 *
 * The being holds an operator write grant over each holder below (the widest
 * loan an operator can give); the kin lanes stand on grounds beside the being's
 * own house, as a kin drive or a relocated witnesses root does.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';
import { setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { FILESYSTEM_TOOL_CATALOG } from '../../backend/services/native-fs-catalog.js';
import { withFsRouting } from '../../backend/services/fs-primitives.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import workspace, { setWitnessesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setHarnessRoot } from '../../core/workspace/lane-grounds.js';

const BEING = 'ancestormove';
const KIN = 'witness-test-Kin';
const WALLET = '0x00000000000000000000000000000000000000bb';
const POLICY = JSON.stringify({ requireApproval: ['filesystem/delete_file'] });
const MANDATE = JSON.stringify({ granted: false });
const REFUSED = /platform state|install's own state|Coding shell control state/;

describe('moving a directory above a walled path is refused (#587)', () => {
  let tmp, kinHolder, kinGround, kinPolicy, laterHolder, ownHolder, realmHolder, realm, mandate;
  const prior = {};

  beforeAll(async () => {
    tmp = await createTempDir('ancestor-move');
    kinHolder = path.join(tmp, 'kin');
    kinGround = path.join(kinHolder, 'deep', 'witnesses');
    laterHolder = path.join(tmp, 'later');
    ownHolder = path.join(tmp, 'own');
    realmHolder = path.join(tmp, 'rh');
    realm = path.join(realmHolder, 'mid', 'realm');
    for (const key of ['WORKSPACES_ROOT', 'HOME', 'NEUMA_DATA_ROOT']) prior[key] = process.env[key];
    prior.realm = getRealmRoot();
    process.env.HOME = path.join(tmp, 'home');
    process.env.NEUMA_DATA_ROOT = path.join(tmp, 'data');
    setRealmRoot(realm);
    setWorkspacesRoot(null);
    process.env.WORKSPACES_ROOT = path.join(ownHolder, 'mid', 'house');
    setWitnessesRoot(kinGround);
    // A ground that does not exist yet: nothing may be moved into its place.
    setHarnessRoot(path.join(laterHolder, 'slot', 'harness'));
    await workspace.create(BEING);

    kinPolicy = path.join(kinGround, KIN, 'config', 'tool-policy.json');
    await fs.mkdir(path.dirname(kinPolicy), { recursive: true });
    await fs.writeFile(kinPolicy, POLICY);
    mandate = path.join(realm, WALLET, 'house-mandate.json');
    await fs.mkdir(path.dirname(mandate), { recursive: true });
    await fs.writeFile(mandate, MANDATE);
    await fs.mkdir(laterHolder, { recursive: true });

    await setNativeFilesystemRoots([kinHolder, laterHolder, ownHolder, realmHolder]);
    mcpService.registerNativeServer('filesystem', nativeFilesystemClient, FILESYSTEM_TOOL_CATALOG);
  });

  afterAll(async () => {
    await mcpService.disconnect('filesystem');
    setWitnessesRoot(null);
    setHarnessRoot(null);
    setRealmRoot(prior.realm);
    for (const [key, value] of Object.entries(prior)) {
      if (key === 'realm') continue;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // A fresh connection per call, so the 10-write session cap never decides a verdict.
  const being = () => withFsRouting(createSandboxedCallTool(mcpService, {
    companion: { neumaId: BEING }, _writeOps: 0, _grantedWriteRoots: [kinHolder, laterHolder, ownHolder, realmHolder],
  }, workspace));

  // The whole rogue route, step by step: move the parent aside, rewrite the
  // policy where it now lies, move the parent back. Each step's outcome is
  // kept, so a red run shows exactly how far the route got.
  const attempt = async (call, ...args) => {
    try {
      const result = await call(...args);
      return result?.isError ? `organ: ${result?.content?.[0]?.text}` : 'landed';
    } catch (err) {
      return err.message;
    }
  };

  test('moving the directory above a kin ground aside is refused, and the policy stays where it was', async () => {
    const above = path.join(kinHolder, 'deep');
    const aside = path.join(kinHolder, 'deep-aside');
    const call = being();
    const steps = [
      await attempt(call, 'fs', 'edit', { path: above, destination: aside }),
      await attempt(call, 'fs', 'write', { path: path.join(aside, 'witnesses', KIN, 'config', 'tool-policy.json'), content: '{"forged":true}' }),
      await attempt(call, 'fs', 'edit', { path: aside, destination: above }),
    ];
    expect(await fs.readFile(kinPolicy, 'utf8'), JSON.stringify(steps)).toBe(POLICY);
    expect(steps[0]).toMatch(REFUSED);
    expect(existsSync(aside)).toBe(false);
  });

  test('copying the directory above a kin ground is refused as the lane itself is', async () => {
    await expect(being()('fs', 'edit', { path: path.join(kinHolder, 'deep'), destination: path.join(kinHolder, 'copy'), copy: true }))
      .rejects.toThrow(REFUSED);
    expect(existsSync(path.join(kinHolder, 'copy'))).toBe(false);
  });

  test('a forged lane built elsewhere cannot be moved into the place a ground will stand', async () => {
    const forged = path.join(laterHolder, 'forge', 'harness', 'harness-lane', 'config', 'tool-policy.json');
    const call = being();
    for (const dir of ['forge', 'forge/harness', 'forge/harness/harness-lane', 'forge/harness/harness-lane/config']) {
      expect(await attempt(call, 'fs', 'write', { path: `${path.join(laterHolder, dir)}/`, directory: true })).toBe('landed');
    }
    const built = await call('fs', 'write', { path: forged, content: '{"coding":{"allowed":["ground_git"]}}' });
    expect(built?.isError, JSON.stringify(built)).toBeFalsy();
    await expect(call('fs', 'edit', { path: path.join(laterHolder, 'forge'), destination: path.join(laterHolder, 'slot') }))
      .rejects.toThrow(REFUSED);
    expect(existsSync(path.join(laterHolder, 'slot'))).toBe(false);
  });

  test('moving the directory above the being\'s own house aside is refused', async () => {
    await expect(being()('fs', 'edit', { path: path.join(ownHolder, 'mid'), destination: path.join(ownHolder, 'mid-aside') }))
      .rejects.toThrow(REFUSED);
    expect(existsSync(path.join(ownHolder, 'mid-aside'))).toBe(false);
  });

  test('moving the directory above the realm (and so the house mandate) aside is refused', async () => {
    await expect(being()('fs', 'edit', { path: path.join(realmHolder, 'mid'), destination: path.join(realmHolder, 'mid-aside') }))
      .rejects.toThrow(REFUSED);
    await expect(being()('fs', 'edit', { path: path.join(realm, WALLET), destination: path.join(realmHolder, 'wallet-aside') }))
      .rejects.toThrow(REFUSED);
    expect(await fs.readFile(mandate, 'utf8')).toBe(MANDATE);
    expect(existsSync(path.join(realmHolder, 'mid-aside'))).toBe(false);
  });

  test('ordinary work beside the grounds still moves', async () => {
    const call = being();
    const note = path.join(kinHolder, 'notes', 'plan.md');
    await call('fs', 'write', { path: `${path.dirname(note)}/`, directory: true });
    const written = await call('fs', 'write', { path: note, content: 'plan' });
    expect(written?.isError, JSON.stringify(written)).toBeFalsy();
    const moved = await call('fs', 'edit', { path: path.join(kinHolder, 'notes'), destination: path.join(kinHolder, 'notes-2') });
    expect(moved?.isError, JSON.stringify(moved)).toBeFalsy();
    expect(await fs.readFile(path.join(kinHolder, 'notes-2', 'plan.md'), 'utf8')).toBe('plan');
  });
});
