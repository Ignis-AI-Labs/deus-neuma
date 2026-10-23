/**
 * /api/v1/version — the public read every party can pull (RULE 0: real route,
 * real repo files, and the public contract is proven by sending NO token and
 * getting the truth anyway).
 */
import express from 'express';
import request from 'supertest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import versionRouter from '../../backend/routes/version-routes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const app = express();
app.use('/api/v1/version', versionRouter);

describe('GET /api/v1/version', () => {
  test('public — no token — and serving the repo’s own version + changelog', async () => {
    const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
    const res = await request(app).get('/api/v1/version');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('NEUMA');
    expect(res.body.version).toBe(pkg.version);
    expect(Array.isArray(res.body.changelog)).toBe(true);
    // The newest SHIPPED section may trail package.json: the public sync raises the patch
    // version on every push, and a section is written only for a build that ships.
    const parts = (v) => v.split('.').map(Number);
    const [a, b] = [parts(res.body.changelog[0].version), parts(pkg.version)];
    const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    expect(cmp).toBeLessThanOrEqual(0);
    expect(res.body.changelog[0].date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(res.body.changelog[0].text.length).toBeGreaterThan(0);
  });
});
