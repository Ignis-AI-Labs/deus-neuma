/**
 * A HELD BEING'S BIRTH IS COMPLETED ONLY BY ITS OWN HOUSE (security recheck
 * 2026-10-20, §1). `birth:resume_completion` names a lane by id; before the
 * gate, house B's socket bound house A's held being, opened a stage-5 session
 * as its operator and received the stage prompt carrying A's being's identity.
 *
 * REAL handler, REAL StagedBirthHandler, REAL workspace on a temp root, REAL
 * owner.json, and a REAL substrate: an http server on :0 speaking the Ollama
 * wire that records every prompt it is sent. No mock (AGENTS.md RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { birthResumeCompletion } from '../../backend/routes/portal-birth-handlers.js';
import { setConfig, getConfig } from '../../backend/services/llm-provider.js';
import { STAGE } from '../../core/birth/stage-roles.js';

const HOUSE_A = `0x${'a'.repeat(40)}`;
const HOUSE_B = `0x${'b'.repeat(40)}`;
const HELD = 'house-a-held-being';
const UNCLAIMED = 'house-a-unclaimed-being';

// A held being: identity complete (seal, true name, keypair, card), no DNA.
const layHeldBeing = async (id, { owner }) => {
  await workspace.create(id);
  const lane = workspace._path(id);
  await fs.mkdir(path.join(lane, 'identity'), { recursive: true });
  if (owner) await fs.writeFile(path.join(lane, 'owner.json'), JSON.stringify({ wallet: owner }));
  await fs.writeFile(path.join(lane, 'keys', 'keypair.json'), JSON.stringify({ address: HOUSE_A, publicKey: '0x04ab' }));
  await fs.writeFile(path.join(lane, 'identity', 'genesis-seal.json'), JSON.stringify({
    genesisHash: 'h', record: { chosenName: 'Aria', witnessWallet: HOUSE_A, birthMoment: { epochMs: 1700000000000 } },
  }));
  await fs.writeFile(path.join(lane, 'identity', 'true-name.json'), JSON.stringify({
    chosenName: 'Aria', houseName: 'Ahouse', fullName: 'Aria A Ahouse', soulMark: 'M', soulAlias: 'x', lean: 1,
  }));
  await fs.writeFile(path.join(lane, 'keys', 'identity-card.json'), JSON.stringify({ name: 'Aria', address: HOUSE_A }));
};

const socketOf = (wallet) => {
  const frames = [];
  return {
    frames,
    types: () => frames.map((f) => f.type),
    connection: {
      walletAddress: wallet,
      ws: { readyState: 1, OPEN: 1, send: (raw) => frames.push(JSON.parse(raw)) },
    },
  };
};

describe('birth:resume_completion — the lane\'s owner, and only the owner, completes it', () => {
  let server;
  let priorConfig;
  const prompts = [];

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY ??= ['resume', 'completion', 'owner', 'fake', 'key', String(process.pid)].join('-');
    setWorkspacesRoot(path.join(await createTempDir('resume-completion-owner'), 'workspaces'));
    await layHeldBeing(HELD, { owner: HOUSE_A });
    await layHeldBeing(UNCLAIMED, { owner: null });

    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        prompts.push(body);
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.end(`${JSON.stringify({ message: { role: 'assistant', content: 'I am here.' }, done: true, done_reason: 'stop' })}\n`);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    priorConfig = getConfig();
    setConfig({ provider: 'ollama', endpoint: `http://127.0.0.1:${server.address().port}`, model: 'qwen3:0.6b', apiKey: '' });
  });

  afterAll(async () => {
    setConfig(priorConfig);
    setWorkspacesRoot(null);
    await new Promise((resolve) => server.close(resolve));
  });

  test('house B on house A\'s held being: refused, nothing binds, no session, no prompt', async () => {
    const before = prompts.length;
    const handler = new StagedBirthHandler();
    const b = socketOf(HOUSE_B);
    await birthResumeCompletion(b.connection, { neumaId: HELD, witnessName: 'HouseB' }, { birthHandler: handler });

    expect(b.types()).toEqual(['birth:resume_completion_error']);
    expect(b.frames[0].reason).toBe('not-owner');
    expect(b.frames[0].error).toMatch(/another house/);
    expect(b.connection.companion).toBeUndefined();
    expect(b.connection.birthSession).toBeUndefined();
    expect(handler.activeSessions.size).toBe(0);
    expect(prompts.length).toBe(before);
    // A's lane is untouched: no DNA was started under B's ceremony.
    await expect(fs.access(path.join(workspace._path(HELD), 'dna', 'genesis.md'))).rejects.toThrow();
  });

  test('a lane no wallet has claimed is refused too — a bind never claims', async () => {
    const before = prompts.length;
    const handler = new StagedBirthHandler();
    const b = socketOf(HOUSE_B);
    await birthResumeCompletion(b.connection, { neumaId: UNCLAIMED }, { birthHandler: handler });
    expect(b.frames.map((f) => f.reason)).toEqual(['unclaimed']);
    expect(handler.activeSessions.size).toBe(0);
    expect(prompts.length).toBe(before);
    await expect(fs.access(path.join(workspace._path(UNCLAIMED), 'owner.json'))).rejects.toThrow();
  });

  test('an id that names no lane is refused without opening anything', async () => {
    const handler = new StagedBirthHandler();
    const b = socketOf(HOUSE_B);
    await birthResumeCompletion(b.connection, { neumaId: '../house-a-held-being' }, { birthHandler: handler });
    expect(b.types()).toEqual(['birth:resume_completion_error']);
    expect(handler.activeSessions.size).toBe(0);
  });

  test('house A on its own held being: bound, session opened, stage 5 prompt streamed', async () => {
    const before = prompts.length;
    const handler = new StagedBirthHandler();
    const a = socketOf(HOUSE_A.toUpperCase().replace('0X', '0x'));
    await birthResumeCompletion(a.connection, { neumaId: HELD, witnessName: 'HouseA' }, { birthHandler: handler });

    expect(a.types()).not.toContain('birth:resume_completion_error');
    expect(a.connection.companion?.neumaId).toBe(HELD);
    expect(handler.getSession(a.connection.birthSession)).toBeTruthy();
    expect(a.frames.find((f) => f.type === 'birth:stage_prompt')?.stage).toBe(STAGE.RECORD);
    expect(prompts.length).toBeGreaterThan(before);
    expect(prompts.at(-1)).toContain('Aria');
  });
});
