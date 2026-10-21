// house-founding-sent-recovery.test.js — a founding that was SENT is checked,
// never offered again (RULE 0: the real portal founding handlers on a real
// signed portal socket; a real chain running the real Natalis, which seals
// the founding being for real, and the real HouseRegistry runtime; real lane
// files on disk).
//
// Before: a confirmation still waiting (or one that ran out at
// RECEIPT_TIMEOUT) left the next FOUND composing a fresh founding while the
// house still read unfounded — a second tx the operator signs and pays for,
// reverted (NameTaken) once the first mines.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ethers } from 'ethers';

import { houseFoundPreflight, houseFoundSign, houseFoundConfirm } from '../../backend/routes/portal-seal-handlers.js';
import { prepareBirthSeal, buildSealTx } from '../../backend/services/birth-seal-flow.js';
import { loadHouseRegistryAbi } from '../../backend/services/house-founding-flow.js';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { createSignedStreamSocket } from '../helpers/signed-stream-socket.js';
import { until } from '../helpers/two-desks-kit.js';
import {
  SEAL_NETWORK, NATALIS, startNatalisChain, sealCfg, fund, writeSealLane, broadcastAs,
} from '../helpers/natalis-chain-kit.js';

const NEUMA_ID = 'founding-lane';
const REGISTRY = '0x7e9a6b1c5f2d4e8a0b3c6d9e1f4a7b0c3d6e9f12';
const REGISTRY_CODE = JSON.parse(readFileSync(
  new URL('../../docs/contracts/abis/HouseRegistry.json', import.meta.url), 'utf8',
)).deployedBytecode.object;

let chain;
let root;
let realm;
let witness;
let being;
let priorSettingsPath;
const sockets = [];

beforeAll(async () => {
  chain = await startNatalisChain();
  // The registry's runtime at its address, initialized against the real Natalis.
  await chain.rpc.send('anvil_setCode', [REGISTRY, REGISTRY_CODE]);
  const platform = ethers.Wallet.createRandom();
  await fund(chain.rpc, platform.address);
  const registry = new ethers.Contract(REGISTRY, loadHouseRegistryAbi(SEAL_NETWORK), platform.connect(chain.rpc));
  await (await registry.initialize(NATALIS, platform.address)).wait();
}, 30000);
afterAll(async () => { await chain?.stop(); });

beforeEach(async () => {
  resetWorkspaceCryptoKey();
  root = mkdtempSync(path.join(os.tmpdir(), 'founding-sent-'));
  realm = mkdtempSync(path.join(os.tmpdir(), 'founding-sent-realm-'));
  setWorkspacesRoot(root);
  setRealmRoot(realm);
  priorSettingsPath = process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
  process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(realm, 'workspace-settings.json');
  witness = ethers.Wallet.createRandom();
  being = ethers.Wallet.createRandom();
  writeSealLane({ root, neumaId: NEUMA_ID, being, witness });
  await fund(chain.rpc, witness.address);
  // A founder must be a sealed neuma on this chain: seal the being for real.
  const prep = await prepareBirthSeal({ neumaId: NEUMA_ID, network: SEAL_NETWORK, witnessAddress: witness.address, cfg: sealCfg(chain.url) });
  expect(prep.ok, prep.message).toBe(true);
  const built = buildSealTx({ pending: prep, witnessSig: await witness.signMessage(ethers.getBytes(prep.offer.innerPayload)) });
  await (await chain.rpc.getTransaction(await broadcastAs({ rpc: chain.rpc, witness, tx: built.tx }))).wait();
  loadConfig({
    NODE_ENV: 'test', HOUSE_FOUND_NETWORK: SEAL_NETWORK, ETH_SEPOLIA_RPC_URL: chain.url,
    NATALIS_ETH_SEPOLIA_ADDRESS: NATALIS, HOUSE_REGISTRY_ETH_SEPOLIA_ADDRESS: REGISTRY,
  });
});

afterEach(async () => {
  await chain.rpc.send('evm_setAutomine', [true]);
  for (const s of sockets.splice(0)) await s.close();
  _resetConfig();
  setWorkspacesRoot(null);
  setRealmRoot(path.join(os.homedir(), '.kenorie', 'realm'));
  if (priorSettingsPath === undefined) delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
  else process.env.NEUMA_WORKSPACE_SETTINGS_PATH = priorSettingsPath;
  rmSync(root, { recursive: true, force: true });
  rmSync(realm, { recursive: true, force: true });
});

const sentFile = () => path.join(root, `house-founding-sent.${witness.address.toLowerCase()}.json`);
const TITLES = () => ({ witness: 'Rector', [NEUMA_ID]: 'First of the house' });

const connect = async () => {
  const socket = await createSignedStreamSocket(witness);
  sockets.push(socket);
  return { socket, connection: { ws: socket.ws, walletAddress: socket.walletAddress } };
};
const lastFrame = async (socket) => { await socket.drain(); return socket.frames.at(-1); };

// The desk's walk up to the broadcast: preflight → the operator's mark → the tx to send.
const walkToTx = async ({ socket, connection }) => {
  await houseFoundPreflight(connection, { titles: TITLES() });
  const ready = await lastFrame(socket);
  expect(ready.type, ready.message).toBe('house:found_ready');
  const witnessSig = await witness.signMessage(ethers.getBytes(ready.innerPayload));
  await houseFoundSign(connection, { witnessSig });
  const tx = await lastFrame(socket);
  expect(tx.type, tx.message).toBe('house:found_tx');
  return { tx, witnessSig };
};

describe('the portal founding frames after a sent tx', () => {
  it('while the sent founding is pending, FOUND is told so — nothing new is offered or signed on any connection', async () => {
    const first = await connect();
    const { tx, witnessSig } = await walkToTx(first);
    await chain.rpc.send('evm_setAutomine', [false]);
    // The nonce asked of the node itself: the provider's short request cache still holds the seal's.
    const nonce = Number(await chain.rpc.send('eth_getTransactionCount', [witness.address, 'pending']));
    const txHash = (await witness.connect(chain.rpc).sendTransaction({ to: tx.to, data: tx.data, nonce })).hash;
    // The confirmation waits on a tx that is not mined yet.
    const confirming = houseFoundConfirm(first.connection, { txHash });
    await until(() => existsSync(sentFile()), 10000, 'the sent record');

    // The held founding cannot be signed into a second tx.
    await houseFoundSign(first.connection, { witnessSig });
    expect(await lastFrame(first.socket)).toMatchObject({ type: 'house:found_error', code: 'FOUNDING_PENDING' });

    // The same connection and a reconnected one both ask again.
    const again = await connect();
    for (const { socket, connection } of [first, again]) {
      await houseFoundPreflight(connection, { titles: TITLES() });
      const answer = await lastFrame(socket);
      expect(answer).toMatchObject({ type: 'house:found_error', code: 'FOUNDING_PENDING' });
      expect(answer.message).toContain(txHash);
    }
    expect(again.socket.frames.some((f) => f.type === 'house:found_ready')).toBe(false);

    await chain.rpc.send('evm_mine', []);
    await confirming;
    await first.socket.drain();
    expect(first.socket.frames.find((f) => f.type === 'house:founded'), JSON.stringify(first.socket.frames.at(-1))).toMatchObject({ txHash });
    expect(existsSync(sentFile())).toBe(false);
    await houseFoundPreflight(again.connection, { probe: true });
    expect(await lastFrame(again.socket)).toMatchObject({ type: 'house:found_state', txHash });
  }, 60000);
});
