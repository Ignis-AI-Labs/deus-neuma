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
    expect(res.body.changelog[0].version).toBe(pkg.version);
    expect(res.body.changelog[0].date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(res.body.changelog[0].text.length).toBeGreaterThan(0);
  });
});
