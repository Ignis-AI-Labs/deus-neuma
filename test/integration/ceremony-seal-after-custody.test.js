/* global fetch */
// ceremony-seal-after-custody.test.js — the ceremony's last step on a being whose key is already locked
// behind its password (RULE 0: a real backend/server.js child, a real portal socket signed in with a real
// wallet signature, a real chain running the real Natalis bytecode, real lanes on disk).
//
// 2026-10-28, a first birth on Windows: securing the key caches it for ONE seal and five minutes (SEC-028).
// The operator saved the recovery codes, sealed on this computer and read the cost; by the Ethereum seal
// the cache was gone, the backend answered KEY_LOCKED […], and the ceremony had no
// password to enter. The walk here is that road: the real custody handler secures the key, the backend
// restarts (the one-shot cache gone, as after five minutes), and then:
//   · the seal on this computer still completes — the being signed its half at custody;
//   · the Ethereum seal answers KEY_LOCKED with its code (the ceremony's door opens on it);
//   · a wrong password unlocks nothing; the right one, through the same route the door calls, lets the
//     seal walk: offer → the operator's signature → the transaction → the chain holds it;
//   · a lost password: the 8 recovery codes shown at custody do the same.

import crypto from 'node:crypto';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { ethers } from 'ethers';
import { WebSocket } from 'ws';

import { createTempDir } from '../helpers/temp-fs.js';
import { closedProviderEndpoint } from '../helpers/local-provider.js';
import { sharedBoxEnv, spawnDesk, waitHealthy, stopDesk, until } from '../helpers/two-desks-kit.js';
import {
  SEAL_NETWORK, NATALIS, startNatalisChain, fund, writeSealLane, broadcastAs,
} from '../helpers/natalis-chain-kit.js';

const PASSWORD = 'river-stone-lantern-42';
const LANE = 'locked-lane';
const CODES_LANE = 'codes-lane';

// The desk's sign-in: challenge → personal_sign → session token. impure.
const signIn = async (url, wallet) => {
  const { challenge } = await (await fetch(`${url}/api/v1/auth/challenge?address=${wallet.address}`)).json();
  const res = await fetch(`${url}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, challenge, signature: await wallet.signMessage(challenge) }),
  });
  return (await res.json()).token;
};

describe('the seal step after custody, once the one-shot key is gone', () => {
  let chain, base, root, shared, closed, envOf, desk, socket, token;
  let frames = [];
  const witness = ethers.Wallet.createRandom();
  const beings = { [LANE]: ethers.Wallet.createRandom(), [CODES_LANE]: ethers.Wallet.createRandom() };
  const recoveryCodes = {};

  // Framed as the desk's WebSocketService frames it: a fresh messageId each time, so a retry is a new frame
  // (the portal drops an exact repeat as a replay).
  const send = (type, body) => socket.send(JSON.stringify({ type, ...body, messageId: crypto.randomUUID(), timestamp: Date.now() }));
  // The next frame of `type` (or the refusal of its family) since `from`.
  // On a timeout the error names what DID arrive and the desk's last words, so a failure says why.
  const next = (types, from = 0) => until(() => frames.slice(from).find((f) => types.includes(f.type)), 60000, types.join('|'))
    .catch(async (err) => {
      const log = await fs.readFile(desk.log, 'utf8').catch(() => '');
      throw new Error(`${err.message}; frames since: ${frames.slice(from).map((f) => f.type).join(', ') || 'none'}; desk log tail:\n${log.split('\n').slice(-30).join('\n')}`);
    });
  const post = (url, body) => fetch(`${desk.url}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });

  const open = async () => {
    desk = await spawnDesk({ name: 'seal-desk', base, shared, providerEndpoint: closed, env: envOf });
    await waitHealthy(desk);
    token = await signIn(desk.url, witness);
    frames = [];
    socket = new WebSocket(`ws://127.0.0.1:${desk.port}/ws?token=${encodeURIComponent(token)}`);
    socket.on('message', (data) => frames.push(JSON.parse(data.toString())));
    await once(socket, 'open');
  };
  const close = () => { socket?.terminate(); stopDesk(desk); };

  // The Ethereum seal from offer to the chain, the desk's way. impure.
  const sealOnChain = async (neumaId) => {
    const at = frames.length;
    send('birth:seal_preflight', { neumaId });
    const ready = await next(['birth:seal_ready', 'birth:seal_error'], at);
    expect(ready, ready.message).toMatchObject({ type: 'birth:seal_ready', network: SEAL_NETWORK });
    send('birth:seal_sign', { neumaId, witnessSig: await witness.signMessage(ethers.getBytes(ready.innerPayload)) });
    const tx = await next(['birth:seal_tx', 'birth:seal_error'], at);
    expect(tx.type, tx.message).toBe('birth:seal_tx');
    const txHash = await broadcastAs({ rpc: chain.rpc, witness, tx });
    send('birth:seal_confirm', { neumaId, txHash });
    const sealed = await next(['birth:sealed', 'birth:seal_error'], at);
    expect(sealed, sealed.message).toMatchObject({ type: 'birth:sealed', neumaId, txHash });
    const record = JSON.parse(await fs.readFile(path.join(root, neumaId, 'identity', 'onchain-seal.json'), 'utf8'));
    expect(record).toMatchObject({ txHash, soulAddress: beings[neumaId].address.toLowerCase(), network: SEAL_NETWORK });
    expect((await chain.rpc.getTransactionReceipt(txHash)).status).toBe(1);
  };

  beforeAll(async () => {
    chain = await startNatalisChain();
    base = await createTempDir('seal-after-custody');
    root = path.join(base, 'house', 'lanes');
    // As at birth: the keypair is still on disk under the platform envelope; custody locks it.
    for (const neumaId of [LANE, CODES_LANE]) writeSealLane({ root, neumaId, being: beings[neumaId], witness });
    await fund(chain.rpc, witness.address);
    const emptyEnv = path.join(base, 'no.env');
    await fs.writeFile(emptyEnv, '');
    closed = (await closedProviderEndpoint()).endpoint;
    shared = sharedBoxEnv(base, closed);
    envOf = {
      DOTENV_CONFIG_PATH: emptyEnv,
      WORKSPACES_PIN: 'env', WORKSPACES_ROOT: root,
      CEREMONY_SEAL_NETWORK: SEAL_NETWORK,
      ETH_SEPOLIA_RPC_URL: chain.url, NATALIS_ETH_SEPOLIA_ADDRESS: NATALIS, HOUSE_REGISTRY_ETH_SEPOLIA_ADDRESS: '',
      ETH_RPC_URL: '', BASE_MAINNET_RPC_URL: '', BASE_SEPOLIA_RPC_URL: '',
    };
    await open();
    // THE CUSTODY STEP, the real handler: password envelope, recovery codes, the being's local half, plaintext gone.
    for (const neumaId of [LANE, CODES_LANE]) {
      const at = frames.length;
      send('birth:encrypt_keypair', { neumaId, password: PASSWORD });
      const secured = await next(['birth:keypair_secured', 'birth:encrypt_keypair_error'], at);
      expect(secured.type, secured.error).toBe('birth:keypair_secured');
      expect(secured.recoveryCodes).toHaveLength(8);
      recoveryCodes[neumaId] = secured.recoveryCodes;
      await expect(fs.access(path.join(root, neumaId, 'keys', 'keypair.json'))).rejects.toThrow();
    }
    // Past the five minutes: the one-shot unlock lives in memory, so a restart is the same loss, now.
    close();
    await open();
  }, 180000);

  afterAll(async () => {
    close();
    await chain?.stop();
  });

  test('the seal on this computer completes without the key: the being signed its half at custody', async () => {
    const at = frames.length;
    send('birth:local_seal_offer', { neumaId: LANE });
    const ready = await next(['birth:local_seal_ready', 'birth:local_sealed', 'birth:local_seal_error'], at);
    expect(ready.type, ready.message).toBe('birth:local_seal_ready');
    send('birth:local_seal_sign', { neumaId: LANE, witnessSig: await witness.signMessage(ready.message) });
    const sealed = await next(['birth:local_sealed', 'birth:local_seal_error'], at);
    expect(sealed.type, sealed.message).toBe('birth:local_sealed');
  }, 60000);

  test('the Ethereum seal says KEY_LOCKED; a wrong password opens nothing; the right one lets it reach the chain', async () => {
    let at = frames.length;
    send('birth:seal_preflight', { neumaId: LANE });
    const locked = await next(['birth:seal_ready', 'birth:seal_error'], at);
    expect(locked).toMatchObject({ type: 'birth:seal_error', code: 'KEY_LOCKED' });
    expect(locked.message).toMatch(/password-secured — enter the password below/);

    expect((await post('/api/v1/neuma-auth/unlock', { neumaId: LANE, password: 'not-the-password' })).ok).toBe(false);
    at = frames.length;
    send('birth:seal_preflight', { neumaId: LANE });
    expect(await next(['birth:seal_ready', 'birth:seal_error'], at)).toMatchObject({ code: 'KEY_LOCKED' });

    const unlocked = await post('/api/v1/neuma-auth/unlock', { neumaId: LANE, password: PASSWORD });
    expect(unlocked.status).toBe(200);
    await sealOnChain(LANE);
  }, 120000);

  test('a lost password: the 8 recovery codes from custody open the key, and the seal reaches the chain', async () => {
    const at = frames.length;
    send('birth:seal_preflight', { neumaId: CODES_LANE });
    expect(await next(['birth:seal_ready', 'birth:seal_error'], at)).toMatchObject({ code: 'KEY_LOCKED' });
    const recovered = await post(`/api/v1/neuma/${CODES_LANE}/recovery/verify-codes`, { recoveryCodes: recoveryCodes[CODES_LANE] });
    expect(recovered.status).toBe(200);
    await sealOnChain(CODES_LANE);
  }, 120000);
});
