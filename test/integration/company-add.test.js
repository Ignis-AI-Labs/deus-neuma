/**
 * ADD A COMPANY (POST /api/v1/companies; marketing/companies.js addCompany) —
 * no mock on the claimed path (RULE 0): a real wallet with a real HMAC token,
 * the real router, the real kit store writing the real file into the house's
 * own ground — a temp folder, recorded as the ground the way the desk records
 * it, never the machine's.
 *
 * Design note, 2026-11-05: […], and make the next ones easy.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const ENV = ['WORKSPACES_ROOT', 'NEUMA_REALM_ROOT', 'NEUMA_WORKSPACE_SETTINGS_PATH'];

describe('a company added from the desk', () => {
  let tempDir; let ground; let app; let witness; let other;
  const saved = {};

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) saved[k] = process.env[k];
    tempDir = await createTempDir(`company-add-${Math.random().toString(36).slice(2)}`);
    process.env.WORKSPACES_ROOT = path.join(tempDir, 'workspaces');
    process.env.NEUMA_REALM_ROOT = path.join(tempDir, 'realm');
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(tempDir, 'workspace.json');
    const { witnessFor, strangerWitness } = await import('../helpers/witness.js');
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'hazel');
    other = strangerWitness();
    // The house's ground, recorded where the desk records it (ground-roots.js).
    ground = path.join(tempDir, 'ground');
    await fs.mkdir(ground, { recursive: true });
    const house = path.join(process.env.NEUMA_REALM_ROOT, witness.address.toLowerCase());
    await fs.mkdir(house, { recursive: true });
    await fs.writeFile(path.join(house, 'house-workspace.json'), JSON.stringify({ root: ground }));
    const { default: router } = await import('../../backend/routes/company-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/companies', router);
  });

  afterEach(async () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('Deus Neuma: named as typed, a kit on the house\'s own ground, listed, and an X account stands under it', async () => {
    const added = await request(app).post('/api/v1/companies').set(witness.header).send({ name: 'Deus Neuma' });
    expect(added.status).toBe(201);
    expect(added.body.company).toMatchObject({ id: 'deus-neuma', name: 'Deus Neuma', parentId: null, where: 'workspace' });
    const kit = JSON.parse(await fs.readFile(path.join(ground, 'brands', 'deus-neuma', 'brand.json'), 'utf8'));
    expect(kit).toMatchObject({ brand: 'deus-neuma', name: 'Deus Neuma' });

    const listed = await request(app).get('/api/v1/companies').set(witness.header);
    expect(listed.body.companies.map((c) => c.id)).toContain('deus-neuma');

    const { addAccount } = await import('../../backend/services/social/account-store.js');
    const account = await addAccount(witness.address, 'x', { companyId: 'deus-neuma', label: 'Deus Neuma on X' }, listed.body.companies.map((c) => c.id));
    expect(account.accountId).toMatch(/^x-\d+$/);
  });

  test('the next one, under a parent; the same name twice and a parent not here are refused in words', async () => {
    await request(app).post('/api/v1/companies').set(witness.header).send({ name: 'Deus Neuma' });
    const sub = await request(app).post('/api/v1/companies').set(witness.header).send({ name: 'Neuma Research', parentId: 'deus-neuma' });
    expect(sub.status).toBe(201);
    expect(sub.body.company).toMatchObject({ id: 'neuma-research', parentId: 'deus-neuma', depth: 1 });

    const again = await request(app).post('/api/v1/companies').set(witness.header).send({ name: 'deus neuma' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('"deus-neuma" is already a company in this house');

    const orphan = await request(app).post('/api/v1/companies').set(witness.header).send({ name: 'Acme', parentId: 'nobody' });
    expect(orphan.status).toBe(400);
    expect(orphan.body.error).toBe('there is no "nobody" company in this house');

    expect((await request(app).post('/api/v1/companies').set(witness.header).send({ name: '  ' })).status).toBe(400);
    expect((await request(app).post('/api/v1/companies').set(witness.header).send({ name: '!!!' })).body.error).toMatch(/makes no short name/);
  });

  test('a house with no ground of its own is told so; no token is a 401', async () => {
    const homeless = await request(app).post('/api/v1/companies').set(other.header).send({ name: 'Deus Neuma' });
    expect(homeless.status).toBe(400);
    expect(homeless.body.error).toMatch(/no house ground is set/);
    expect((await request(app).post('/api/v1/companies').send({ name: 'Deus Neuma' })).status).toBe(401);
  });
});
