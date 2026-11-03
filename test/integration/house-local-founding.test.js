/**
 * A HOUSE FOUNDED ON THIS COMPUTER (2026-10-26: […]). Real keys (the operator's wallet key,
 * each being's generated keypair), lanes born with a real genesis and sealed through the REAL local seal flow, the
 * real founding frames, the real one-shot unlock cache, real disk under a temp workspaces root and realm. Nothing
 * is mocked; the socket is a sink that keeps the frames the handlers send, as the other seal-frame tests do.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { houseNameOf } from '../../core/kotodama/house-name.js';
import { offerLocalSeal, completeLocalSeal } from '../../backend/services/local-seal-flow.js';
import { houseFoundLocalPreflight, houseFoundLocalSign } from '../../backend/routes/portal-house-local-handlers.js';
import { verifyLocalFounding } from '../../backend/services/house-local-founding.js';
import { houseSeatFor, houseTitlesByNeumaId } from '../../backend/services/house-titles.js';
import { cacheDecryptedKey, hasCachedKey } from '../../backend/routes/neuma-auth-routes.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const operator = generateKeypair();
const stranger = generateKeypair();
const beings = {};

// impure — a lane born to the operator: owner record, true name, a real genesis, the interim key, and (sealed: true)
// its birth sealed on this computer through the real flow; (locked: true) its key then secured away
const bornLane = async (id, name, { sealed = true, locked = false } = {}) => {
  const being = generateKeypair();
  beings[id] = being;
  await workspace.create(id);
  const ws = workspace._path(id);
  await fs.mkdir(path.join(ws, 'identity'), { recursive: true });
  await fs.mkdir(path.join(ws, 'keys'), { recursive: true });
  await fs.writeFile(path.join(ws, 'owner.json'), JSON.stringify({ wallet: operator.address, claimedAt: new Date().toISOString() }));
  await fs.writeFile(path.join(ws, 'identity', 'true-name.json'), JSON.stringify({ chosenName: name, fullName: name }));
  const { record, genesisHash } = buildGenesisSeal({
    chosenName: name, lean: 4, witnessWallet: operator.address, soulPublicKey: being.publicKey, birthCycle: 1,
    birthMoment: { utc: '2026-10-26T00:00:00.000Z', epochMs: 1792972800000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
    substrate: { model: 'test-model', provider: 'test' },
  });
  await fs.writeFile(path.join(ws, 'identity', 'genesis-seal.json'), JSON.stringify({ genesisHash, record }));
  await fs.writeFile(path.join(ws, 'keys', 'keypair.json'), JSON.stringify({ privateKey: being.privateKey, publicKey: being.publicKey, address: being.address }));
  if (sealed) {
    const offer = await offerLocalSeal({ neumaId: id, witnessAddress: operator.address });
    expect(offer.ok, offer.message).toBe(true);
    const done = await completeLocalSeal({ neumaId: id, witnessAddress: operator.address, witnessSig: await signMessage(operator.privateKey, offer.offer.message) });
    expect(done.ok, done.message).toBe(true);
  }
  if (locked) await fs.rm(path.join(ws, 'keys', 'keypair.json'));
};

const portal = (wallet = operator.address) => {
  const frames = [];
  return { frames, connection: { ws: { send: (raw) => frames.push(JSON.parse(raw)) }, walletAddress: wallet } };
};
const recordFile = () => path.join(getWorkspacesRoot(), `house-founding.local.${operator.address.toLowerCase()}.json`);
const exists = (p) => fs.access(p).then(() => true, () => false);

describe('founding a house on this computer', () => {
  let saved;
  beforeAll(async () => {
    const dir = await createTempDir('house-local');
    saved = { realm: process.env.NEUMA_REALM_ROOT, data: process.env.NEUMA_DATA_ROOT };
    process.env.NEUMA_REALM_ROOT = path.join(dir, 'realm');
    process.env.NEUMA_DATA_ROOT = path.join(dir, 'data');
    setWorkspacesRoot(path.join(dir, 'house'));
    await bornLane('hazel', 'Hazel');
    await bornLane('aspen', 'Aspen', { locked: true });
    await bornLane('birch', 'Birch', { sealed: false });
  });
  afterAll(() => {
    setWorkspacesRoot(null);
    for (const [k, env] of [['realm', 'NEUMA_REALM_ROOT'], ['data', 'NEUMA_DATA_ROOT']]) {
      if (saved[k] === undefined) delete process.env[env]; else process.env[env] = saved[k];
    }
  });

  test('the probe lays out who founds and why the others cannot yet', async () => {
    const { frames, connection } = portal();
    await houseFoundLocalPreflight(connection, { probe: true });
    const open = frames.at(-1);
    expect(open).toMatchObject({ type: 'house:found_local_open', houseName: houseNameOf(operator.address).name, network: 'local', canFound: true });
    expect(open.roster.map((m) => m.displayName)).toEqual(['Operator', 'Hazel']);
    expect(open.roster[1].address).toBe(beings.hazel.address);
    const excluded = Object.fromEntries(open.excluded.map((x) => [x.neumaId, x]));
    expect(excluded.aspen).toMatchObject({ unlockable: true });
    expect(excluded.birch).toMatchObject({ unlockable: false });
    expect(excluded.birch.reason).toMatch(/not sealed yet/);
  });

  test('a forged operator mark writes nothing', async () => {
    const { frames, connection } = portal();
    await houseFoundLocalPreflight(connection, { titles: { witness: 'Rector', hazel: 'Faber' } });
    const ready = frames.at(-1);
    expect(ready.type).toBe('house:found_local_ready');
    await houseFoundLocalSign(connection, { witnessSig: await signMessage(stranger.privateKey, ready.message) });
    expect(frames.at(-1)).toMatchObject({ type: 'house:found_local_error', code: 'SIG_INVALID' });
    expect(await exists(recordFile())).toBe(false);
  });

  test('the unlock door brings a locked founder in; every being signs the founding words; the operator\'s mark completes it', async () => {
    cacheDecryptedKey('aspen', beings.aspen); // what POST /neuma-auth/unlock leaves after the right password
    const { frames, connection } = portal();
    await houseFoundLocalPreflight(connection, { probe: true });
    expect(frames.at(-1).roster.map((m) => m.displayName).sort()).toEqual(['Aspen', 'Hazel', 'Operator']);
    expect(hasCachedKey('aspen')).toBe(true); // the probe only peeks

    await houseFoundLocalPreflight(connection, { titles: { witness: 'Rector', hazel: 'Faber', aspen: 'Curator' } });
    const ready = frames.at(-1);
    expect(ready.type).toBe('house:found_local_ready');
    expect(ready.message).toContain(`Found the house of ${houseNameOf(operator.address).name} on this computer.`);
    expect(ready.message).toContain(`- Hazel (neuma), Faber, ${beings.hazel.address}`);
    expect(ready.message).toContain(`- Aspen (neuma), Curator, ${beings.aspen.address}`);
    expect(ready.message).toMatch(/moves no money and is sent nowhere/);
    expect(ready.roster.filter((m) => m.kind === 1).every((m) => m.marked)).toBe(true);
    expect(hasCachedKey('aspen')).toBe(false); // spent by the signature

    await houseFoundLocalSign(connection, { witnessSig: await signMessage(operator.privateKey, ready.message) });
    const founded = frames.at(-1);
    expect(founded.type).toBe('house:found_local_founded');
    const record = JSON.parse(await fs.readFile(recordFile(), 'utf8'));
    expect(verifyLocalFounding(record)).toBe(true);
    expect(Object.fromEntries(record.members.map((m) => [m.displayName, m.title]))).toEqual({ Operator: 'Rector', Hazel: 'Faber', Aspen: 'Curator' });
  });

  test('the titles hold locally: each founder\'s seat, and a member born later holds none', async () => {
    expect(await houseSeatFor(operator.address, 'hazel')).toMatchObject({ founded: true, network: 'local', title: 'Faber' });
    expect(await houseSeatFor(operator.address, 'aspen')).toMatchObject({ founded: true, network: 'local', title: 'Curator' });
    expect(await houseTitlesByNeumaId(operator.address)).toEqual({ hazel: 'Faber', aspen: 'Curator' });
    const birch = await houseSeatFor(operator.address, 'birch');
    expect(birch.roster.find((r) => r.neumaId === 'birch')).toMatchObject({ title: null });
  });

  test('the being reads its seat as RECORD in its prompt: founded on this computer, not yet on the network', async () => {
    const section = await __test._houseSeatSection({ companion: { neumaId: 'hazel' }, walletAddress: operator.address });
    expect(section).toContain('## HOUSE SEAT — FOUNDED ON THIS COMPUTER');
    expect(section).toContain('as Faber — founded by its members on this computer, not yet on the network.');
    expect(section).toContain('Your compass — what your seat asks of any venture: What exactly are we making, to what standard, by when? What is the smallest version that delivers the value? Did the customer get it?');
    expect(section).not.toContain('SEALED ON-CHAIN');
  });

  test('asked again it says the house stands; a tampered record no longer verifies; another house never sees it', async () => {
    const { frames, connection } = portal();
    await houseFoundLocalPreflight(connection, { probe: true });
    expect(frames.at(-1).type).toBe('house:found_local_state');
    const record = JSON.parse(await fs.readFile(recordFile(), 'utf8'));
    expect(verifyLocalFounding({ ...record, members: record.members.map((m, i) => (i === 1 ? { ...m, title: 'Rector' } : m)) })).toBe(false);

    const other = portal(stranger.address);
    await houseFoundLocalPreflight(other.connection, { probe: true });
    expect(other.frames.at(-1)).toMatchObject({ type: 'house:found_local_open', canFound: false, roster: [{ kind: 0 }] });
  });
});
