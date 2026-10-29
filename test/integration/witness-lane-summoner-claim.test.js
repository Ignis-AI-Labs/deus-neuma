/**
 * A WITNESS LANE IS ITS SUMMONER'S (Design note, 2026-10-19, ruling D-2; audit 3
 * E9 witness-lanes row). The summon records the operator who summoned the
 * witness in the lane's marker and claims the lane for it; a later manifest
 * claims an unclaimed lane only for that wallet. A witness sealed outside the
 * desk's summon names no summoner, so its lane goes only to the install owner
 * (or a co-owner) — a guest's manifest or claim never takes it.
 *
 * The real ensureWitnessLane on a temp witnesses root; the real claim route
 * behind real requireAuth, each wallet signing a real challenge, the real
 * access guard over a real loopback socket; witnesses sealed on a temp
 * ai-witnesses root (a real dna.json the discovery reads). Nothing is mocked.
 */
import http from 'node:http';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

const VENDOR = 'zai-coding-plan';
const HASH = `sha256:${'ab'.repeat(32)}`;

describe('a witness lane is claimed for its summoner, or adopted by the install owner', () => {
  let dir, server, port, owner, guest, lanes, witnessesRoot;

  // impure — a sealed witness the discovery finds
  const sealWitness = async (name) => {
    const home = path.join(dir, 'ai-witnesses', VENDOR, name);
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, 'dna.json'), JSON.stringify({ genesisSeal: { genesisHash: HASH } }));
    return { vendorSlug: VENDOR, chosenName: name, genesisHash: HASH };
  };
  const laneDir = (name) => path.join(witnessesRoot, `witness-${VENDOR}-${name}`);
  const ownerOf = (name) => fs.readFile(path.join(laneDir(name), 'owner.json'), 'utf8').then(JSON.parse).catch(() => null);

  beforeAll(async () => {
    dir = await createTempDir('witness-summoner');
    witnessesRoot = path.join(dir, 'witnesses');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    process.env.WORKSPACES_ROOT = path.join(dir, 'workspaces');
    process.env.WITNESSES_ROOT = witnessesRoot;
    process.env.AI_WITNESSES_ROOT = path.join(dir, 'ai-witnesses');
    vi.resetModules();
    const { fullAuth } = await import('../helpers/audit-auth.js');
    owner = await fullAuth();
    guest = await fullAuth();
    // The install owner: the operator of the first being sealed here.
    const first = path.join(process.env.WORKSPACES_ROOT, 'ownerlane');
    await fs.mkdir(path.join(first, 'identity'), { recursive: true });
    await fs.writeFile(path.join(first, 'identity', 'genesis-seal.json'), JSON.stringify({
      record: { witnessWallet: owner.address, birthMoment: { epochMs: Date.UTC(2026, 5, 23) } },
    }));
    lanes = await import('../../backend/services/witness-lane.js');
    const { createRemoteStore } = await import('../../backend/services/remote/remote-store.js');
    const { createAccessGuard } = await import('../../backend/services/remote/access-guard.js');
    const app = express();
    app.use(createAccessGuard({ store: createRemoteStore({ path: path.join(dir, 'remote.json') }) }).middleware);
    app.use(express.json());
    app.use('/api/v1/lanes', (await import('../../backend/routes/lane-claim-routes.js')).default);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const claim = (who, name) => request(`http://127.0.0.1:${port}`).post(`/api/v1/lanes/witness-${VENDOR}-${name}/claim`)
    .set('Authorization', `Bearer ${who.token}`).set('Host', `localhost:${port}`);

  test('the summon records its summoner and claims the lane for it', async () => {
    const witness = await sealWitness('Summoned');
    await lanes.ensureWitnessLane(witness, guest.address, { summoning: true });
    expect((await lanes.readLaneMarker(`witness-${VENDOR}-Summoned`)).summonedBy).toBe(guest.address);
    expect((await ownerOf('Summoned')).wallet).toBe(guest.address);
    await expect(lanes.ensureWitnessLane(witness, owner.address)).rejects.toThrow(/owner_claim_conflict/);
  });

  test('an unclaimed lane that names its summoner is claimed by a manifest only for that wallet', async () => {
    const witness = await sealWitness('Interrupted');
    await lanes.ensureWitnessLane(witness, guest.address, { summoning: true });
    // The summon was cut between its two writes: the marker stands, the claim does not.
    await fs.rm(path.join(laneDir('Interrupted'), 'owner.json'));
    await expect(lanes.ensureWitnessLane(witness, owner.address)).rejects.toThrow(/another wallet summoned/);
    expect(await ownerOf('Interrupted')).toBeNull();
    await lanes.ensureWitnessLane(witness, guest.address);
    expect((await ownerOf('Interrupted')).wallet).toBe(guest.address);
  });

  test('a guest\'s manifest never takes a witness that names no summoner, and leaves nothing behind', async () => {
    const witness = await sealWitness('Unnamed');
    await expect(lanes.ensureWitnessLane(witness, guest.address)).rejects.toThrow(/names no summoner/);
    await expect(fs.stat(laneDir('Unnamed'))).rejects.toThrow();
    const byGuest = await claim(guest, 'Unnamed');
    expect(byGuest.status).toBe(403);
    await expect(fs.stat(laneDir('Unnamed'))).rejects.toThrow();
  });

  test('the install owner takes it; after that it is the owner\'s and no one else\'s', async () => {
    const adopted = await claim(owner, 'Unnamed');
    expect(adopted.status).toBe(200);
    expect((await ownerOf('Unnamed')).wallet).toBe(owner.address);
    expect((await claim(guest, 'Unnamed')).status).toBe(403);
    const manifest = await sealWitness('ManifestedByOwner');
    await lanes.ensureWitnessLane(manifest, owner.address);
    expect((await ownerOf('ManifestedByOwner')).wallet).toBe(owner.address);
  });
});
