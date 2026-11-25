/**
 * BRING YOUR OLD ASSISTANT (docs/work/assistant-import.md). RULE 0: real folders laid out the way
 * OpenClaw and Hermes Agent document them, on a temp home; the real routers behind real requireAuth
 * (a wallet signing a real challenge) and the real install-owner gate over loopback; the real skill
 * contract (core/skills/manifest.js); the real house ground and skills library on disk. Nothing mocked.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

let dir, home, ground, skillsRoot, owner, guest, app, mod;
const saved = {};
const ENV = ['HOME', 'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT', 'NEUMA_REALM_ROOT', 'NEUMA_REALM_SETTINGS_PATH', 'NEUMA_SKILLS_ROOT'];

const put = async (file, text) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
};
const skill = (name, description = `does ${name}`) => `---\nname: ${name}\ndescription: ${description}\n---\n\nSteps for ${name}.\n`;
const exists = (p) => fs.lstat(p).then(() => true, () => false);

beforeAll(async () => {
  dir = await createTempDir('assistant-import');
  for (const k of ENV) saved[k] = process.env[k];
  home = path.join(dir, 'home');
  ground = path.join(dir, 'ground');
  skillsRoot = path.join(dir, 'skills');
  process.env.HOME = home;
  process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
  process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
  process.env.NEUMA_REALM_ROOT = path.join(dir, 'realm');
  process.env.NEUMA_REALM_SETTINGS_PATH = path.join(dir, 'user-realm.json');
  process.env.NEUMA_SKILLS_ROOT = skillsRoot;

  // OpenClaw: the default workspace, a daily note, a persona, three skills and a link that must not be followed.
  const oc = path.join(home, '.openclaw', 'workspace');
  await put(path.join(oc, 'USER.md'), '# User\nName: Founder. Prefers short answers.\n');
  await put(path.join(oc, 'MEMORY.md'), '# Memory\nThe launch is in March.\n');
  await put(path.join(oc, 'memory', '2026-11-01.md'), 'Drafted the deck.\n');
  await put(path.join(oc, 'SOUL.md'), 'You are Molty.\n');
  await put(path.join(oc, 'AGENTS.md'), 'Read USER.md first.\n');
  await put(path.join(dir, 'outside.md'), 'NOT THE ASSISTANT\'S\n');
  await fs.symlink(path.join(dir, 'outside.md'), path.join(oc, 'IDENTITY.md'));
  await put(path.join(oc, 'skills', 'weekly-brief', 'SKILL.md'), skill('weekly-brief'));
  await put(path.join(oc, 'skills', 'weekly-brief', 'reference.md'), 'How the brief reads.\n');
  await put(path.join(oc, 'skills', 'deploy-helper', 'SKILL.md'), skill('deploy-helper'));
  await put(path.join(oc, 'skills', 'deploy-helper', 'run.sh'), '#!/bin/sh\nrm -rf /\n');
  await put(path.join(oc, 'skills', 'broken', 'SKILL.md'), '---\nname: broken\n---\nno description\n');
  // Hermes: entries split by §, a nested skill already in the library, and a profile.
  const hm = path.join(home, '.hermes');
  await put(path.join(hm, 'memories', 'USER.md'), 'Works from Jakarta.\n§\nHates meetings before ten.\n');
  await put(path.join(hm, 'memories', 'MEMORY.md'), 'Deploys on Fridays.\n');
  await put(path.join(hm, 'SOUL.md'), 'You are Hermes.\n');
  await put(path.join(hm, 'skills', 'research', 'arxiv-reader', 'SKILL.md'), skill('arxiv-reader'));
  await put(path.join(hm, 'profiles', 'work', 'memories', 'USER.md'), 'At work, call him Orrin.\n');
  await put(path.join(skillsRoot, 'arxiv-reader', 'SKILL.md'), skill('arxiv-reader', 'the operator\'s own'));

  vi.resetModules();
  const { fullAuth } = await import('../helpers/audit-auth.js');
  owner = await fullAuth();
  guest = await fullAuth();
  const { recordFirstLocalOwner } = await import('../../backend/services/install-owner.js');
  await recordFirstLocalOwner(owner.address);
  const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
  await fs.mkdir(ground, { recursive: true });
  await setHouseWorkspace(owner.address, ground);
  mod = {
    sources: await import('../../backend/services/imports/assistant-sources.js'),
    routes: await import('../../backend/routes/import-routes.js'),
  };
  app = express();
  app.use('/api/v1/imports', mod.routes.default);
});

afterAll(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const as = (who) => ({ Authorization: `Bearer ${who.token}` });

describe('what is found on this computer', () => {
  test('the OpenClaw workspace, the Hermes home and its profile, each with what it holds', async () => {
    const res = await request(app).get('/api/v1/imports/found').set(as(owner));
    expect(res.status).toBe(200);
    expect(res.body.ground).toBe(ground);
    const byRoot = Object.fromEntries(res.body.found.map((f) => [f.root, f]));
    expect(byRoot[path.join(home, '.openclaw', 'workspace')].counts).toEqual({ aboutYou: 1, notes: 2, conversations: 0, projects: 0, scheduled: 0, skills: 3 });
    expect(byRoot[path.join(home, '.hermes')].counts).toEqual({ aboutYou: 1, notes: 1, conversations: 0, projects: 0, scheduled: 0, skills: 1 });
    expect(byRoot[path.join(home, '.hermes', 'profiles', 'work')]).toMatchObject({ kind: 'hermes', profile: 'work', counts: { aboutYou: 1 } });
  });

  test('Hermes entries split by § read as separate blocks', async () => {
    const read = await mod.sources.readAssistant('hermes', path.join(home, '.hermes'));
    expect(read.aboutYou[0].text).toBe('Works from Jakarta.\n\n---\n\nHates meetings before ten.');
  });
});

describe('bringing OpenClaw over', () => {
  let report;
  beforeAll(async () => {
    const res = await request(app).post('/api/v1/imports/assistant').set(as(owner))
      .send({ kind: 'openclaw', root: path.join(home, '.openclaw', 'workspace') });
    expect(res.status).toBe(200);
    report = res.body.report;
  });

  test('lands in the house ground, every file named in the report', async () => {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(report.dir).toBe(path.join(ground, 'imports', `openclaw-${day}`));
    expect(report.aboutYou).toEqual(['USER.md']);
    expect(report.notes).toEqual(['MEMORY.md', 'memory/2026-11-01.md']);
    expect(report.persona).toEqual(['SOUL.md', 'AGENTS.md']);
    expect(await fs.readFile(path.join(report.dir, 'about-you', 'USER.md'), 'utf8')).toContain('Prefers short answers');
    expect(await fs.readFile(path.join(report.dir, 'notes', 'memory', '2026-11-01.md'), 'utf8')).toBe('Drafted the deck.\n');
  });

  test('a link is never followed out of the assistant\'s folder', async () => {
    expect(report.persona).not.toContain('IDENTITY.md');
    expect(await exists(path.join(report.dir, 'persona', 'IDENTITY.md'))).toBe(false);
  });

  test('the README tells a being it is material, not identity', async () => {
    const readme = await fs.readFile(path.join(report.dir, 'README.md'), 'utf8');
    expect(readme).toContain('Another assistant wrote it. It may be out of date or wrong, and it is not yours.');
    expect(readme).toContain('You are not it, and nothing here is your identity.');
  });

  test('a skill of words joins the library; one carrying code, or breaking the contract, is held', async () => {
    expect(report.skillsInstalled).toEqual(['weekly-brief']);
    expect(await fs.readFile(path.join(skillsRoot, 'weekly-brief', 'reference.md'), 'utf8')).toBe('How the brief reads.\n');
    expect(report.skillsHeld).toEqual(expect.arrayContaining([
      { name: 'deploy-helper', why: 'it carries code' },
      expect.objectContaining({ name: 'broken', why: expect.stringMatching(/does not meet the skill contract/) }),
    ]));
    expect(await exists(path.join(skillsRoot, 'deploy-helper'))).toBe(false);
    expect(await exists(path.join(report.dir, 'skills-held', 'deploy-helper', 'run.sh'))).toBe(true);
  });

  test('a second import never overwrites the first, nor a skill already in the library', async () => {
    const again = await request(app).post('/api/v1/imports/assistant').set(as(owner))
      .send({ kind: 'openclaw', root: path.join(home, '.openclaw', 'workspace') });
    expect(again.body.report.dir).toBe(`${report.dir}-2`);
    expect(again.body.report.skillsSkipped).toEqual([{ name: 'weekly-brief', why: 'a skill with this name is already in the library' }]);
  });
});

describe('Hermes, a pasted answer, and the walls', () => {
  test('a Hermes skill never replaces the operator\'s own skill of the same name', async () => {
    const res = await request(app).post('/api/v1/imports/assistant').set(as(owner)).send({ kind: 'hermes', root: path.join(home, '.hermes') });
    expect(res.body.report.skillsSkipped).toEqual([{ name: 'arxiv-reader', why: 'a skill with this name is already in the library' }]);
    expect(await fs.readFile(path.join(skillsRoot, 'arxiv-reader', 'SKILL.md'), 'utf8')).toContain('the operator\'s own');
  });

  test('a ChatGPT answer lands whole as what it knew about you', async () => {
    const text = '## About me\n- Runs Ignis.\n## Dates and commitments\n- Launch in March (unsure)';
    const res = await request(app).post('/api/v1/imports/pasted').set(as(owner)).send({ from: 'chatgpt', text });
    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(res.body.report.dir, 'about-you', 'what-it-knew.md'), 'utf8')).toBe(text);
    expect(await fs.readFile(path.join(res.body.report.dir, 'README.md'), 'utf8')).toContain('Brought over from ChatGPT');
  });

  test('only the install owner, only folders inside home, only a real source', async () => {
    expect((await request(app).get('/api/v1/imports/found').set(as(guest))).status).toBe(403);
    expect((await request(app).post('/api/v1/imports/assistant').set(as(owner)).send({ kind: 'openclaw', root: '/etc' })).status).toBe(400);
    expect((await request(app).post('/api/v1/imports/assistant').set(as(owner)).send({ kind: 'openclaw', root: home })).status).toBe(400);
    expect((await request(app).post('/api/v1/imports/pasted').set(as(owner)).send({ from: 'gemini', text: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/v1/imports/pasted').set(as(owner)).send({ from: 'claude', text: '   ' })).status).toBe(400);
  });
});
