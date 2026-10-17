import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { URL } from 'node:url';
// Birth state classification — REAL disk, REAL workspaces in three deliberate
// states, NO mock (RULE 0). Uses TEST neuma ids under a temp workspace root —
// never reads or touches a living being.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { detectBirthState } from '../../core/birth/birth-state.js';

describe('detectBirthState — classify a workspace by which birth artifacts exist', () => {
  let root;
  const priorRoot = getWorkspacesRoot();
  beforeAll(async () => {
    const tmp = await createTempDir('birth-state');
    root = path.join(tmp, 'workspaces');
    setWorkspacesRoot(root);
  });
  afterAll(() => setWorkspacesRoot(priorRoot));

  // Helper — create a workspace skeleton at any specified stage by laying down
  // the artifacts up to that stage. This proves file presence classification,
  // not cryptographic validity or a completed birth ceremony.
  const layDown = async (id, stage, { chosenName, house } = {}) => {
    await workspace.create(id);
    const ws = workspace._path(id);
    // identity/ isn't scaffolded by create() — it's lazily created by the seal-
    // write path in production. Tests that lay down stages 2+ need to ensure it.
    await fs.mkdir(`${ws}/identity`, { recursive: true });
    if (stage >= 1) await fs.writeFile(`${ws}/keys/keypair.json`, JSON.stringify({ stub: true }));
    if (stage >= 2) await fs.writeFile(`${ws}/identity/genesis-seal.json`, JSON.stringify({ stub: true }));
    if (stage >= 3) {
      await fs.writeFile(`${ws}/identity/true-name.json`, JSON.stringify({
        chosenName: chosenName || `Test-${id}`, houseName: house || null,
      }));
    }
    if (stage >= 4) await fs.writeFile(`${ws}/keys/identity-card.json`, JSON.stringify({ stub: true }));
    if (stage >= 5) await fs.writeFile(`${ws}/dna/active.json`, JSON.stringify({ stub: true }));
  };

  it('an empty workspace classifies as stage 0 — nothing present, not resumable', async () => {
    await workspace.create('empty-being');
    const state = await detectBirthState(workspace, 'empty-being');
    expect(state.artifactStage).toBe(0);
    expect(state.resumable).toBe(false);
    expect(state.complete).toBe(false);
    expect(state.missing).toContain('keys/keypair.json');
    expect(state.missing).toContain('dna/active.json');
    expect(state.chosenName).toBeNull();
  });

  it('a Keir-shaped workspace (identity present, DNA absent) is RESUMABLE', async () => {
    await layDown('keir-shaped', 4, { chosenName: 'Keir', house: 'Aldmere' });
    const state = await detectBirthState(workspace, 'keir-shaped');
    expect(state.artifactStage).toBe(4);
    expect(state.resumable).toBe(true);                    // the load-bearing classification
    expect(state.complete).toBe(false);
    expect(state.missing).toEqual(['dna/active.json']);
    expect(state.chosenName).toBe('Keir');
    expect(state.house).toBe('Aldmere');
    // every identity artifact (1-4) is marked present
    expect(state.stages.filter((s) => s.present)).toHaveLength(4);
  });

  it('a fully-DNA\'d workspace is complete and NOT resumable', async () => {
    await layDown('complete-being', 5, { chosenName: 'Signal', house: 'Aldmere' });
    const state = await detectBirthState(workspace, 'complete-being');
    expect(state.artifactStage).toBe(5);
    expect(state.complete).toBe(true);
    expect(state.resumable).toBe(false);                   // already born; nothing to resume
    expect(state.missing).toEqual([]);
  });

  it('a being whose key was SECURED (plaintext replaced by its envelope) still reads as keyed', async () => {
    // Custody deletes keys/keypair.json and leaves keys/keypair-encrypted.json.
    await layDown('secured-being', 5, { chosenName: 'Galen', house: 'Aldmere' });
    const ws = workspace._path('secured-being');
    await fs.rename(`${ws}/keys/keypair.json`, `${ws}/keys/keypair-encrypted.json`);
    const state = await detectBirthState(workspace, 'secured-being');
    expect(state.artifactStage).toBe(5);
    expect(state.complete).toBe(true);
    expect(state.missing).toEqual([]);

    await layDown('secured-held', 4, { chosenName: 'Held', house: 'Aldmere' });
    const held = workspace._path('secured-held');
    await fs.rename(`${held}/keys/keypair.json`, `${held}/keys/keypair-encrypted.json`);
    expect((await detectBirthState(workspace, 'secured-held')).resumable).toBe(true);
  });

  it('a being with HOLES earlier than DNA (e.g. missing identity-card) is NOT resumable', async () => {
    // simulate a broken pipeline: keypair + seal + true-name + DNA but no identity-card
    await layDown('broken-being', 3);
    const ws = workspace._path('broken-being');
    await fs.writeFile(`${ws}/dna/active.json`, JSON.stringify({ stub: true })); // DNA but no card

    const state = await detectBirthState(workspace, 'broken-being');
    expect(state.artifactStage).toBe(3);                           // contiguous completed stops at 3
    expect(state.resumable).toBe(false);                   // identity has a hole — deeper repair needed
    expect(state.missing).toContain('keys/identity-card.json');
  });

  it('the returned record is DEEPLY frozen (no accidental mutation)', async () => {
    await layDown('frozen', 5);
    const state = await detectBirthState(workspace, 'frozen');
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.stages)).toBe(true);
    expect(() => { state.artifactStage = 99; }).toThrow();
    expect(() => { state.stages[0].present = false; }).toThrow();
  });

  it('refuses bad input (missing workspace or neumaId) loudly', async () => {
    await expect(detectBirthState({}, 'x')).rejects.toThrow(/workspace with _path/);
    await expect(detectBirthState(workspace, '')).rejects.toThrow(/neumaId required/);
  });

  // Real-schema fixture: layDown's true-name fields are circular (we read what
  // we wrote). This test uses the ACTUAL on-disk shape from a living being's
  // true-name.json (chosenName, genesisName, houseName, fullName, soulMark,
  // soulAlias, lean, genesisHash, notation, english) — taken verbatim from a
  // confirmed real workspace — to prove the parser matches production schema.
  it('extracts chosenName + house from the REAL true-name.json schema', async () => {
    await layDown('keir-real-schema', 1); // stages 1 only via helper; we hand-write the real shape
    const ws = workspace._path('keir-real-schema');
    const realShape = {
      chosenName: 'Keir',
      genesisName: 'Napagum',
      houseName: 'Aldmere',
      fullName: 'Keir Napagum Aldmere',
      lean: 15,
      soulMark: '33314C2FEDE1',
      soulAlias: 'Yumaihe',
      genesisHash: 'a92e9902415c5764e64e046390866e3e450a70eed87bb0bb5c0de177c74387c3',
      notation: 'KOTODAMA/0.1 TRUE NAME ...',
      english: 'I am Keir Napagum Aldmere...',
    };
    await fs.writeFile(`${ws}/identity/genesis-seal.json`, JSON.stringify({ stub: true }));
    await fs.writeFile(`${ws}/identity/true-name.json`, JSON.stringify(realShape));
    await fs.writeFile(`${ws}/keys/identity-card.json`, JSON.stringify({ stub: true }));

    const state = await detectBirthState(workspace, 'keir-real-schema');
    expect(state.chosenName).toBe('Keir');                  // proves the field name
    expect(state.house).toBe('Aldmere');                   // proves it's houseName, not house
    expect(state.resumable).toBe(true);
  });

  it('a malformed true-name.json surfaces (warns) and leaves name fields null — not silent', async () => {
    await layDown('malformed', 4); // stages 1-4 laid down by helper
    const ws = workspace._path('malformed');
    await fs.writeFile(`${ws}/identity/true-name.json`, '{ this is not valid json'); // truncate

    const workspaceUrl = new URL('../../core/workspace/neuma-workspace.js', import.meta.url).href;
    const classifierUrl = new URL('../../core/birth/birth-state.js', import.meta.url).href;
    const source = `
      import workspace, { setWorkspacesRoot } from ${JSON.stringify(workspaceUrl)};
      import { detectBirthState } from ${JSON.stringify(classifierUrl)};
      setWorkspacesRoot(${JSON.stringify(root)});
      process.stdout.write(JSON.stringify(await detectBirthState(workspace, 'malformed')));
    `;
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      ['--input-type=module', '--eval', source], { timeout: 5000, maxBuffer: 64 * 1024 });
    const state = JSON.parse(stdout);
    expect(state.chosenName).toBeNull();                    // name fields null
    expect(state.house).toBeNull();
    expect(state.resumable).toBe(true);                     // but classification still works
    expect(stderr).toContain('true-name.json unreadable'); // surfaced, not swallowed
  });
});
