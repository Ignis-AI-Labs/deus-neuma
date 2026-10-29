// The display view of a chat and the per-turn read behind it — the real
// workspace router, real session tokens, real lanes on real disk, really
// claimed (api-workspace-routes-full.test.js precedent). A long chat opens on
// its words; the heavy parts are read per turn, only by the lane's owner.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken } from '../../backend/services/auth.js';
import workspaceRouter from '../../backend/routes/workspace-routes.js';

let app; let wsRoot; let owner; let ownerToken; let strangerToken; let previousRoot;
const IMAGE = `data:image/png;base64,${Buffer.alloc(3000, 7).toString('base64')}`;
const THOUGHT = 'considering the harbour light '.repeat(40);
const DETAIL = 'line of a long tool result\n'.repeat(60);

beforeAll(async () => {
  owner = ethers.Wallet.createRandom();
  ownerToken = createSessionToken(owner.address);
  strangerToken = createSessionToken(ethers.Wallet.createRandom().address);
  previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('session-display-route');
  setWorkspacesRoot(wsRoot);
  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);
  await neumaWorkspace.create('display-lane');
  await claimOwner(wsRoot, 'display-lane', owner.address);
  await neumaWorkspace.appendMessage('display-lane', 'sess-long', { role: 'user', turnId: 't-1', content: 'look at this', images: [IMAGE] });
  await neumaWorkspace.appendMessage('display-lane', 'sess-long', {
    role: 'assistant', turnId: 't-1', content: 'I see it.',
    thoughts: [{ text: THOUGHT, mark: 0 }],
    tools: [{ tool: 'fs/read', status: 'ok', summary: 'read the file', detail: DETAIL, mark: 0 }],
    composition: { type: 'context:composition', totals: { tokens: 5000 } },
  });
  await neumaWorkspace.appendMessage('display-lane', 'sess-long', { role: 'user', content: 'a legacy row, no turnId', images: [IMAGE] });
});

afterAll(() => setWorkspacesRoot(previousRoot));

const get = (url, token = ownerToken) => request(app).get(url).set('Authorization', `Bearer ${token}`);

describe('the display view of a chat', () => {
  it('ships the words and the sizes, never the heavy parts', async () => {
    const res = await get('/api/v1/workspace/display-lane/sessions/sess-long?view=display');
    expect(res.status).toBe(200);
    const [ask, answer, legacy] = res.body.messages;
    expect(ask.images).toEqual([{ lazy: true, bytes: 3000 }]);
    expect(answer.content).toBe('I see it.');
    expect(answer.thoughts).toEqual([{ mark: 0, chars: THOUGHT.length, lazy: true }]);
    expect(answer.tools).toEqual([{ tool: 'fs/read', status: 'ok', summary: 'read the file', mark: 0, detailChars: DETAIL.length, lazy: true }]);
    expect(answer.composition).toBeUndefined();
    // a row from before THE TAKES has no address to fetch by — it passes whole
    expect(legacy.images).toEqual([IMAGE]);
    expect(res.body.takeCounts).toEqual({ 't-1': 1 });
    expect(JSON.stringify(res.body).length).toBeLessThan(JSON.stringify((await get('/api/v1/workspace/display-lane/sessions/sess-long')).body).length / 2);
  });

  it('the full record still answers without the view', async () => {
    const res = await get('/api/v1/workspace/display-lane/sessions/sess-long');
    expect(res.body.messages[1].thoughts[0].text).toBe(THOUGHT);
    expect(res.body.messages[1].composition).toBeDefined();
  });
});

describe('one turn, read when opened', () => {
  it('gives every row of the point, whole', async () => {
    const res = await get('/api/v1/workspace/display-lane/sessions/sess-long/turns/t-1');
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(res.body.rows[0].images[0]).toBe(IMAGE);
    expect(res.body.rows[1].tools[0].detail).toBe(DETAIL);
  });

  it('only the lane\'s owner may read it, and a malformed turn is refused', async () => {
    expect((await get('/api/v1/workspace/display-lane/sessions/sess-long/turns/t-1', strangerToken)).status).toBe(403);
    expect((await get('/api/v1/workspace/display-lane/sessions/sess-long/turns/t%2F..')).status).toBe(400);
  });
});
