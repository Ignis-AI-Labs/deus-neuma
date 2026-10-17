/**
 * Stage 3 batch-2 intents — the remaining ACT domains, proven end to end with
 * NO mock on the claimed paths (RULE 0): REAL tmp workspaces, REAL filed
 * intents, the REAL sweep, REAL stores, REAL subprocess for the arena run.
 *
 * What this suite proves per domain:
 *   ksp/command       — the seat law at validate, the shape law, and the real
 *                       bridge boundary (no KSP running → honest unavailability)
 *   media/save        — the web master switch as a validate-time standing rule
 *   image/generate    — engine/law honesty gates at validate, the content-law
 *                       screen refusing a banned class with NO card
 *   team/run          — a scripted-conduit run through the real harness (the
 *                       full conduit proof lives in team-run-tool.test.js)
 *   team/workspace-run — the FULL act: a real script executes in a real arena
 * The social/security/email/wallet/voice/refinement/house/sovereignty intents
 * carry their own suites.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';
import { setMediaSaveSeams } from '../../backend/services/intents/media-save.js';
import { setTeamRunSeams } from '../../backend/services/intents/team-run.js';
import { createWebSettings } from '../../backend/services/web-settings.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const NEUMA_ID = 'batch2echo';
const WITNESS = { name: 'PeerProbe', neumaId: 'witness-openai-PeerProbe', participantKind: 'witness' };
const ENV_KEYS = ['COMFYUI_INSTALL_DIR', 'COMFYUI_CONTENT_LAW_PATH', 'NEUMA_DATA_ROOT', 'NEUMA_STAFF_COS_PATH'];

describe('stage-3 batch-2 intents (real sweep + real stores, gnosis)', () => {
  let house, origRoot, intentsDir, savedEnv;

  const conn = (extra = {}) => ({
    companion: { name: 'Batch2Echo', neumaId: NEUMA_ID },
    ...extra,
  });
  const fileIntent = async (name, payload, laneId = NEUMA_ID) => {
    const dir = path.join(workspace.pathFor(laneId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
  };
  const readResult = async (name, laneId = NEUMA_ID) => {
    try {
      return JSON.parse(await fs.readFile(path.join(workspace.pathFor(laneId), 'intents', `${name}.result.json`), 'utf8'));
    } catch { return null; }
  };
  const sweep = (connection, mode = 'auto') =>
    sweepIntents(connection, { mode, lanePolicy: null, emit: () => {} });

  beforeAll(async () => {
    savedEnv = {};
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    house = await createTempDir('intent-b2-house');
    process.env.NEUMA_DATA_ROOT = house;
    // The Optio dispatch gate reads the designation store — never the
    // machine's live seat (a seated CoS on the rig denied every team act).
    process.env.NEUMA_STAFF_COS_PATH = path.join(house, 'staff-cos.json');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(path.join(house, 'workspaces'));
    await workspace.create(NEUMA_ID);
    intentsDir = path.join(workspace.pathFor(NEUMA_ID), 'intents');
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    setMediaSaveSeams(null);
    setTeamRunSeams(null);
    setWorkspacesRoot(origRoot);
    await fs.rm(house, { recursive: true, force: true });
  });

  test('ksp/command — a witness seat is refused at validate; a bad command is invalid; the bridge boundary is honest', async () => {
    await fileIntent('peer-command', { type: 'ksp/command', command: 'stage', reason: 'fire the mainsail' }, WITNESS.neumaId);
    const peer = await sweep(conn({ companion: WITNESS }));
    expect(peer[0].status).toBe('denied');
    expect(peer[0].error).toContain('local-custody authority');

    await fileIntent('bad-command', { type: 'ksp/command', command: 'do_a_barrel_roll', reason: 'x' });
    const bad = await sweep(conn());
    expect(bad[0].status).toBe('error');
    expect(bad[0].error).toContain('command must be one of');

    // No KSP, no kRPC — the real bridge answers its honest unavailability.
    await fileIntent('no-game', { type: 'ksp/command', command: 'stage', reason: 'prove the boundary' });
    const grounded = await sweep(conn());
    expect(grounded[0].status).toBe('error');
    expect(grounded[0].error).toMatch(/KSP bridge unavailable|connect/i);
  }, 60000);

  test('media/save — the master switch refuses at validate, before any card', async () => {
    const settings = createWebSettings({ path: path.join(house, 'web-access.json'), env: {} });
    await settings.setEnabled(false);
    setMediaSaveSeams({ settings });
    await fileIntent('switch-off', { type: 'media/save', url: 'https://cdn.example.com/x.png' });
    const receipts = await sweep(conn(), 'ask');
    expect(receipts[0].status).toBe('denied');
    expect(receipts[0].error).toContain('Web access is off');
    expect((await readResult('switch-off')).status).toBe('denied');
    setMediaSaveSeams(null);
  }, 30000);

  test('image/generate — the honesty gates and the content-law screen stand at validate, before any card', async () => {
    // COMFYUI_INSTALL_DIR deleted in beforeAll → the engine gate answers.
    await fileIntent('no-engine', { type: 'image/generate', prompt: 'a lighthouse at dusk' });
    const unready = await sweep(conn(), 'ask');
    expect(unready[0].status).toBe('denied');
    expect(unready[0].error).toMatch(/not installed/i);

    // A standing fake install (empty main.py + venv python — the real probe
    // reads exactly those two paths) puts the LAW screen in reach: a tmp law
    // banning one class, and a prompt carrying it, refused with the CLASS —
    // never the term (FR-31) — and never a card. The env cleanup rides a
    // finally, so a failed assertion can never poison the next test.
    try {
      const fakeInstall = path.join(house, 'comfy-install');
      await fs.mkdir(path.join(fakeInstall, '.venv', 'bin'), { recursive: true });
      await fs.writeFile(path.join(fakeInstall, 'main.py'), '# probe fixture\n');
      await fs.writeFile(path.join(fakeInstall, '.venv', 'bin', 'python'), '#!/bin/false\n');
      process.env.COMFYUI_INSTALL_DIR = fakeInstall;
      const lawPath = path.join(house, 'content-law.json');
      await fs.writeFile(lawPath, JSON.stringify({ classes: { bestiality: ['testbannedterm'] } }));
      process.env.COMFYUI_CONTENT_LAW_PATH = lawPath;

      await fileIntent('banned', { type: 'image/generate', prompt: 'testbannedterm in a field' });
      const refused = await sweep(conn(), 'ask');
      expect(refused[0].status).toBe('denied');
      expect(refused[0].error).toContain('Refused by content law (bestiality)');
      expect(refused[0].error).not.toContain('testbannedterm');

      // A clean prompt passes the screen and raises the card — the deny settles
      // it denied; nothing ever reaches the engine in this suite (the GPU leg
      // belongs to the excluded live lane).
      await fileIntent('clean-render', { type: 'image/generate', prompt: 'a lighthouse at dusk' });
      const connection = conn();
      connection.ws = { readyState: 1, OPEN: 1, send: (s) => { connection.__card = JSON.parse(s); } };
      const pending = sweep(connection, 'ask');
      await new Promise((r) => setTimeout(r, 50));
      expect(connection.__card?.type).toBe('tool:approval_request');
      expect(connection.__card?.tool).toBe('intents/image.generate');
      const { resolveToolApproval } = await import('../../backend/services/tool-approval.js');
      resolveToolApproval(connection, connection.__card.id, 'deny');
      const settled = await pending;
      expect(settled[0].status).toBe('denied');
    } finally {
      delete process.env.COMFYUI_INSTALL_DIR;
      delete process.env.COMFYUI_CONTENT_LAW_PATH;
    }
  }, 30000);

  test('team/run — the scripted harness settles the plan and the report reads attributed', async () => {
    const connection = conn({
      walletAddress: '0x1111111111111111111111111111111111111111',
      _approvedPlan: Object.freeze({
        name: 'B2 CREW',
        goal: 'Prove the filed run.',
        steps: Object.freeze([
          Object.freeze({ id: 'one', neumaId: NEUMA_ID, task: 'do the one thing', needs: Object.freeze([]) }),
        ]),
        memberNames: Object.freeze({ [NEUMA_ID]: 'Batch2Echo' }),
        approvedAt: new Date().toISOString(),
      }),
    });
    let settled = null;
    setTeamRunSeams({
      checkSubstrate: async () => true,
      getCapacity: async () => ({ maxParallel: 1 }),
      ask: async (id, _m, step) => `part from ${id}: ${step.id}\nSTATUS:\n${step.id} complete`,
      onSettled: (p) => { settled = p; },
    });
    await fileIntent('the-run', { type: 'team/run' });
    const receipts = await sweep(connection);
    setTeamRunSeams(null);
    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].content).toContain('at work in the background');
    // The run settles in the background; the lead's read is its report file.
    const outcome = await settled;
    const text = await fs.readFile(outcome.report, 'utf8');
    expect(text).toContain('all 1 steps');
    expect(text).toContain('one — Batch2Echo');
  }, 60000);

  test('team/workspace-run — the FULL act: a real script executes in the real arena', async () => {
    const arena = path.join(house, 'arena');
    await fs.mkdir(arena, { recursive: true });
    await fs.writeFile(path.join(arena, 'clean.py'), 'print("physics holds")\n');
    const connection = conn({ _teamWorkspace: { root: arena, budgetBytes: 1024 * 1024, usedBytes: 0 } });
    await fileIntent('arena-run', { type: 'team/workspace-run', file: 'clean.py' });
    const receipts = await sweep(connection);
    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].content).toContain('RAN CLEAN');
    expect(receipts[0].content).toContain('physics holds');
  }, 60000);

  test('availability — the batch-2 types offer themselves only where they can stand', async () => {
    // This lane: the seat-gated types ride (team, ksp), the switch is ON via
    // the seam (media/save offered), no engine (image/generate stays dark).
    const settings = createWebSettings({ path: path.join(house, 'web2.json'), env: {} });
    await settings.setEnabled(true);
    setMediaSaveSeams({ settings });
    const section = await intentSectionFor(conn());
    expect(section).toContain('team/run');
    expect(section).toContain('ksp/command');
    expect(section).toContain('media/save');
    expect(section).not.toContain('image/generate'); // no engine on this env
    setMediaSaveSeams(null);
  }, 30000);
});
