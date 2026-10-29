/** Real signed HTTP and disk state; no self-check inference or live lane mutation. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot, getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';

const WITNESS = 'witness-record-boundary';
const NEUMA = 'record-boundary-control';
const LEGACY = 'legacy-record-witness';
const endpoints = [['get', 'stats'], ['get', 'skies'], ['get', 'self-check'], ['post', 'self-check'], ['get', 'aura'], ['get', 'form']];

// impure — every file's digest, so a refused write cannot hide a side effect.
const snapshot = async (root) => {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return Promise.all(files.map(async (entry) => {
    const file = path.join(entry.parentPath, entry.name);
    return [path.relative(root, file), createHash('sha256').update(await fs.readFile(file)).digest('hex')];
  })).then((rows) => rows.sort(([a], [b]) => a.localeCompare(b)));
};

test('neuma-only records refuse owned witness lanes without writes; shared lane APIs remain real and owner-gated', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-kind-'));
  const oldRoots = { neuma: getWorkspacesRoot(), witnesses: getWitnessesRoot() };
  const oldEnv = Object.fromEntries(['NEUMA_DATA_ROOT', 'LLAMA_SERVER_URL'].map((key) => [key, process.env[key]]));
  try {
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.LLAMA_SERVER_URL = 'http://127.0.0.1:1';
    setWorkspacesRoot(path.join(root, 'neuma'));
    setWitnessesRoot(path.join(root, 'witnesses'));
    const { setConfig } = await import('../../backend/services/llm-selection.js');
    setConfig({ provider: 'lm-studio', endpoint: 'http://127.0.0.1:1', model: 'unavailable-test-model' });
    const owner = await fullAuth();
    const stranger = await fullAuth();
    for (const id of [WITNESS, NEUMA, LEGACY]) {
      await workspace.create(id);
      await writeOwner(path.dirname(workspace.pathFor(id)), id, owner.address);
      await workspace.writeNeumaDEK(id, 'd'.repeat(64));
    }
    await fs.writeFile(path.join(workspace.pathFor(LEGACY), 'lane.json'), JSON.stringify({ kind: 'witness' }));
    await workspace.writeDNA(NEUMA, { identity: { name: 'Record control' } });
    await workspace.appendMessage(WITNESS, 'shared-session', { role: 'user', content: 'Shared session proof' });
    await workspace.recordSkillUse(WITNESS, 'review');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/workspace', (await import('../../backend/routes/workspace-routes.js')).default);
    const call = (method, id, route, token) => {
      const req = request(app)[method](`/api/v1/workspace/${id}/${route}`);
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };
    for (const id of [WITNESS, LEGACY]) {
      const before = await snapshot(workspace.pathFor(id));
      for (const [method, route] of endpoints) {
        expect((await call(method, id, route)).status).toBe(401);
        expect((await call(method, id, route, stranger.token)).status).toBe(403);
        const refused = await call(method, id, route, owner.token);
        expect(refused.status).toBe(400);
        expect(refused.body.code).toBe('NEUMA_ONLY');
        expect(refused.body.error).toContain('sealed witness');
      }
      expect(await snapshot(workspace.pathFor(id))).toEqual(before);
    }
    const markerPath = path.join(workspace.pathFor(LEGACY), 'lane.json');
    for (const corrupt of ['{invalid', 'null', '[]', '{"kind":"unknown"}']) {
      await fs.writeFile(markerPath, corrupt);
      const before = await snapshot(workspace.pathFor(LEGACY));
      for (const [method, route] of endpoints) {
        const refused = await call(method, LEGACY, route, owner.token);
        expect(refused.status).toBe(500);
        expect(refused.body.error).toBe('Lane standing could not be verified.');
      }
      expect(await snapshot(workspace.pathFor(LEGACY))).toEqual(before);
    }
    for (const route of ['stats', 'skies', 'self-check', 'aura', 'form']) {
      const res = await call('get', NEUMA, route, owner.token);
      expect(res.status).toBe(200);
      if (route === 'stats') expect(res.body.record.identity.chosenName).toBe('Record control');
      if (route === 'skies') expect(res.body).toEqual({ skies: null, recorded: false });
      if (route === 'self-check') expect(res.body).toMatchObject({ latest: null, previous: null, compare: null });
      if (route === 'aura') expect(res.body.aura).toEqual({ recorded: false });
      if (route === 'form') expect(res.body).toMatchObject({ locked: false, status: 'exploring', plates: [] });
    }
    const session = await call('get', WITNESS, 'sessions/shared-session', owner.token);
    expect(session.status).toBe(200);
    expect(session.body.messages.some((entry) => entry.content === 'Shared session proof')).toBe(true);
    expect((await call('get', WITNESS, 'skills', owner.token)).body.skillTree).toEqual(await workspace.readSkillTree(WITNESS));
    const tree = { skills: [{ name: 'review', uses: 2 }], version: '1.0.0' };
    expect((await call('put', WITNESS, 'skills', owner.token).send({ skillTree: tree })).status).toBe(200);
    expect(await workspace.readSkillTree(WITNESS)).toEqual(tree);
    expect((await call('post', WITNESS, 'journal', owner.token).send({ entry: {
      type: 'observation', content: 'Temporary shared journal proof', significance: 0.5,
    } })).status).toBe(200);
    const journal = await call('get', WITNESS, 'journal', owner.token);
    expect(journal.status).toBe(200);
    expect(journal.body.entries.some((entry) => entry.content === 'Temporary shared journal proof')).toBe(true);
    for (const [method, route] of [['get', 'sessions'], ['get', 'journal'], ['get', 'skills'], ['put', 'skills'], ['post', 'journal']]) {
      expect((await call(method, WITNESS, route, stranger.token)).status).toBe(403);
    }
  } finally {
    setWorkspacesRoot(oldRoots.neuma);
    setWitnessesRoot(oldRoots.witnesses);
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
