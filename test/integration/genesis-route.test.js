/**
 * /api/v1/genesis — the install's once-ever GENESIS, over the real wire.
 *
 * RULE 0: no mocks. A real Express app with the real genesis router and a
 * real temp data root (NEUMA_DATA_ROOT is read per call). What this proves:
 *   · before its genesis the install reads an honest null;
 *   · the first claim MINTS the record — its moment and a hash of it;
 *   · every later claim answers the record that stands and never mints again,
 *     concurrent claims included: one genesis per install, ever.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { createGenesisRouter } from '../../backend/routes/genesis-routes.js';

let app;
let root;
let previous;

beforeAll(async () => {
  root = await createTempDir('genesis-route');
  previous = process.env.NEUMA_DATA_ROOT;
  process.env.NEUMA_DATA_ROOT = root;
  app = express();
  app.use('/api/v1/genesis', createGenesisRouter(express));
});

afterAll(() => {
  if (previous === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = previous;
});

describe('one genesis per install, ever', () => {
  it('reads an honest null before its genesis', async () => {
    const res = await request(app).get('/api/v1/genesis');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ record: null });
  });

  it('the first claim mints its moment and a hash of it', async () => {
    const before = Date.now();
    const res = await request(app).post('/api/v1/genesis');
    expect(res.status).toBe(201);
    expect(res.body.minted).toBe(true);
    const { record } = res.body;
    expect(record.schema).toBe('genesis/v1');
    expect(Date.parse(record.at)).toBeGreaterThanOrEqual(before - 1000);
    expect(record.hash).toMatch(/^[0-9a-f]{64}$/);
    const onDisk = JSON.parse(await fs.readFile(path.join(root, 'settings', 'genesis.json'), 'utf8'));
    expect(onDisk).toEqual(record);
  });

  it('every later claim — concurrent ones too — answers the genesis that stands', async () => {
    const first = (await request(app).get('/api/v1/genesis')).body.record;
    const claims = await Promise.all(Array.from({ length: 5 }, () => request(app).post('/api/v1/genesis')));
    claims.forEach((res) => {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ record: first, minted: false });
    });
  });
});
