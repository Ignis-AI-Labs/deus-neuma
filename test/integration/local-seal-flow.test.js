/**
 * A BIRTH SEALED ON THIS COMPUTER (2026-10-26: a person who wants nothing to do with crypto still secures
 * everything). Real keys — the being's generated keypair, the operator's wallet key — a real genesis record
 * (buildGenesisSeal), real lane files on a temp workspace root, the real custody handler, the real local-seal
 * frames and the real one-shot unlock cache. Nothing is mocked; the socket is a sink that keeps the frames
 * the handlers send, as the other seal-frame tests do.
 */
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { buildGenesisSeal } from '../../core/identity/genesis-seal.js';
import { verifyLocalSeal } from '../../core/identity/local-seal.js';
import { detectBirthSetupState } from '../../core/birth/birth-setup-state.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { birthEncryptKeypair } from '../../backend/routes/portal-seal-handlers.js';
import { birthLocalSealOffer, birthLocalSealSign } from '../../backend/routes/portal-local-seal-handlers.js';
import { cacheDecryptedKey, hasCachedKey, getCachedKey } from '../../backend/routes/neuma-auth-routes.js';

const operator = generateKeypair();
const stranger = generateKeypair();
const PASSWORD = 'a-long-test-password-26';

// impure — a born lane: a real genesis on disk and the interim key the birth leaves before custody
const bornLane = async (id, name) => {
  const being = generateKeypair();
  await workspace.create(id);
  const ws = workspace._path(id);
  const { record, genesisHash } = buildGenesisSeal({
    chosenName: name, lean: 5, witnessWallet: operator.address, soulPublicKey: being.publicKey, birthCycle: 1,
    birthMoment: { utc: '2026-10-26T00:00:00.000Z', epochMs: 1792972800000, zone: 'Asia/Jakarta', offsetMinutes: 420 },
    substrate: { model: 'test-model', provider: 'test' },
  });
  await fs.mkdir(path.join(ws, 'identity'), { recursive: true });
  await fs.mkdir(path.join(ws, 'keys'), { recursive: true });
  await fs.writeFile(path.join(ws, 'identity', 'genesis-seal.json'), JSON.stringify({ genesisHash, record }));
  await fs.writeFile(path.join(ws, 'keys', 'keypair.json'), JSON.stringify({ privateKey: being.privateKey, publicKey: being.publicKey, address: being.address }));
  return { being, genesis: { genesisHash, record } };
};

const portal = (neumaId, wallet = operator.address) => {
  const frames = [];
  return { frames, connection: { ws: { send: (raw) => frames.push(JSON.parse(raw)) }, walletAddress: wallet, companion: { neumaId } } };
};
const readSeal = async (id) => JSON.parse(await fs.readFile(path.join(workspace._path(id), 'identity', 'local-seal.json'), 'utf8'));
const exists = (p) => fs.access(p).then(() => true, () => false);

describe('sealing a birth on this computer', () => {
  beforeAll(async () => setWorkspacesRoot(path.join(await createTempDir('local-seal'), 'house')));
  afterAll(() => setWorkspacesRoot(null));

  test('custody signs the being\'s half while its key is in hand; the operator\'s signature makes the seal whole and the birth complete', async () => {
    const { genesis } = await bornLane('rowan', 'Rowan');
    const { frames, connection } = portal('rowan');

    await birthEncryptKeypair(connection, { neumaId: 'rowan', password: PASSWORD });
    expect(frames.at(-1).type).toBe('birth:keypair_secured');
    expect(await exists(path.join(workspace._path('rowan'), 'keys', 'keypair.json'))).toBe(false);
    expect(verifyLocalSeal(await readSeal('rowan'), genesis)).toEqual({ soul: true, witness: false, complete: false });
    expect((await detectBirthSetupState(workspace, 'rowan')).missing).toEqual(['seal']);

    await birthLocalSealOffer(connection, { neumaId: 'rowan' });
    const ready = frames.at(-1);
    expect(ready).toMatchObject({ type: 'birth:local_seal_ready', neumaId: 'rowan', genesisHash: genesis.genesisHash });
    expect(ready.message).toContain('Seal the birth of Rowan on this computer.');
    // the offer never spends the one-shot key the Ethereum seal may still need this session
    expect(hasCachedKey('rowan')).toBe(true);

    await birthLocalSealSign(connection, { neumaId: 'rowan', witnessSig: await signMessage(operator.privateKey, ready.message) });
    expect(frames.at(-1)).toMatchObject({ type: 'birth:local_sealed', neumaId: 'rowan', genesisHash: genesis.genesisHash });
    expect(verifyLocalSeal(await readSeal('rowan'), genesis).complete).toBe(true);
    const state = await detectBirthSetupState(workspace, 'rowan');
    expect(state).toMatchObject({ keypairCustody: true, localSealed: true, onchainSealed: false, complete: true });

    // asked again, it says the seal stands
    await birthLocalSealOffer(connection, { neumaId: 'rowan' });
    expect(frames.at(-1)).toEqual({ type: 'birth:local_sealed', neumaId: 'rowan' });
    getCachedKey('rowan'); // spend the custody cache so it cannot leak into another test
  });

  test('only the wallet that witnessed the birth may co-sign, and a forged mark writes nothing', async () => {
    await bornLane('aspen', 'Aspen');
    const other = portal('aspen', stranger.address);
    await birthLocalSealOffer(other.connection, { neumaId: 'aspen' });
    expect(other.frames.at(-1)).toMatchObject({ type: 'birth:local_seal_error', code: 'NOT_WITNESS' });

    const mine = portal('aspen');
    await birthLocalSealOffer(mine.connection, { neumaId: 'aspen' }); // the interim key signs the being's half
    const { message } = mine.frames.at(-1);
    await birthLocalSealSign(mine.connection, { neumaId: 'aspen', witnessSig: await signMessage(stranger.privateKey, message) });
    expect(mine.frames.at(-1)).toMatchObject({ type: 'birth:local_seal_error', code: 'BAD_SIGNATURE' });
    expect((await readSeal('aspen')).witness).toBeNull();

    await birthLocalSealSign(other.connection, { neumaId: 'aspen', witnessSig: await signMessage(stranger.privateKey, message) });
    expect(other.frames.at(-1)).toMatchObject({ type: 'birth:local_seal_error', code: 'NOT_WITNESS' });
    expect((await detectBirthSetupState(workspace, 'aspen')).localSealed).toBe(false);
  });

  test('a being secured in an earlier session: KEY_LOCKED until the unlock door opens, then the one-shot key signs once', async () => {
    const { being, genesis } = await bornLane('linden', 'Linden');
    await fs.rm(path.join(workspace._path('linden'), 'keys', 'keypair.json')); // custody done long ago, no key in hand
    const { frames, connection } = portal('linden');

    await birthLocalSealOffer(connection, { neumaId: 'linden' });
    expect(frames.at(-1)).toMatchObject({ type: 'birth:local_seal_error', code: 'KEY_LOCKED' });

    cacheDecryptedKey('linden', being); // what POST /neuma-auth/unlock leaves after the right password
    await birthLocalSealOffer(connection, { neumaId: 'linden' });
    const ready = frames.at(-1);
    expect(ready.type).toBe('birth:local_seal_ready');
    expect(hasCachedKey('linden')).toBe(false); // spent: one signature, one unlock (SEC-028)

    await birthLocalSealSign(connection, { neumaId: 'linden', witnessSig: await signMessage(operator.privateKey, ready.message) });
    expect(frames.at(-1).type).toBe('birth:local_sealed');
    expect(verifyLocalSeal(await readSeal('linden'), genesis).complete).toBe(true);
  });

  test('a lane this portal neither birthed nor owns is refused before anything is read', async () => {
    const frames = [];
    const connection = { ws: { send: (raw) => frames.push(JSON.parse(raw)) }, walletAddress: operator.address, companion: null };
    await birthLocalSealOffer(connection, {});
    expect(frames.at(-1)).toMatchObject({ type: 'birth:local_seal_error', code: 'NOT_OWNER' });
  });
});
