/* global AbortController */
/**
 * THE WITNESS SEAT HOLDS THE PLATFORM SURFACE (RULE 0).
 *
 * Design note, 2026-07-29, after watching a teammate's sealed GLM peer report its own
 * capability: […]
 *
 * The peer was telling the truth. On `dev` its catalog really was two entries.
 * `platformToolsFor` built ~20 capabilities as a sequence of unguarded awaits,
 * and TWO call sites had been swept into commits without their imports
 * (`imageToolsFor`, then the flight-check trio). The first `ReferenceError`
 * emptied the WHOLE surface — no wallet, no craft, no vault, no tasks, no
 * memory, not even `ask_operator` — and the witness runtime's catch reported it
 * as "platform surface unavailable" into a log nobody was reading.
 *
 * This test is the guard that class of failure needed. It builds a REAL witness
 * lane on disk and asks the REAL `toolsForWitness` what a sealed peer is
 * handed. Nothing is mocked: the workspace, the policy resolution, the tool
 * sandbox and every capability builder are the production article. A capability
 * whose import goes missing again cannot pass this file, because the tool it
 * builds simply will not be in the catalog.
 *
 * What is asserted is the UNCONDITIONAL floor only — the capabilities that need
 * nothing but a lane. Web egress, the image forge, the press and the mail room
 * all ride real switches, real engines and real credentials, so a machine
 * without them is honest, not broken, and this file does not pretend otherwise.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import neumaWorkspace, { setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { toolsForWitness } from '../../backend/services/witness-tools.js';
import { ensureTurnSandbox } from '../../backend/services/turn-sandbox.js';
import { platformToolsFor } from '../../backend/services/portal-tool-catalog.js';
import { registerFixtureAdapter } from '../helpers/refinement-registry-fixture.js';

const LANE_ID = 'witness-zai-coding-plan-Surface';

let root;
let connection;

const idsOf = (tools) => tools.map((tool) => `${tool.server}/${tool.name}`);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'witness-platform-surface-'));
  setWitnessesRoot(path.join(root, 'witnesses'));
  await neumaWorkspace.create(LANE_ID);
  connection = {
    walletAddress: '0xsurface',
    toolMode: 'ask',
    activeTurn: new AbortController(),
    companion: { name: 'Surface', neumaId: LANE_ID, participantKind: 'witness' },
  };
});

afterEach(async () => {
  setWitnessesRoot(null);
  await fs.rm(root, { recursive: true, force: true });
});

describe('the platform surface reaches a sealed witness seat', () => {
  // Every one of these needs nothing but a bound lane. If any is missing, a
  // capability builder threw and was swallowed, or its call site lost its
  // import — the exact defect that took a teammate's peer down to two tools.
  test.each([
    ['operator/ask_operator', 'the route to the operator'],
    ['system/flight_check', 'reading its own capacity'],
    ['wallet/wallet_view', 'its own address and balance'],
    ['vault/vault_read', 'reading its own sovereign vault'],
    ['tasks/task_list', 'its own working list'],
    ['memory/memory_note', 'deliberate remembering'],
    ['leads/lead_list', 'the house lead ledger'],
    ['marketing/campaign_list', 'the campaign bench'],
    ['social/queue_list', 'the post queue'],
    ['team/plan_submit', 'putting a plan before the operator'],
    // Handing the operator a formatted list needs no lane, no ground and no
    // switch, so it belongs in the floor rather than beside the conditional
    // capabilities (Design note, 2026-08-30: […]).
    ['house/share_findings', 'handing the operator a list it gathered'],
  ])('advertises %s — %s', async (id) => {
    const { tools } = await platformToolsFor(connection, { seat: 'witness' });
    expect(idsOf(tools)).toContain(id);
  });

  // THE CATALOG CUT (#414). The acts these carried are the vault/*, tasks/*
  // and leads/* INTENTS now, and advertising both spelt one act twice — 38% of
  // the catalog describing the same fourteen acts in two dialects, while the
  // prompt told the peer to file the intent. A peer reaches all of it; what it
  // no longer reads is the duplicate.
  test.each([
    ['vault/vault_save', 'vault/save'],
    ['vault/vault_publish', 'vault/publish'],
    ['tasks/task_add', 'tasks/add'],
    ['tasks/task_focus', 'tasks/focus'],
    ['tasks/task_take', 'tasks/take'],
    ['tasks/operator_task_add', 'tasks/operator-add'],
    ['leads/lead_add', 'leads/add'],
  ])('no longer advertises %s — the act is the %s intent', async (id) => {
    const { tools } = await platformToolsFor(connection, { seat: 'witness' });
    expect(idsOf(tools)).not.toContain(id);
  });

  test('the full witness catalog carries the platform surface, not just the lane tools', async () => {
    const { tools } = await toolsForWitness(connection, null);
    const ids = idsOf(tools);

    // The lane's own tools — present before this work and still present.
    expect(ids).toContain('context/map_read');
    // …and the platform beside them. The regression produced exactly two
    // entries, so the floor is stated as a number as well as by name: no
    // arithmetic on which switches happen to be on can bring a bound lane
    // near it.
    expect(ids).toContain('operator/ask_operator');
    expect(ids).toContain('system/flight_check');
    expect(tools.length).toBeGreaterThan(12);
  });

  test('every advertised tool is stamped with the tier the gate will enforce', async () => {
    const { tools } = await toolsForWitness(connection, null);
    const tiers = new Set(['allowed', 'approval_required', 'denied']);
    for (const tool of tools) expect(tiers).toContain(tool.access);
  });

  test('a newborn lane can still remember — memory_note needs no prior memory', async () => {
    // The chicken-and-egg Founder named: every other memory tool NAMES an existing
    // ref, so gating those on […] is honest. Gating the WRITE
    // that creates the first record is a lock whose key is inside the room.
    expect(await neumaWorkspace.hasObservations(LANE_ID)).toBe(false);

    const { tools } = await platformToolsFor(connection, { seat: 'witness' });
    const memory = idsOf(tools).filter((id) => id.startsWith('memory/'));
    // mind_note rides beside memory_note since S3b4 (009b76f3d): the mind's
    // working thought is a first-write too — neither names a prior record.
    // mind_read pulls the undercurrent on demand (2026-10-08) — no prior record named either.
    expect(memory).toEqual(['memory/memory_note', 'memory/mind_note', 'memory/mind_read']);
  });

  test('a lane with crystallized memory gets the whole memory hand', async () => {
    await neumaWorkspace.addObservation(LANE_ID, {
      content: 'the operator asked for capability parity across every witness provider',
      significance: 0.9,
    });
    expect(await neumaWorkspace.hasObservations(LANE_ID)).toBe(true);

    // Requestable recall and audit reads share the retained platform catalog.
    const { tools } = await platformToolsFor(connection, { seat: 'witness' });
    const memory = idsOf(tools).filter((id) => id.startsWith('memory/'));
    expect(memory).toContain('memory/memory_note');
    expect(memory).toContain('memory/memory_expand');
    expect(memory).toContain('memory/memory_search');
    expect(memory).toContain('memory/memory_list');
    expect(memory.length).toBeGreaterThan(1);
  });

  test('a refused snapshot costs the shell, never the turn — the first act learns why', async () => {
    // A real ensure failure (the focus is a file, not a directory): the
    // catalog must still assemble, and the peer must learn WHY (INFRA-014).
    // Load on demand (2026-10-04): nothing is swept before the message; the
    // first act that needs the shell prepares it, and the refusal lands there.
    const filePath = path.join(root, 'not-a-folder.txt');
    await fs.writeFile(filePath, 'file\n');
    const { sandbox, tools } = await toolsForWitness(connection, filePath);
    expect(sandbox).toBeNull();
    const ids = idsOf(tools);
    expect(ids).toContain('coding/sandbox_status');
    expect(ids).toContain('operator/ask_operator');
    expect(await ensureTurnSandbox(connection)).toBeNull();
    expect(connection._turnSandboxError).toContain('not an existing directory');
  });

  test('custody powers stay off the peer seat even when its lane carries tempting state', async () => {
    // A real committed v2 registry entry sitting in the lane's own directory:
    // the most tempting state a witness lane could carry. The seat is decided
    // by standing, not by what is on disk.
    await registerFixtureAdapter(neumaWorkspace, LANE_ID, 'foreign-adapter', {
      baseModel: 'vendor/model',
      custody: { subjectNeumaId: LANE_ID, sovereignDnaSha256: 'a'.repeat(64) },
    });
    const { tools } = await platformToolsFor(connection, { seat: 'witness' });
    const ids = idsOf(tools);
    expect(ids).toContain('team/plan_submit');
    expect(ids).not.toContain('wallet/wallet_send');
    expect(ids.some((id) => id.endsWith('/request_seal'))).toBe(false);
    expect(ids.some((id) => id.startsWith('refinement/'))).toBe(false);
    expect(ids).not.toContain('team/team_run');
    expect(ids).not.toContain('team/workspace_run');
  });
});
