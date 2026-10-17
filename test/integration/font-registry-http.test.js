// Real signed authentication and vendored bytes through the production router.
import { test, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFile } from 'node:fs/promises';
import brandRoutes from '../../backend/routes/brand-routes.js';
import { EMBEDDABLE } from '../../backend/services/branding/embeddable-faces.js';
import { fullAuth } from '../helpers/audit-auth.js';

test('font registry retains authenticated listing and exact registered file delivery', async () => {
  const app = express();
  app.use('/api/v1/brands', brandRoutes);
  const { token } = await fullAuth();
  const get = (url) => request(app).get(url).set('Authorization', `Bearer ${token}`);
  expect((await request(app).get('/api/v1/brands/faces')).status).toBe(401);
  const response = await get('/api/v1/brands/faces');
  expect(response.status).toBe(200);
  const ids = response.body.families.flatMap((family) => family.weights.map((face) => face.id));
  expect(ids.sort()).toEqual(Object.keys(EMBEDDABLE).sort());
  expect(JSON.stringify(response.body)).not.toContain('/branding/fonts/');
  for (const [id, face] of Object.entries(EMBEDDABLE)) {
    const served = await get(`/api/v1/brands/faces/${id}/file`);
    expect(served.status).toBe(200);
    expect(served.body).toEqual(await readFile(face.file));
  }
  expect((await get('/api/v1/brands/faces/__proto__/file')).status).toBe(404);
  expect((await get('/api/v1/brands/faces/unknown-face/file')).status).toBe(404);
  const native = await request(app).get(`/api/v1/brands/faces/grotesk-light/file?token=${token}`);
  expect(native.status).toBe(200);
  expect(native.body).toEqual(await readFile(EMBEDDABLE['grotesk-light'].file));
});
