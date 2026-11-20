import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import router from '../../backend/routes/hook-routes.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { hookForDelivery } from '../../backend/services/hooks/hook-store.js';
import { verifyDelivery } from '../../backend/services/hooks/hook-verify.js';
import { createHmac } from 'node:crypto';

let root;
let priorRoot;
let priorData;
let auth;

beforeEach(async () => {
  root = await createTempDir('hook-management');
  priorRoot = getWorkspacesRoot();
  priorData = process.env.NEUMA_DATA_ROOT;
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  setWorkspacesRoot(path.join(root, 'workspaces'));
  auth = await fullAuth();
  await workspace.create('hook-seat');
  await writeOwner(path.join(root, 'workspaces'), 'hook-seat', auth.address);
});

afterEach(async () => {
  setWorkspacesRoot(priorRoot);
  if (priorData === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = priorData;
});

const appFor = (scope) => {
  const app = express();
  app.use((req, _res, next) => { req.accessScope = scope; next(); });
  app.use('/api/v1/hooks', router);
  return app;
};
const signed = (req) => req.set('Authorization', `Bearer ${auth.token}`);

describe('hook management stays at the local desk and its secrets stay encrypted', () => {
  test('local signed management creates and lists a hook; a remote desk cannot mint or read one', async () => {
    const local = appFor('local');
    const made = await signed(request(local).post('/api/v1/hooks')).send({ seat: 'hook-seat', source: 'github', name: 'repo events' });
    expect(made.status).toBe(201);
    expect(made.body.secret).toMatch(/^[a-f0-9]{64}$/);
    const listed = await signed(request(local).get('/api/v1/hooks'));
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(made.body.secret);

    const raw = await fs.readFile(path.join(root, 'data', 'hooks', 'hooks.json'), 'utf8');
    expect(raw).not.toContain(made.body.secret);
    expect(raw).toContain('secretEnvelope');
    const delivery = await hookForDelivery(made.body.hook.id);
    expect(delivery.secret).toBe(made.body.secret);
    const body = Buffer.from('{"action":"opened"}');
    const signature = createHmac('sha256', made.body.secret).update(body).digest('hex');
    expect(verifyDelivery({ source: 'github', secret: delivery.secret, raw: body, now: Date.now(), headers: {
      'x-hub-signature-256': `sha256=${signature}`, 'x-github-event': 'issues', 'x-github-delivery': 'real-delivery',
    } }).ok).toBe(true);

    const remote = appFor('remote');
    expect((await signed(request(remote).get('/api/v1/hooks'))).status).toBe(403);
    expect((await signed(request(remote).post('/api/v1/hooks')).send({ seat: 'hook-seat', source: 'github', name: 'standing wake' })).status).toBe(403);
    expect((await signed(request(remote).post(`/api/v1/hooks/${made.body.hook.id}/rotate`))).status).toBe(403);
    expect((await signed(request(remote).get(`/api/v1/hooks/${made.body.hook.id}/events`))).status).toBe(403);
    expect((await signed(request(remote).delete(`/api/v1/hooks/${made.body.hook.id}`))).status).toBe(403);
    expect(JSON.parse(raw).hooks).toHaveLength(1);
  });

  test('a legacy plaintext hook verifies and is encrypted on its next mutation', async () => {
    const id = 'hk_0123456789abcdef';
    const secret = 'f'.repeat(64);
    const file = path.join(root, 'data', 'hooks', 'hooks.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ hooks: [{ id, wallet: auth.address, seat: 'hook-seat', source: 'github', name: 'legacy', secret, seen: [] }] }));
    expect((await hookForDelivery(id)).secret).toBe(secret);
    const local = appFor('local');
    const rotated = await signed(request(local).post(`/api/v1/hooks/${id}/rotate`));
    expect(rotated.status).toBe(200);
    const raw = await fs.readFile(file, 'utf8');
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain(rotated.body.secret);
    expect((await hookForDelivery(id)).secret).toBe(rotated.body.secret);
  });
});
