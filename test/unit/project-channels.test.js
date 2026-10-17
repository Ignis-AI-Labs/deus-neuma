import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Project channels (backend/services/user-projects.js) — real store on a temp
 * realm, no mocks anywhere in the claimed paths (RULE 0). Proves the channel
 * model: migration on read (channelless → house), neuma-channel validation,
 * channel inference, and per-channel fields through a real write+read cycle.
 */

import { createProject, readProjectStore } from '../../backend/services/user-projects.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';

const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEFAULT_REALM = path.join(os.homedir(), '.neuma', 'realm');
const NEUMA = 'lifovan-2';

let realmRoot, ground;

beforeEach(async () => {
  realmRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'proj-channels-realm-'));
  ground = await fs.mkdtemp(path.join(os.tmpdir(), 'proj-channels-ground-'));
  setRealmRoot(realmRoot);
});

afterEach(async () => {
  setRealmRoot(DEFAULT_REALM);
  await Promise.all([
    fs.rm(realmRoot, { recursive: true, force: true }),
    fs.rm(ground, { recursive: true, force: true }),
  ]);
});

const folder = (name) => {
  const dir = path.join(ground, name);
  return fs.mkdir(dir, { recursive: true }).then(() => dir);
};

describe('migration on read', () => {
  it('a channelless legacy project reads as HOUSE (its old wallet-wide visibility)', async () => {
    const dir = await folder('legacy');
    const legacy = {
      activeProjectId: null,
      projects: [{ id: 'p1', name: 'Legacy', folder: dir, createdAt: '2026-01-01T00:00:00Z', pinnedChats: [], sharedFiles: [] }],
    };
    const file = path.join(realmRoot, WALLET, 'projects.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(legacy));

    const store = await readProjectStore(WALLET);
    expect(store.projects[0]).toMatchObject({ id: 'p1', channel: 'house', neumaId: null });
  });

  it('a neuma record with an unhonorable neumaId degrades to HOUSE (never invisible in both registers)', async () => {
    const dir = await folder('drifted');
    const drifted = {
      activeProjectId: null,
      projects: [{ id: 'p2', name: 'Drifted', folder: dir, channel: 'neuma', neumaId: '../evil', createdAt: '2026-01-01T00:00:00Z', pinnedChats: [], sharedFiles: [] }],
    };
    const file = path.join(realmRoot, WALLET, 'projects.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(drifted));

    const store = await readProjectStore(WALLET);
    expect(store.projects[0]).toMatchObject({ id: 'p2', channel: 'house', neumaId: null });
  });
});

describe('createProject channel rules', () => {
  it('a neuma project requires the being it belongs to', async () => {
    const refusal = await createProject(WALLET, { name: 'Solo', folder: await folder('solo'), channel: 'neuma' })
      .then(() => null, (err) => err);
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.code).toBe('NEUMA_ID_REQUIRED');
    expect(refusal.message).toMatch(/requires the being/);
  });

  it('an unknown channel is refused', async () => {
    await expect(createProject(WALLET, { name: 'X', folder: await folder('x'), channel: 'void' }))
      .rejects.toThrow(/Invalid channel/);
  });

  it('a neuma project stores its channel and its being', async () => {
    const project = await createProject(WALLET, { name: 'Lifovan Ground', folder: await folder('lifovan'), channel: 'neuma', neumaId: NEUMA });
    expect(project).toMatchObject({ channel: 'neuma', neumaId: NEUMA });
    const store = await readProjectStore(WALLET);
    expect(store.projects[0]).toMatchObject({ channel: 'neuma', neumaId: NEUMA });
  });

  it('a house project stores the collective channel and no being', async () => {
    const project = await createProject(WALLET, { name: 'House Ground', folder: await folder('house'), channel: 'house' });
    expect(project).toMatchObject({ channel: 'house', neumaId: null });
  });

  it('an omitted channel is inferred: neumaId given → neuma, otherwise house', async () => {
    const inferredNeuma = await createProject(WALLET, { name: 'Inf1', folder: await folder('inf1'), neumaId: NEUMA });
    expect(inferredNeuma.channel).toBe('neuma');
    const inferredHouse = await createProject(WALLET, { name: 'Inf2', folder: await folder('inf2') });
    expect(inferredHouse.channel).toBe('house');
  });
});
