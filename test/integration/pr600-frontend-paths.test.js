import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { getRoots, setRoots } from '../../backend/services/user-files.js';
import userFilesRouter from '../../backend/routes/user-files-routes.js';

let app; let root; let previousRoots; let token;

beforeAll(async () => {
  root = await createTempDir('root-grant');
  previousRoots = getRoots();
  setRoots([]);
  const wallet = ethers.Wallet.createRandom();
  token = createSessionToken(wallet.address);
  await makeInstallOwner(wallet.address);
  app = express();
  app.use(express.json());
  app.use('/api/v1/user/files', userFilesRouter);
});

afterAll(() => setRoots(previousRoots));

describe('P6-148 root grant validation', () => {
  it('refuses traversal before probe/persistence and still opens a legitimate root', async () => {
    const outside = await createTempDir('root-outside');
    const hostile = `${root}/../${path.basename(outside)}`;
    const refused = await request(app).post('/api/v1/user/files/roots')
      .set('Authorization', `Bearer ${token}`).send({ root: hostile });
    expect(refused.status).toBe(422);
    expect(getRoots()).toEqual([]);
    await expect(fs.access(path.join(outside, '.neuma-probe'))).rejects.toMatchObject({ code: 'ENOENT' });

    const opened = await request(app).post('/api/v1/user/files/roots')
      .set('Authorization', `Bearer ${token}`).send({ root });
    expect(opened.status).toBe(200);
    expect(opened.body.roots).toContain(root);
    await expect(fs.access(path.join(root, '.neuma-probe'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
