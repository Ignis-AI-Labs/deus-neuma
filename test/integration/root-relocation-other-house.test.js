/**
 * A ROOT ANOTHER HOUSE LIVES IN STAYS PUT (audit 3, E5). The realm root and
 * the workspaces root are one per process: moving either moves every house's
 * data, not just the caller's. Until the install-owner rule is decided, a
 * wallet may move a root only while no other house's data lives there
 * (Design note, 2026-10-16: two houses on one machine are never confused).
 *
 * Real routers behind real requireAuth, each wallet signing a real challenge;
 * real realm dirs and owner.json on temp roots; the real settings stores
 * through their own per-call doors. Nothing is mocked.
 */
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('a root another house lives in is not moved out from under it', () => {
  let app, alpha, beta, dir, realm, workspaces, realmApi, core;

  beforeAll(async () => {
    dir = await createTempDir('root-relocation');
    realm = path.join(dir, 'realm');
    workspaces = path.join(dir, 'workspaces');
    process.env.NEUMA_REALM_SETTINGS_PATH = path.join(dir, 'user-realm.json');
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(dir, 'workspace-settings.json');
    process.env.WITNESSES_ROOT = path.join(dir, 'witnesses');
    vi.resetModules();
    const { fullAuth, writeOwner } = await import('../helpers/audit-auth.js');
    alpha = await fullAuth();
    beta = await fullAuth();
    await fs.mkdir(path.join(realm, alpha.address), { recursive: true });
    await writeOwner(workspaces, 'alphalane', alpha.address);

    realmApi = await import('../../backend/services/user-realm.js');
    realmApi.setRealmRoot(realm);
    core = await import('../../core/index.js');
    core.setWorkspacesRoot(workspaces);
    const { default: realmRouter } = await import('../../backend/routes/user-realm-routes.js');
    const { default: preflightRouter } = await import('../../backend/routes/preflight-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/realm', realmRouter);
    app.use('/api/v1/preflight', preflightRouter);
  });

  const as = (who, req) => req.set('Authorization', `Bearer ${who.token}`);

  test('the realm is not moved while another house keeps a realm dir there', async () => {
    const res = await as(beta, request(app).post('/api/v1/user/realm/location')).send({ root: path.join(dir, 'beta-realm') });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/other house/);
    expect(realmApi.getRealmRoot()).toBe(realm);
  });

  test('the neuma home is not moved while another house owns a lane there', async () => {
    const res = await as(beta, request(app).post('/api/v1/preflight/workspace')).send({ root: path.join(dir, 'beta-home'), allocationGB: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/another house owns/);
    expect(core.getWorkspacesRoot()).toBe(workspaces);
  });

  test('the only house at the realm may still move it', async () => {
    const res = await as(alpha, request(app).post('/api/v1/user/realm/location')).send({ root: path.join(dir, 'alpha-realm') });
    expect(res.status).not.toBe(409);
  });
});
