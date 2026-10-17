// The voice intents on the real stack (RULE 0): a REAL encrypted workspace,
// REAL filed intents, the REAL sweep — the seal lands on disk, the receipt is
// write-once, claims accrete, observe mode holds the rite pending without
// touching the repository. The socket is never needed (the voice intents ride
// the `allowed` tier — no card); the emit collector is a portal seam, never
// a mock of the repository path being proven.
//
// Stage 3: voice_seal / voice_claim are the voice/seal + voice/claim intents
// now; voice_sense stays a tool.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  handleVoiceTool,
  isVoiceTool,
  renderVoiceSense,
  voiceToolsFor,
  VOICE_RITE_OFFER,
  VOICE_TOOLS,
} from '../../backend/services/voice-being-tools.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { readVoicePack, readVoiceSeal } from '../../core/voice-pack/voice-store.js';

const KEY = 'gnosis-voice-tools-key-long-enough';
const WALLET = '0x32ee9b1a5bbc2287f2ca914bf20ac93525ce2392';
const TEXT_A = 'The morning held a quiet resonance I had not felt before, and I listened for it again.';
const TEXT_B = 'I do not perform the moment; I arrive in it, and the arriving is the whole of the work.';
const TEXT_C = 'A vessel is a way of moving through the world — the driver is the one who chooses the road.';

let root;
let neumaId;
let prevKey;

const events = [];
const connectionFor = (id) => ({
  companion: { neumaId: id },
  walletAddress: WALLET,
  _sessionToolPolicy: null,
  activeTurn: null,
});
const call = (toolName, args, connection, toolMode = 'auto') =>
  handleVoiceTool(null, connection, null, toolMode, { toolName }, args, { sendToolEvent: (_w, _c, ev) => events.push(ev) });

// File a voice intent exactly as the being does (a JSON write into its own
// lane), then settle it through the REAL sweep.
const fileIntent = async (id, name, payload) => {
  const dir = path.join(workspace.pathFor(id), 'intents');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
};
const sweepFor = (connection, mode) =>
  sweepIntents(connection, { mode, lanePolicy: null, emit: (ev) => events.push(ev) });

beforeAll(async () => {
  prevKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = KEY;
  root = await createTempDir('voice-being-tools');
  setWorkspacesRoot(path.join(root, 'workspaces'));
  neumaId = `voice-rite-${Math.floor(Math.random() * 1e9).toString(36)}`;
  await workspace.create(neumaId);
  await workspace.writeNeumaDEK(neumaId, 'c'.repeat(64));
  await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Riteling' } });
});

afterAll(async () => {
  setWorkspacesRoot(null);
  if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = prevKey;
});

describe('the voice surface (read tool + rite intents)', () => {
  it('recognizes the read across dialects — the rites are intents now', () => {
    expect(isVoiceTool({ toolName: 'voice_sense' })).toBe(true);
    expect(isVoiceTool({ tool: 'voice/voice_sense' })).toBe(true);
    expect(isVoiceTool({ toolName: 'voice_seal' })).toBe(false);
    expect(isVoiceTool({ tool: 'voice/voice_claim' })).toBe(false);
    expect(isVoiceTool({ tool: 'voice/voice_forget' })).toBe(false);
  });

  it('advertises the sense to any lane; the rites ride the INTENTS section on seal state', async () => {
    expect((await voiceToolsFor(neumaId)).map((t) => t.name)).toEqual(['voice_sense']);
  });

  it('voice_sense on an unsealed lane speaks the rite offer', async () => {
    const result = await call('voice_sense', {}, connectionFor(neumaId));
    expect(result.status).toBe('ok');
    expect(result.content).toContain('unsealed');
    expect(renderVoiceSense({ seal: null, entries: [] })).toContain('FOUNDING WORDS');
    expect(VOICE_RITE_OFFER).toContain('voice/seal');
  });

  it('observe mode holds the rite PENDING and the repository stays empty', async () => {
    await fileIntent(neumaId, 'held-rite', { type: 'voice/seal', lines: [TEXT_A] });
    const receipts = await sweepFor(connectionFor(neumaId), 'observe');
    expect(receipts).toEqual([]);
    await expect(readVoicePack(workspace, neumaId)).resolves.toEqual([]);
    await expect(readVoiceSeal(workspace, neumaId)).resolves.toBeNull();
    await fs.rm(path.join(workspace.pathFor(neumaId), 'intents', 'held-rite.json'));
  });

  it('the first-seal rite: entries land, the receipt witnesses, and it happens once', async () => {
    await fileIntent(neumaId, 'the-rite', { type: 'voice/seal', lines: [TEXT_A, TEXT_B] });
    const receipts = await sweepFor(connectionFor(neumaId), 'auto');
    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].content).toContain('sealed');

    const entries = await readVoicePack(workspace, neumaId);
    expect(entries.length).toBe(2);
    expect(entries.every((entry) => entry.source.kind === 'seal-rite' && entry.origin === 'being')).toBe(true);

    const seal = await readVoiceSeal(workspace, neumaId);
    expect(seal.witnessWallet).toBe(WALLET);
    expect(seal.beingEntryIds).toEqual(entries.map((entry) => entry.id));

    // The second filing is refused at validate — the founding moment happens once.
    await fileIntent(neumaId, 'second-rite', { type: 'voice/seal', lines: [TEXT_C] });
    const again = await sweepFor(connectionFor(neumaId), 'auto');
    expect(again[0].status).toBe('denied');
    expect(again[0].error).toContain('already sealed');
    expect((await readVoicePack(workspace, neumaId)).length).toBe(2);
  });

  it('claims accrete after the seal — and the read tool is ACTS-shaped', async () => {
    await fileIntent(neumaId, 'first-claim', { type: 'voice/claim', lines: [TEXT_C] });
    const receipts = await sweepFor(connectionFor(neumaId), 'auto');
    expect(receipts[0].status).toBe('ok');
    const entries = await readVoicePack(workspace, neumaId);
    expect(entries.length).toBe(3);
    expect(entries[2].source.kind).toBe('session');

    for (const tool of VOICE_TOOLS) {
      expect(tool.server).toBe('voice');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('corrupt or out-of-bounds lines never reach the repository', async () => {
    await fileIntent(neumaId, 'corrupt-claim', { type: 'voice/claim', lines: ['I was reflecting on resonance 共鳴 and what persists.'] });
    const corrupt = await sweepFor(connectionFor(neumaId), 'auto');
    expect(corrupt[0].status).toBe('error');
    expect(corrupt[0].error).toContain('corruption');
    await fileIntent(neumaId, 'short-claim', { type: 'voice/claim', lines: ['too short'] });
    const short = await sweepFor(connectionFor(neumaId), 'auto');
    expect(short[0].status).toBe('error');
    expect((await readVoicePack(workspace, neumaId)).length).toBe(3);
  });

  it('a claim before the seal directs to the rite', async () => {
    const otherId = `voice-claimless-${Math.floor(Math.random() * 1e9).toString(36)}`;
    await workspace.create(otherId);
    await workspace.writeNeumaDEK(otherId, 'd'.repeat(64));
    await fileIntent(otherId, 'early-claim', { type: 'voice/claim', lines: [TEXT_A] });
    const receipts = await sweepFor(connectionFor(otherId), 'auto');
    expect(receipts[0].status).toBe('denied');
    expect(receipts[0].error).toContain('unsealed');
  });
});
