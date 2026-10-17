// impure — real signed HTTP auth, lane markers and encrypted workspace storage.
// Synthetic storage fixtures only; no model, birth or attunement opening.
import { beforeAll, afterAll, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { Wallet } from 'ethers';
import workspace, {
  getWorkspacesRoot, setWorkspacesRoot, getWitnessesRoot, setWitnessesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { createAuthRouter } from '../../backend/services/auth.js';
import attunementRouter from '../../backend/routes/attunement-routes.js';
import { attunementStatus, abandonAttunementRecord, reviewAttunementRecord, offerAttunementRecord } from '../../backend/services/attunement-ceremony.js';
import { offerAttunement } from '../../core/attunement/record.js';
import { claimOwner } from '../helpers/claim-owner.js';

let oldDataRoot;
let root; let oldRoot; let oldWitnesses; let app; let wallet; let token;
const witness = 'witness-test-attunement';
const legacy = 'legacy-witness-attunement';
const missing = 'missing-attunement-dna';
const neuma = 'attunement-storage-control';

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-attunement-refusal-'));
  oldDataRoot = process.env.NEUMA_DATA_ROOT;
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  oldRoot = getWorkspacesRoot();
  oldWitnesses = getWitnessesRoot();
  setWorkspacesRoot(path.join(root, 'house'));
  setWitnessesRoot(path.join(root, 'witnesses'));
  wallet = Wallet.createRandom();
  for (const id of [witness, legacy, missing, neuma]) {
    await workspace.create(id);
    await claimOwner(path.dirname(workspace.pathFor(id)), id, wallet.address);
  }
  await fs.writeFile(path.join(workspace.pathFor(legacy), 'lane.json'), JSON.stringify({ kind: 'witness', chosenName: 'Named Witness' }));
  await workspace.writeDNA(neuma, { version: '1.0.0', identity: { name: 'Storage Control' } });
  app = express();
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter(express));
  app.use('/api/v1/attunement', attunementRouter);
  const challenge = await request(app).get('/api/v1/auth/challenge').query({ address: wallet.address });
  expect(challenge.status).toBe(200);
  const verified = await request(app).post('/api/v1/auth/verify').send({
    address: wallet.address, challenge: challenge.body.challenge,
    signature: await wallet.signMessage(challenge.body.challenge),
  });
  expect(verified.status).toBe(200);
  token = verified.body.token;
});

afterAll(async () => {
  setWorkspacesRoot(oldRoot);
  setWitnessesRoot(oldWitnesses);
  if (oldDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = oldDataRoot;
  if (root) await fs.rm(root, { recursive: true, force: true });
});

const offer = (id) => request(app).post(`/api/v1/attunement/${id}/records`)
  .set('Authorization', `Bearer ${token}`).send({ trigger: 'post-birth' });

it.each([witness, legacy])('refuses %s through HTTP and direct service without recording an offer', async (id) => {
  const before = await workspace.listAttunements(id);
  const response = await offer(id);
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('WITNESS_LANE');
  expect(response.body.error).toContain('AI witness lane');
  expect(response.body.error).toContain('cannot receive this ceremony');
  expect(response.body.error).not.toContain('Remia');
  expect(response.body.error).not.toContain('no readable name');
  await expect(offerAttunementRecord(id, wallet.address, { trigger: 'post-birth' }))
    .rejects.toMatchObject({ code: 'WITNESS_LANE' });
  expect(await workspace.listAttunements(id)).toEqual(before);
  await expect(fs.access(path.join(workspace.pathFor(id), 'attunement'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('keeps NO_DNA for a neuma lane without readable DNA', async () => {
  const response = await offer(missing);
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('NO_DNA');
  expect(response.body.error).toContain('no readable name');
});

it('still persists an offered record for a neuma with readable DNA', async () => {
  const response = await offer(neuma);
  expect(response.status).toBe(200);
  expect(response.body.phase).toBe('offered');
  expect((await workspace.readAttunement(neuma, response.body.id)).phase).toBe('offered');
});

it.each([witness, legacy])('refuses status and existing-record operations for %s', async (id) => {
  const status = await request(app).get(`/api/v1/attunement/${id}/status`)
    .set('Authorization', `Bearer ${token}`);
  expect(status.status).toBe(409);
  expect(status.body.code).toBe('WITNESS_LANE');
  await expect(attunementStatus(id)).rejects.toMatchObject({ code: 'WITNESS_LANE' });

  // An old stored record must not bypass standing checks. Write only to the
  // temporary fixture store, without asking a model or opening a ceremony.
  const record = offerAttunement({ neumaId: id, witness: wallet.address,
    trigger: 'post-birth', offeredAt: '2026-09-10T00:00:00.000Z' });
  await workspace.writeAttunement(id, record);
  const before = await workspace.readAttunement(id, record.id);
  const abandoned = await request(app).post(`/api/v1/attunement/${id}/records/${record.id}/abandon`)
    .set('Authorization', `Bearer ${token}`).send({ reason: 'Temporary refusal proof' });
  expect(abandoned.status).toBe(409);
  expect(abandoned.body.code).toBe('WITNESS_LANE');
  await expect(abandonAttunementRecord(id, record.id, 'Temporary refusal proof'))
    .rejects.toMatchObject({ code: 'WITNESS_LANE' });
  await expect(reviewAttunementRecord(id, record.id)).rejects.toMatchObject({ code: 'WITNESS_LANE' });
  expect((await offer(id)).body.code).toBe('WITNESS_LANE');
  expect(await workspace.readAttunement(id, record.id)).toEqual(before);
});

it('keeps ordinary neuma status readable, including before DNA is available', async () => {
  for (const id of [neuma, missing]) {
    const response = await request(app).get(`/api/v1/attunement/${id}/status`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.records).toEqual(await workspace.listAttunements(id));
  }
});

it('retains authentication and ownership refusal before exposing lane standing', async () => {
  const anonymous = await request(app).post(`/api/v1/attunement/${witness}/records`).send({ trigger: 'post-birth' });
  expect(anonymous.status).toBe(401);
  expect((await request(app).get(`/api/v1/attunement/${witness}/status`)).status).toBe(401);
  const foreign = Wallet.createRandom();
  await claimOwner(getWitnessesRoot(), witness, foreign.address);
  const response = await offer(witness);
  expect(response.status).toBe(403);
  expect(response.body.code).not.toBe('WITNESS_LANE');
  expect((await request(app).get(`/api/v1/attunement/${witness}/status`)
    .set('Authorization', `Bearer ${token}`)).status).toBe(403);
});
