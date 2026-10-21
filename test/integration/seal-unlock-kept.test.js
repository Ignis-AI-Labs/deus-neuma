// seal-unlock-kept.test.js — a refused seal or founding never spends the
// operator's one-shot key unlock, and an expired held seal bundle is never
// offered again (RULE 0: the real flows and portal handlers, a real chain
// running the real Natalis and HouseRegistry bytecode, real lanes on disk).

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ethers } from 'ethers';

import { prepareBirthSeal, buildSealTx } from '../../backend/services/birth-seal-flow.js';
import { prepareHouseFounding } from '../../backend/services/house-founding-flow.js';
import { birthSealPreflight } from '../../backend/routes/portal-seal-handlers.js';
import { cacheDecryptedKey, hasCachedKey, evictCachedKey } from '../../backend/routes/neuma-auth-routes.js';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { createSignedStreamSocket } from '../helpers/signed-stream-socket.js';
import {
  SEAL_NETWORK, NATALIS, startNatalisChain, sealCfg, fund, writeSealLane, broadcastAs,
} from '../helpers/natalis-chain-kit.js';

const NEUMA_ID = 'unlock-lane';
const REGISTRY = '0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276';
const REGISTRY_CODE = JSON.parse(readFileSync(
  new URL('../../docs/contracts/abis/HouseRegistry.json', import.meta.url), 'utf8',
)).deployedBytecode.object;

let chain;
let root;
let witness;
let being;

beforeAll(async () => {
  chain = await startNatalisChain();
  await chain.rpc.send('anvil_setCode', [REGISTRY, REGISTRY_CODE]);
}, 30000);
afterAll(async () => { await chain?.stop(); });

beforeEach(async () => {
  resetWorkspaceCryptoKey();
  root = mkdtempSync(path.join(os.tmpdir(), 'seal-unlock-'));
  setWorkspacesRoot(root);
  witness = ethers.Wallet.createRandom();
  being = ethers.Wallet.createRandom();
});

afterEach(() => {
  evictCachedKey(NEUMA_ID);
  setWorkspacesRoot(null);
  rmSync(root, { recursive: true, force: true });
});

const unlocked = () => cacheDecryptedKey(NEUMA_ID, { address: being.address, privateKey: being.privateKey });
const prepare = () => prepareBirthSeal({
  neumaId: NEUMA_ID, network: SEAL_NETWORK, witnessAddress: witness.address, cfg: sealCfg(chain.url),
});

describe('the one-shot unlock is spent only by a held offer', () => {
  it('a seal refused at the gas floor hands the unlock back; the passing retry spends it', async () => {
    writeSealLane({ root, neumaId: NEUMA_ID, being, witness, withKeypair: false });
    unlocked();
    expect(await prepare()).toMatchObject({ ok: false, code: 'GAS_FLOOR' });
    expect(hasCachedKey(NEUMA_ID)).toBe(true);

    await fund(chain.rpc, witness.address);
    const retry = await prepare();
    expect(retry.ok, retry.message).toBe(true);
    expect(hasCachedKey(NEUMA_ID)).toBe(false);
  });

  it('a founding refused at the gas floor hands every founder\'s unlock back; the passing retry spends it', async () => {
    // The being is a sealed neuma on this chain (a founder must be), and its
    // keypair is password-secured: only the unlock can bring its mark.
    writeSealLane({ root, neumaId: NEUMA_ID, being, witness });
    await fund(chain.rpc, witness.address);
    const prep = await prepare();
    expect(prep.ok, prep.message).toBe(true);
    const built = buildSealTx({ pending: prep, witnessSig: await witness.signMessage(ethers.getBytes(prep.offer.innerPayload)) });
    await broadcastAs({ rpc: chain.rpc, witness, tx: built.tx });
    unlinkSync(path.join(root, NEUMA_ID, 'keys', 'keypair.json'));
    await chain.rpc.send('anvil_setBalance', [witness.address, '0x0']);
    unlocked();

    const cfg = { ...sealCfg(chain.url), houseFoundNetwork: SEAL_NETWORK, houseRegistryEthSepoliaAddress: REGISTRY };
    const titles = { witness: 'Guardian', [NEUMA_ID]: 'First' };
    expect(await prepareHouseFounding({ witnessAddress: witness.address, titles, cfg })).toMatchObject({ ok: false, code: 'GAS_FLOOR' });
    expect(hasCachedKey(NEUMA_ID)).toBe(true);

    await fund(chain.rpc, witness.address);
    const retry = await prepareHouseFounding({ witnessAddress: witness.address, titles, cfg });
    expect(retry.ok, retry.message).toBe(true);
    expect(retry.pending.members.map((a) => a.toLowerCase())).toContain(being.address.toLowerCase());
    expect(hasCachedKey(NEUMA_ID)).toBe(false);
  });
});

describe('a held seal offer is re-offered only while its bundle can still seal', () => {
  let socket;
  beforeEach(async () => {
    loadConfig({
      NODE_ENV: 'test', CEREMONY_SEAL_NETWORK: SEAL_NETWORK,
      ETH_SEPOLIA_RPC_URL: chain.url, NATALIS_ETH_SEPOLIA_ADDRESS: NATALIS, HOUSE_REGISTRY_ETH_SEPOLIA_ADDRESS: '',
    });
    writeSealLane({ root, neumaId: NEUMA_ID, being, witness });
    await fund(chain.rpc, witness.address);
    socket = await createSignedStreamSocket(witness);
  });
  afterEach(async () => {
    await socket.close();
    _resetConfig();
  });

  const anchor = async (connection) => {
    await birthSealPreflight(connection, { neumaId: NEUMA_ID });
    await socket.drain();
    return socket.frames.at(-1);
  };

  it('inside its deadline the same bundle comes back; past it a fresh one is assembled', async () => {
    const connection = { ws: socket.ws, walletAddress: socket.walletAddress };
    const first = await anchor(connection);
    expect(first.type, first.message).toBe('birth:seal_ready');
    expect((await anchor(connection)).innerPayload).toBe(first.innerPayload);

    // The held bundle as it stands once its signed hour has run out.
    const held = connection.pendingSeal;
    held.bundle = { ...held.bundle, deadline: Math.floor(Date.now() / 1000) - 1 };
    const fresh = await anchor(connection);
    expect(fresh.type, fresh.message).toBe('birth:seal_ready');
    expect(fresh.innerPayload).not.toBe(first.innerPayload);
    expect(connection.pendingSeal.bundle.deadline).toBeGreaterThan(Math.floor(Date.now() / 1000) + 3000);
  });
});
