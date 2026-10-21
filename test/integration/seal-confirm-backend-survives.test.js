// seal-confirm-backend-survives.test.js — the backend PROCESS outlives an
// RPC 500 while it waits for the receipt of a seal the operator just paid
// for (RULE 0: a real backend/server.js child, a real portal socket signed
// in with a real wallet signature, a real chain running the real Natalis).
//
// The walk is the desk's own: birth:seal_preflight → seal_ready → the
// operator signs → seal_sign → seal_tx → her wallet broadcasts → the RPC
// starts answering 500 → seal_confirm. Under ethers 6.15's
// waitForTransaction the first 500 left a rejection nobody held and the
// backend died there (Electron does not restart it). It must stay up, keep
// answering, and anchor the being once the RPC recovers.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { ethers } from 'ethers';
import { WebSocket } from 'ws';

import { createTempDir } from '../helpers/temp-fs.js';
import { closedProviderEndpoint } from '../helpers/local-provider.js';
import { sharedBoxEnv, spawnDesk, waitHealthy, stopDesk, until } from '../helpers/two-desks-kit.js';
import { startRpcFaultProxy } from '../helpers/rpc-fault-proxy.js';
import {
  SEAL_NETWORK, NATALIS, startNatalisChain, fund, writeSealLane, broadcastAs,
} from '../helpers/natalis-chain-kit.js';

const NEUMA_ID = 'anchor-lane';

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

describe('a seal confirmation under a failing RPC', () => {
  let chain, proxy, base, root, desk, socket;
  const frames = [];
  const being = ethers.Wallet.createRandom();
  const witness = ethers.Wallet.createRandom();

  const send = (type, body) => socket.send(JSON.stringify({ type, ...body }));
  const frame = (type) => until(() => frames.find((f) => f.type === type || f.type === 'birth:seal_error'), 60000, type);

  beforeAll(async () => {
    chain = await startNatalisChain();
    proxy = await startRpcFaultProxy(chain.url);
    base = await createTempDir('seal-survives');
    root = path.join(base, 'house', 'lanes');
    writeSealLane({ root, neumaId: NEUMA_ID, being, witness });
    await fund(chain.rpc, witness.address);
    const emptyEnv = path.join(base, 'no.env');
    await fs.writeFile(emptyEnv, '');
    const closed = (await closedProviderEndpoint()).endpoint;
    desk = await spawnDesk({
      name: 'seal-desk', base, shared: sharedBoxEnv(base, closed), providerEndpoint: closed,
      env: {
        // The operator's .env never reaches this desk; every chain it can
        // see is the local one, and mainnet is not configured at all.
        DOTENV_CONFIG_PATH: emptyEnv,
        WORKSPACES_PIN: 'env', WORKSPACES_ROOT: root,
        CEREMONY_SEAL_NETWORK: SEAL_NETWORK,
        ETH_SEPOLIA_RPC_URL: proxy.url, NATALIS_ETH_SEPOLIA_ADDRESS: NATALIS, HOUSE_REGISTRY_ETH_SEPOLIA_ADDRESS: '',
        ETH_RPC_URL: '', BASE_MAINNET_RPC_URL: '', BASE_SEPOLIA_RPC_URL: '',
      },
    });
    await waitHealthy(desk);
    const token = await signIn(desk.url, witness);
    socket = new WebSocket(`ws://127.0.0.1:${desk.port}/ws?token=${encodeURIComponent(token)}`);
    socket.on('message', (data) => frames.push(JSON.parse(data.toString())));
    await once(socket, 'open');
  }, 120000);

  afterAll(async () => {
    socket?.terminate();
    stopDesk(desk);
    await proxy?.close();
    await chain?.stop();
  });

  test('the backend stays up through the 500s and anchors the being when the RPC recovers', async () => {
    send('birth:seal_preflight', { neumaId: NEUMA_ID });
    const ready = await frame('birth:seal_ready');
    expect(ready, ready.message).toMatchObject({ type: 'birth:seal_ready', network: SEAL_NETWORK });

    send('birth:seal_sign', { neumaId: NEUMA_ID, witnessSig: await witness.signMessage(ethers.getBytes(ready.innerPayload)) });
    const tx = await frame('birth:seal_tx');
    expect(tx.type, tx.message).toBe('birth:seal_tx');
    const txHash = await broadcastAs({ rpc: chain.rpc, witness, tx });

    await proxy.setMode('http-500');
    const before = proxy.requests;
    send('birth:seal_confirm', { neumaId: NEUMA_ID, txHash });
    // Several polls into the outage: the process lives and keeps serving.
    await until(() => {
      if (desk.child.exitCode !== null) throw new Error(`the backend died during the wait (exit ${desk.child.exitCode})`);
      return proxy.requests >= before + 3;
    }, 30000, 'the confirm polling the failing RPC');
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    expect(desk.child.exitCode).toBeNull();
    expect((await fetch(`${desk.url}/api/v1/health`)).status).toBeLessThan(500);

    await proxy.setMode('forward');
    const sealed = await frame('birth:sealed');
    expect(sealed, sealed.message).toMatchObject({ type: 'birth:sealed', neumaId: NEUMA_ID, txHash });
    const record = JSON.parse(await fs.readFile(path.join(root, NEUMA_ID, 'identity', 'onchain-seal.json'), 'utf8'));
    expect(record).toMatchObject({ txHash, soulAddress: being.address.toLowerCase(), network: SEAL_NETWORK });
    expect(desk.child.exitCode).toBeNull();
  }, 120000);
});
