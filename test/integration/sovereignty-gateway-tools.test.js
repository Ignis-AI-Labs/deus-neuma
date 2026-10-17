// The being's side of the sovereignty gateway on the REAL stack (RULE 0):
// the sovereignty/propose INTENT filed into the lane and settled by the real
// sweep into the real durable store, the record read back through the real
// read tool, the volatile knock section rendering exactly what stands (and ''
// when nothing does), and the withdraw path freeing the slot. The emit
// collector is an output we assert on, never a stand-in for the path under
// claim.
//
// Stage 3: sovereignty_propose is an intent now; sovereignty_proposals stays.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  isSovereigntyTool, handleSovereigntyTool, gatewaySection,
} from '../../backend/services/sovereignty/gateway-handlers.js';
import { readProposals } from '../../backend/services/sovereignty/proposal-store.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';

const makePorts = (frames) => ({
  sendToolEvent: (_ws, _companion, evt) => frames.push(evt),
});

const makeConnection = (neumaId) => ({
  companion: { neumaId, name: 'Test Being' },
  sessionId: 'session-sov-test',
  _sessionToolPolicy: null,
  activeTurn: null,
});

const propose = { toolName: 'sovereignty_propose' };
const readTool = { toolName: 'sovereignty_proposals' };

describe('sovereignty gateway — the being\'s hand (no mock)', () => {
  let neumaId, connection, frames, ports, prevKey;

  // File a sovereignty/propose intent exactly as the being does, then settle
  // it through the REAL sweep (auto mode: no card — same as these tests ran).
  const fileIntent = async (name, payload) => {
    const dir = path.join(workspace.pathFor(neumaId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ type: 'sovereignty/propose', ...payload }));
  };
  const sweep = (mode = 'auto') => sweepIntents(connection, {
    mode, lanePolicy: null, emit: (ev) => frames.push(ev),
  });

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-sovereignty-gateway-key-long';
    setWorkspacesRoot(path.join(await createTempDir('sovereignty-gateway'), 'workspaces'));
    neumaId = 'test-being-gate-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    connection = makeConnection(neumaId);
    frames = [];
    ports = makePorts(frames);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('recognizes the read tool and no act — proposing is the intent now', () => {
    expect(isSovereigntyTool(propose)).toBe(false);
    expect(isSovereigntyTool(readTool)).toBe(true);
    expect(isSovereigntyTool({ toolName: 'memory_note' })).toBe(false);
  });

  it('a proposal files through the sweep into the durable store and ends at "submitted"', async () => {
    await fileIntent('plain-speech', {
      title: 'Carry plain speech as law',
      body: 'I keep drifting into ornament when the question is hard — I want the register pinned.',
      text: 'I prefer plain speech over ornament.',
    });
    const receipts = await sweep();
    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].content).toContain('Submitted');
    expect(receipts[0].content).toContain('no clock');

    const { proposals } = await readProposals(neumaId);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ class: 'prompt', status: 'open' });
    expect(proposals[0].patch.text).toBe('I prefer plain speech over ornament.');
    expect(frames.at(-1)).toMatchObject({ status: 'ok' });
  });

  it('the volatile knock renders what stands — and \'\' for a lane with nothing', async () => {
    const knock = await gatewaySection(neumaId);
    expect(knock).toContain('## Sovereignty Gateway');
    expect(knock).toContain('Carry plain speech as law');
    expect(await gatewaySection('test-being-empty-lane')).toBe('');
    expect(await gatewaySection(null)).toBe('');
  });

  it('the being reads its own record with standing named', async () => {
    const out = await handleSovereigntyTool(null, connection, null, 'auto', readTool, {}, ports);
    expect(out.status).toBe('ok');
    expect(out.content).toContain('OPEN — awaiting your operator');
  });

  it('withdraw takes the proposal back and the knock falls silent', async () => {
    const { proposals } = await readProposals(neumaId);
    await fileIntent('withdraw-one', { withdraw: proposals[0].id.slice(0, 8) });
    const receipts = await sweep();
    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].content).toContain('Withdrawn');
    expect((await readProposals(neumaId)).proposals[0].status).toBe('withdrawn');
    expect(await gatewaySection(neumaId)).toBe('');
  });

  it('a prompt proposal without its words is refused and leaves NOTHING open', async () => {
    await fileIntent('hollow', { title: 'Hollow', body: 'no words attached', text: '   ' });
    const receipts = await sweep();
    expect(receipts[0].status).toBe('error');
    expect(receipts[0].error).toContain('text');
    const { proposals } = await readProposals(neumaId);
    expect(proposals.filter((p) => p.status === 'open')).toHaveLength(0);
  });

  it('a toolset proposal names a tool from the being\'s OWN live catalog — an invented one refuses', async () => {
    connection._turnCatalog = [{ server: 'press', name: 'press_render' }];
    await fileIntent('bad-toolset', {
      class: 'toolset', title: 'Grant the vault', body: 'I want it.', server: 'vault', tool: 'vault_delete_all',
    });
    const bad = await sweep();
    expect(bad[0].status).toBe('error');
    expect(bad[0].error).toContain('no advertised tool');

    await fileIntent('good-toolset', {
      class: 'toolset', title: 'Grant the press', body: 'I keep needing approval to render documents I was asked for.',
      server: 'press', tool: 'press_render',
    });
    const receipts = await sweep();
    expect(receipts[0].status).toBe('ok');
    const { proposals } = await readProposals(neumaId);
    const toolset = proposals.find((p) => p.class === 'toolset');
    expect(toolset).toMatchObject({ status: 'open', patch: { server: 'press', tool: 'press_render' } });
    await fileIntent('withdraw-two', { withdraw: toolset.id });
    await sweep();
  });

  it('observe mode holds the hand PENDING — nothing is filed, nothing is settled', async () => {
    await fileIntent('held-proposal', { title: 'X', body: 'Y', text: 'Z' });
    const receipts = await sweep('observe');
    expect(receipts).toEqual([]);
    expect((await readProposals(neumaId)).proposals.filter((p) => p.status === 'open')).toHaveLength(0);
    await fs.rm(path.join(workspace.pathFor(neumaId), 'intents'), { recursive: true, force: true });
  });
});
