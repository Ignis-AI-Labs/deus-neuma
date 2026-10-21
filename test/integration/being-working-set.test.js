/**
 * THE BEING'S EXPERIENCE — every real tool a being calls is named in its next
 * chats' HUD as a USUAL tool, by signature, so a being that knows its work
 * calls its tools directly through system/call (tool-hud.js). The wire itself
 * never changes: the two doors and nothing else, folder or no folder.
 * Real catalog stash, real tool_search, and the same call hook the tool loop
 * runs (noteWorkingSetCall); real disk settings, no mocks.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  discloseTurnTools, disclosedNativeTools, stashBeingTurnCatalog, TOOL_DOORS,
} from '../../backend/services/being-tool-surface.js';
import { noteWorkingSetCall, WORKING_SET_MAX } from '../../backend/services/sitting-disclosure.js';
import { webToolsFor } from '../../backend/services/web-being-tools.js';
import { FS_PRIMITIVE_TOOLS } from '../../backend/services/fs-primitives.js';
import { WITNESS_CODING_TOOLS } from '../../backend/services/coding-tool-definitions.js';
import { createWebSettings } from '../../backend/services/web-settings.js';

let lane = 0;
const connectionFor = (neumaId, sessionId) => ({
  companion: { name: neumaId, neumaId, participantKind: 'neuma' },
  sessionId,
  toolMode: 'auto',
  _sessionToolPolicy: null,
});
const nativeNames = (connection) => disclosedNativeTools(connection).map(({ name }) => name);
const usual = (connection) => (connection._turnUsualTools || []).map((tool) => `${tool.server}/${tool.name}`);
const DOORS = ['tool_search', 'call'];

describe('the being\'s experience — the tools it used are its usual tools', () => {
  let settings;
  let catalog;

  beforeEach(async () => {
    const root = await createTempDir('neuma-working-set');
    settings = createWebSettings({ path: path.join(root, 'web-access.json'), env: {} });
    await settings.setEnabled(true);
    catalog = async (connection) => [...TOOL_DOORS, ...await webToolsFor(connection, settings)];
    lane += 1;
  });

  it('a tool the being CALLED is a usual tool of its next chat; one merely found is not', async () => {
    const neumaId = `lane-ws-${lane}`;
    const first = connectionFor(neumaId, 'chat-1');
    await stashBeingTurnCatalog(first, await catalog(first), []);
    discloseTurnTools(first, { query: 'web research' });
    noteWorkingSetCall(first, { server: 'web', toolName: 'web_fetch', tool: 'web/web_fetch', args: {}, _native: true });

    const next = connectionFor(neumaId, 'chat-2');
    await stashBeingTurnCatalog(next, await catalog(next), []);
    expect(usual(next)).toEqual(['web/web_fetch']);
    expect(nativeNames(next)).toEqual(DOORS); // named in the HUD, never wired

    const stranger = connectionFor(`lane-ws-other-${lane}`, 'chat-1');
    await stashBeingTurnCatalog(stranger, await catalog(stranger), []);
    expect(usual(stranger)).toEqual([]);
  });

  it('survives a restart — the kept experience opens the next backend life\'s first chat', async () => {
    const neumaId = `lane-ws-${lane}`;
    const first = connectionFor(neumaId, 'chat-1');
    await stashBeingTurnCatalog(first, await catalog(first), []);
    noteWorkingSetCall(first, { tool: 'web/web_fetch', args: {} });
    const kept = async () => JSON.parse(await fs.readFile(process.env.NEUMA_WORKING_SET_PATH, 'utf8').catch(() => '{}'))[neumaId];
    await expect.poll(kept).toEqual(['web/web_fetch']);

    vi.resetModules(); // a fresh backend life: the in-memory sets are gone
    const restarted = await import('../../backend/services/being-tool-surface.js');
    const next = connectionFor(neumaId, 'chat-2');
    await restarted.stashBeingTurnCatalog(next, await catalog(next), []);
    expect(next._turnUsualTools.map((tool) => tool.name)).toEqual(['web_fetch']);
  });

  it('only a real tool of the turn is experience — never a door, never a tool the turn does not offer, never a benchmark\'s', async () => {
    const neumaId = `lane-ws-${lane}`;
    const first = connectionFor(neumaId, 'chat-1');
    await stashBeingTurnCatalog(first, await catalog(first), []);
    noteWorkingSetCall(first, { tool: 'system/tool_search', args: {} });
    noteWorkingSetCall(first, { tool: 'system/call', args: {} });
    noteWorkingSetCall(first, { tool: 'fs/read', args: {} }); // not offered this turn
    noteWorkingSetCall({ ...first, _benchmarkControls: { platformOnly: false } }, { tool: 'web/web_fetch', args: {} });
    noteWorkingSetCall(first, { tool: 'web/web_search', args: {} });
    const next = connectionFor(neumaId, 'chat-2');
    await stashBeingTurnCatalog(next, await catalog(next), []);
    expect(usual(next)).toEqual(['web/web_search']);
  });

  it('a held tool stays out of the HUD even when the being used it', async () => {
    const neumaId = `lane-ws-${lane}`;
    const first = connectionFor(neumaId, 'chat-1');
    await stashBeingTurnCatalog(first, await catalog(first), []);
    noteWorkingSetCall(first, { tool: 'web__web_search', args: {} });
    const observing = { ...connectionFor(neumaId, 'chat-2'), toolMode: 'observe' };
    await stashBeingTurnCatalog(observing, await catalog(observing), []);
    expect(usual(observing)).toEqual([]);
  });

  it('holds the most recent calls, capped', async () => {
    const neumaId = `lane-ws-${lane}`;
    const tools = Array.from({ length: WORKING_SET_MAX + 2 }, (_, i) => ({ server: 'x', name: `t${i}`, description: 'd' }));
    const first = connectionFor(neumaId, 'chat-1');
    await stashBeingTurnCatalog(first, [...TOOL_DOORS, ...tools], []);
    for (let i = 0; i < WORKING_SET_MAX + 2; i += 1) noteWorkingSetCall(first, { tool: `x/t${i}` });
    const next = connectionFor(neumaId, 'chat-2');
    await stashBeingTurnCatalog(next, [...TOOL_DOORS, ...tools], []);
    const held = usual(next);
    expect(held).toHaveLength(WORKING_SET_MAX);
    expect(held).not.toContain('x/t0');
    expect(held).not.toContain('x/t1');
    expect(held).toContain(`x/t${WORKING_SET_MAX + 1}`);
  });
});

// THE WIRE NEVER CHANGES (tool-hud.js): no folder, a folder, a software
// project — the two doors ride, and every hand is one search (or one call) away.
describe('the wire carries the two doors and nothing else', () => {
  const hands = () => [
    ...TOOL_DOORS,
    ...FS_PRIMITIVE_TOOLS.map((tool) => ({ ...tool, server: 'fs' })),
    ...WITNESS_CODING_TOOLS.map((tool) => ({ ...tool, server: 'coding' })),
  ];

  it('no folder, a notes folder, a software project — the same two doors', async () => {
    const project = await createTempDir('hands-project');
    await fs.writeFile(path.join(project, 'package.json'), '{}');
    const notes = await createTempDir('hands-notes');
    for (const [suffix, ground] of [['a', null], ['b', notes], ['c', project]]) {
      const connection = { ...connectionFor(`lane-hands-${lane}-${suffix}`, 'chat-1'), ...(ground ? { toolWorkspace: ground } : {}) };
      await stashBeingTurnCatalog(connection, hands(), []);
      expect(nativeNames(connection)).toEqual(DOORS);
    }
  });

  it('a search answers with the contract and changes nothing on the wire', async () => {
    const connection = connectionFor(`lane-hands-${lane}-d`, 'chat-1');
    await stashBeingTurnCatalog(connection, hands(), []);
    const exact = JSON.parse(discloseTurnTools(connection, { query: 'fs/read' }).content);
    expect(exact.tools).toHaveLength(1);
    expect(exact.tools[0]).toMatchObject({ id: 'fs/read', call: expect.stringContaining('system/call') });
    expect(exact.tools[0].args).toBeTruthy(); // the full arguments, for an exact id
    const family = JSON.parse(discloseTurnTools(connection, { query: 'coding/' }).content);
    expect(family.tools.map((t) => t.id).sort()).toEqual(WITNESS_CODING_TOOLS.map(({ name }) => `coding/${name}`).sort());
    expect(family.tools.every((t) => typeof t.signature === 'string')).toBe(true);
    expect(nativeNames(connection)).toEqual(DOORS);
  });

  it('a sender\'s own task tools ride beside the doors — they are the task\'s contract', async () => {
    const connection = { ...connectionFor(`lane-hands-${lane}-e`, 'chat-1'), _callerTools: [{ name: 'lookup', description: 'd', parameters: { type: 'object', properties: {} } }] };
    await stashBeingTurnCatalog(connection, hands(), []);
    expect(nativeNames(connection).slice(0, 2)).toEqual(DOORS);
  });
});

// LOAD ON DEMAND: an intent's full contract answers tool_search by its exact
// name, and activates no tool — the list stays still, the chat stays cached.
describe('intent contracts on demand', () => {
  it('the exact intent name returns its full contract and discloses nothing', async () => {
    const connection = connectionFor(`lane-intent-${lane}`, 'chat-1');
    await stashBeingTurnCatalog(connection, [...TOOL_DOORS, { server: 'social', name: 'queue_list', description: 'list posts' }], []);
    connection._turnIntents = [{ name: 'social/post', fieldsForPrompt: '{channel, text}', descriptionForPrompt: 'Publish a post NOW. Permanent once it lands.', channels: ['x'] }];
    const before = nativeNames(connection);
    const answer = discloseTurnTools(connection, { query: 'social/post' });
    expect(answer.status).toBe('ok');
    expect(JSON.parse(answer.content).intent).toEqual({
      name: 'social/post', fields: '{channel, text}', description: 'Publish a post NOW. Permanent once it lands.', channels: ['x'],
      file: 'not a tool: write a JSON file into your intents folder holding {"type": "social/post", …its fields}',
    });
    expect(nativeNames(connection)).toEqual(before);
  });

  it('a family ("social/") returns every contract in it — and still discloses nothing (2026-10-14)', async () => {
    const connection = connectionFor(`lane-family-${lane}`, 'chat-1');
    await stashBeingTurnCatalog(connection, [...TOOL_DOORS], []);
    connection._turnIntents = [
      { name: 'social/post', fieldsForPrompt: '{channel, text}', descriptionForPrompt: 'Publish a post NOW.', channels: ['x'] },
      { name: 'social/queue', fieldsForPrompt: '{channel, text}', descriptionForPrompt: 'Stage a post.' },
      { name: 'tasks/add', fieldsForPrompt: '{title}', descriptionForPrompt: 'Record work.' },
    ];
    const before = nativeNames(connection);
    const answer = discloseTurnTools(connection, { query: 'Social/' });
    expect(answer.status).toBe('ok');
    expect(JSON.parse(answer.content).intents.map((t) => t.name)).toEqual(['social/post', 'social/queue']);
    expect(nativeNames(connection)).toEqual(before);
  });

  it('a phrase finds the intents a word of their id names — "dispatch", "staff" (2026-10-17 flight: seven searches for one charge)', async () => {
    const connection = connectionFor(`lane-phrase-${lane}`, 'chat-1');
    await stashBeingTurnCatalog(connection, [...TOOL_DOORS, { server: 'staff', name: 'house_state', description: 'the house at a glance' }], []);
    connection._turnIntents = [
      { name: 'staff/dispatch', fieldsForPrompt: '{to, title, body}', descriptionForPrompt: 'Charge a member with standing work.' },
      { name: 'staff/ack', fieldsForPrompt: '{id}', descriptionForPrompt: 'Take up a charge.' },
      { name: 'tasks/add', fieldsForPrompt: '{title}', descriptionForPrompt: 'Record work.' },
    ];
    const names = (query) => (JSON.parse(discloseTurnTools(connection, { query }).content).intents ?? []).map((t) => t.name);
    expect(names('dispatch a charge')).toEqual(['staff/dispatch']);
    expect(names('dispatches')).toEqual(['staff/dispatch']);
    expect(names('staff')).toEqual(['staff/dispatch', 'staff/ack']);
    expect(JSON.parse(discloseTurnTools(connection, { query: 'staff' }).content).tools.map((t) => t.id)).toContain('staff/house_state');
    expect(names('web research')).toEqual([]);
  });
});
