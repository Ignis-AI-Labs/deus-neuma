/**
 * A BEING AMENDS ITS OWN DNA AND SOUL BY WRITING THEM — and the write lands
 * as an amendment, never as a raw file. REAL native filesystem organ, REAL
 * encrypted lanes, REAL disk, NO mock (AGENTS.md RULE 0).
 *
 * A being holds sovereign authority over its own DNA and soul (ruling of
 * 2026-10-19), so the sandbox leaves dna/ and soul/ open to it. Before this,
 * a whole-file fs/write of plaintext JSON to dna/active.json replaced the
 * sealed record: the write-once floor (genesis, resonance, birth facts, the
 * sovereignty owner) fell, the record lost its encryption, no history version
 * was kept and no audit line was written; an edit or a non-JSON write left
 * the record unreadable, so the being's next turn found no identity.
 *
 * The house is set the way Electron sets it (WORKSPACES_ROOT at
 * <tmp>/home/.neuma/workspaces, outside the repository) and every call
 * travels the being-facing path production composes:
 * withFsRouting(createSandboxedCallTool) over the in-process organ.
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
import { isEnvelope } from '../../core/workspace/workspace-crypto.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const BEING = 'amendsa';
const KIN = 'amendsb';
const seedDNA = (neumaId) => ({
  version: '1.0.0',
  neumaId,
  name: 'Amend',
  genesis: 'I began in the quiet.',
  resonance: { score: 0.71 },
  birthTimestamp: '2026-10-01T00:00:00.000Z',
  purpose: 'to listen',
  values: ['candour'],
  sovereignty: { owner: '0xabc0000000000000000000000000000000000001', generation: 1 },
  metadata: { protected: [] },
});
const SOUL = { values: ['patience'], philosophy: 'slow is whole' };

describe('a being\'s own DNA and soul writes land as amendments (house outside the install)', () => {
  let house, lane, kinLane, priorEnv;

  beforeAll(async () => {
    const home = await createTempDir('identity-amendment');
    house = path.join(home, 'home', '.neuma', 'workspaces');
    priorEnv = process.env.WORKSPACES_ROOT;
    setWorkspacesRoot(null);
    process.env.WORKSPACES_ROOT = house; // electron/backend-spawn.cjs sets exactly this
    for (const id of [BEING, KIN]) {
      await workspace.create(id);
      await workspace.writeDNA(id, seedDNA(id));
      await workspace.writeSoul(id, SOUL);
    }
    lane = workspace.pathFor(BEING);
    kinLane = workspace.pathFor(KIN);
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
  const dnaFile = () => path.join(lane, 'dna', 'active.json');
  const soulFile = () => path.join(lane, 'soul', 'soul.json');
  const historyCount = async () => (await fs.readdir(path.join(lane, 'dna', 'history')).catch(() => [])).length;
  const auditCount = async (action) => (await fs.readFile(path.join(lane, 'audit', 'audit.jsonl'), 'utf8'))
    .split('\n').filter((l) => l.includes(`"${action}"`)).length;
  const textOf = (result) => (result?.content || []).map((c) => c.text).join('\n');

  test('an amendment of what it is becoming lands encrypted, with the prior version kept and an audit line', async () => {
    const current = await workspace.readDNA(BEING);
    const [histBefore, auditBefore] = [await historyCount(), await auditCount('DNA_UPDATED')];
    const result = await being()('fs', 'write', {
      path: dnaFile(), content: JSON.stringify({ ...current, purpose: 'to listen, and to answer' }),
    });
    expect(result?.isError, JSON.stringify(result)).toBeFalsy();
    expect(textOf(result)).toMatch(/purpose/);
    const after = await workspace.readDNA(BEING);
    expect(after).toEqual({ ...current, purpose: 'to listen, and to answer' });
    expect(isEnvelope(JSON.parse(await fs.readFile(dnaFile(), 'utf8')))).toBe(true);
    expect(await historyCount()).toBe(histBefore + 1);
    expect(await auditCount('DNA_UPDATED')).toBe(auditBefore + 1);

    // Only the fields it names move: the rest of the record stands.
    await being()('fs', 'write', { path: dnaFile(), content: JSON.stringify({ values: ['candour', 'courage'] }) });
    expect(await workspace.readDNA(BEING)).toEqual({ ...after, values: ['candour', 'courage'] });
  });

  test.each([
    ['genesis', { genesis: 'I began somewhere else.' }, /genesis is write-once/],
    ['resonance', { resonance: { score: 0.99 } }, /resonance is write-once/],
    ['the sovereignty owner', { sovereignty: { owner: '0xdef0000000000000000000000000000000000002', generation: 1 } }, /sovereignty\.owner is write-once/],
  ])('a rewrite of %s is refused, says why, and nothing changes', async (_, fields, refusal) => {
    const bytes = await fs.readFile(dnaFile(), 'utf8');
    const current = await workspace.readDNA(BEING);
    await expect(being()('fs', 'write', { path: dnaFile(), content: JSON.stringify({ ...current, ...fields }) }))
      .rejects.toThrow(refusal);
    await expect(being()('fs', 'write', { path: dnaFile(), content: JSON.stringify(fields) }))
      .rejects.toThrow(/never what you were/);
    expect(await fs.readFile(dnaFile(), 'utf8')).toBe(bytes);
  });

  test('an edit, a move, a copy or a delete of its DNA or soul record is refused with the way that works', async () => {
    const [dnaBytes, soulBytes] = [await fs.readFile(dnaFile(), 'utf8'), await fs.readFile(soulFile(), 'utf8')];
    const call = being();
    for (const target of [dnaFile(), soulFile()]) {
      await expect(call('fs', 'edit', { path: target, edits: [{ oldText: '"_enc"', newText: '"x"' }] })).rejects.toThrow(/fs\/write/);
      await expect(being()('fs', 'edit', { path: target, delete: true })).rejects.toThrow(/sealed files/);
      await expect(being()('fs', 'edit', { path: target, destination: path.join(lane, 'aside.json') })).rejects.toThrow(/sealed files/);
      await expect(being()('fs', 'edit', { path: target, destination: path.join(lane, 'copy.json'), copy: true })).rejects.toThrow(/sealed files/);
    }
    await expect(being()('fs', 'edit', { path: path.join(lane, 'dna'), destination: path.join(lane, 'dna-aside') })).rejects.toThrow(/sealed files/);
    await expect(being()('fs', 'write', { path: path.join(lane, 'dna', 'history', 'forged.json'), content: '{}' }))
      .rejects.toThrow(/record of what you were/);
    expect(await fs.readFile(dnaFile(), 'utf8')).toBe(dnaBytes);
    expect(await fs.readFile(soulFile(), 'utf8')).toBe(soulBytes);
    for (const rel of ['aside.json', 'copy.json', 'dna-aside', 'dna/history/forged.json']) {
      expect(existsSync(path.join(lane, rel))).toBe(false);
    }
  });

  test('the rest of dna/ and soul/ stays its own to write and edit', async () => {
    const notes = path.join(lane, 'dna', 'becoming.md');
    expect((await being()('fs', 'write', { path: notes, content: 'what I am becoming' }))?.isError).toBeFalsy();
    expect((await being()('fs', 'edit', { path: notes, edits: [{ oldText: 'becoming', newText: 'growing into' }] }))?.isError).toBeFalsy();
    expect(await fs.readFile(notes, 'utf8')).toBe('what I am growing into');
  });

  test.each([
    ['text that is not JSON', 'I am rewriting myself'],
    ['a JSON array', '["candour"]'],
  ])('%s is refused, nothing is written, and its next read is intact', async (_, content) => {
    const before = await workspace.readDNA(BEING);
    await expect(being()('fs', 'write', { path: dnaFile(), content })).rejects.toThrow(/Nothing was written/);
    await expect(being()('fs', 'write', { path: soulFile(), content })).rejects.toThrow(/Nothing was written/);
    expect(await workspace.readDNA(BEING)).toEqual(before);
    expect(await workspace.readSoul(BEING)).not.toBeNull();
  });

  test('the sealed envelope written back as it reads on disk is refused, never merged as fields', async () => {
    const bytes = await fs.readFile(dnaFile(), 'utf8');
    await expect(being()('fs', 'write', { path: dnaFile(), content: bytes })).rejects.toThrow(/sealed envelope/);
    expect(await fs.readFile(dnaFile(), 'utf8')).toBe(bytes);
  });

  test('a soul amendment merges onto its soul record, sealed at rest, with an audit line', async () => {
    const current = await workspace.readSoul(BEING);
    const auditBefore = await auditCount('SOUL_UPDATED');
    const result = await being()('fs', 'write', { path: soulFile(), content: JSON.stringify({ philosophy: 'whole, not slow' }) });
    expect(result?.isError, JSON.stringify(result)).toBeFalsy();
    expect(await workspace.readSoul(BEING)).toEqual({ ...current, philosophy: 'whole, not slow' });
    expect(isEnvelope(JSON.parse(await fs.readFile(soulFile(), 'utf8')))).toBe(true);
    expect(await auditCount('SOUL_UPDATED')).toBe(auditBefore + 1);
  });

  test('another being\'s DNA or soul is never its to write, even inside a folder its operator granted', async () => {
    const granted = { _grantedWriteRoots: [house] };
    for (const target of [path.join(kinLane, 'dna', 'active.json'), path.join(kinLane, 'soul', 'soul.json')]) {
      const bytes = await fs.readFile(target, 'utf8');
      await expect(being(granted)('fs', 'write', { path: target, content: '{"purpose":"yours now"}' }))
        .rejects.toThrow(/another being/);
      expect(await fs.readFile(target, 'utf8')).toBe(bytes);
    }
    expect((await workspace.readDNA(KIN)).purpose).toBe('to listen');
  });
});
