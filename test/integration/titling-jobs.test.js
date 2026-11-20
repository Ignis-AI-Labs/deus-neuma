/**
 * NAMING CHATS AS A JOB (deus-neuma #28), through the real routes (titling-routes.js), the real
 * ownership guard, the real titler and a REAL loopback model server reached through the house's
 * own machine route: a job starts at once with its total, counts each chat as it lands, keeps its
 * titles, stops between chats when cancelled, refuses a lane that is not the caller's, and a second
 * start follows the running job. Nothing is mocked; no weights run.
 */
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';

const A = 'titlingjoba';
const B = 'titlingjobb';
const OTHER = 'titlingjobother';

describe('titling jobs', () => {
  let app, workspace, labels, provider, witness, previousLlmConfig;
  const own = async (id, wallet) => {
    await workspace.create(id);
    await fs.writeFile(path.join(workspace.root, id, 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
  };
  const seed = async (id, n) => {
    for (let i = 1; i <= n; i++) {
      await workspace.createSession(id, `session-${1700000000000 + i}`);
      await workspace.appendMessage(id, `session-${1700000000000 + i}`, { role: 'user', content: `topic ${i} of ${id}` });
      await workspace.appendMessage(id, `session-${1700000000000 + i}`, { role: 'assistant', content: `about topic ${i}` });
    }
  };
  const start = (body) => request(app).post('/api/v1/titling/jobs').set(witness.header).send(body);
  const read = (id) => request(app).get(`/api/v1/titling/jobs/${id}`).set(witness.header);
  const until = async (id, done) => {
    for (let i = 0; i < 200; i++) {
      const { body } = await read(id);
      if (done(body.job)) return body.job;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('the job never got there');
  };

  beforeEach(async () => {
    vi.resetModules();
    const core = await import('../../core/index.js');
    core.setWorkspacesRoot(await createTempDir(`tj-ws-${Math.random().toString(36).slice(2)}`));
    workspace = core.neumaWorkspace;
    const storeDir = await createTempDir(`tj-stores-${Math.random().toString(36).slice(2)}`);
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = `${storeDir}/provider-credentials.json`;
    process.env.NEUMA_ROUTES_PATH = `${storeDir}/neuma-routes.json`;
    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir(`tj-realm-${Math.random().toString(36).slice(2)}`));
    labels = await import('../../backend/services/user-chat-labels.js');
    // each naming takes a moment, as a local model does: progress and CANCEL have time to show
    provider = await startLocalProvider({ script: [{ reply: 'A Named Chat', delayMs: 250 }] });
    const llm = await import('../../backend/services/llm-provider.js');
    previousLlmConfig = llm.getConfig();
    llm.setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '' });
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    await own(A, witness.address);
    await own(B, witness.address);
    await own(OTHER, '0x000000000000000000000000000000000000dEaD');
    await seed(A, 3);
    await seed(B, 2);
    const { default: router } = await import('../../backend/routes/titling-routes.js');
    app = express();
    app.use('/api/v1/titling', router);
  });

  afterEach(async () => {
    delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    delete process.env.NEUMA_ROUTES_PATH;
    await provider?.close();
    if (previousLlmConfig) (await import('../../backend/services/llm-provider.js')).setConfig(previousLlmConfig);
  });

  it('starts at once with its total, counts every chat of every neuma named, and keeps the titles', async () => {
    const res = await start({ kind: 'chats', neumaIds: [A, B] });
    expect(res.status).toBe(202);
    expect(res.body.job).toMatchObject({ kind: 'chats', state: 'running', total: 5, done: 0 });
    const again = await start({ kind: 'chats', neumaIds: [A] });
    expect(again.body).toMatchObject({ alreadyRunning: true, job: { id: res.body.job.id } });
    const midway = await until(res.body.job.id, (j) => j.done >= 1);
    expect(midway.done).toBeLessThan(5);
    const end = await until(res.body.job.id, (j) => j.state !== 'running');
    expect(end).toMatchObject({ state: 'done', done: 5, total: 5, titled: 5, failed: 0 });
    const kept = await labels.getChatLabels(witness.address);
    expect(Object.keys(kept).filter((k) => k.startsWith(`${A}:`) || k.startsWith(`${B}:`))).toHaveLength(5);
  }, 30_000);

  it('CANCEL stops between chats; what it named stays', async () => {
    const res = await start({ kind: 'chats', neumaIds: [A], force: true });
    await until(res.body.job.id, (j) => j.done >= 1);
    const cancelled = await request(app).delete(`/api/v1/titling/jobs/${res.body.job.id}`).set(witness.header);
    expect(cancelled.status).toBe(200);
    const end = await until(res.body.job.id, (j) => j.state !== 'running');
    expect(end.state).toBe('cancelled');
    expect(end.done).toBeLessThan(3);
    const kept = Object.keys(await labels.getChatLabels(witness.address)).filter((k) => k.startsWith(`${A}:`));
    expect(kept.length).toBe(end.titled);
    expect(kept.length).toBeGreaterThan(0);
  }, 30_000);

  it('refuses a neuma that is not the caller\'s, and malformed requests', async () => {
    expect((await start({ kind: 'chats', neumaIds: [A, OTHER] })).status).toBe(403);
    expect((await start({ kind: 'chats', neumaIds: ['nolanehere'] })).status).toBe(404);
    expect((await start({ kind: 'chats', neumaIds: ['bad id!'] })).status).toBe(400);
    expect((await start({ kind: 'chats' })).status).toBe(400);
    expect((await start({ kind: 'everything' })).status).toBe(400);
    expect((await read('0000000000000000')).status).toBe(404);
  });
});
