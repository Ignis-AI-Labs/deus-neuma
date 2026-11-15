import { fork } from 'node:child_process';
import { once } from 'node:events';
import { ethers } from 'ethers';

const helper = new URL('../helpers/wallet-bridge-backend-process.mjs', import.meta.url).pathname;
let child;
let origin;

const request = (action, payload = {}) => new Promise((resolve, reject) => {
  const requestId = crypto.randomUUID();
  const receive = (message) => {
    if (message?.type !== 'neuma:wallet-bridge-result' || message.requestId !== requestId) return;
    child.off('message', receive);
    resolve(message.result);
  };
  child.on('message', receive);
  child.send({ type: 'neuma:wallet-bridge', requestId, action, ...payload }, (error) => { if (error) reject(error); });
});

beforeAll(async () => {
  child = fork(helper, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const message = await once(child, 'message');
  origin = `http://127.0.0.1:${message[0].port}`;
});

afterAll(async () => {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
});

test('desktop IPC owns start/poll while public HTTP exposes only association', async () => {
  const wallet = ethers.Wallet.createRandom();
  const address = wallet.address;
  const start = await request('start');
  expect(start.browserCode).toBeTruthy();
  expect(start.pollSecret).toBeTruthy();

  const deniedStart = await fetch(`${origin}/api/v1/auth/bridge/start`, { method: 'POST' });
  expect(deniedStart.status).toBe(404);
  const deniedPoll = await fetch(`${origin}/api/v1/auth/bridge/poll?code=${start.browserCode}`, { headers: { 'x-bridge-secret': start.pollSecret } });
  expect(deniedPoll.status).toBe(404);

  const challenge = (await (await fetch(`${origin}/api/v1/auth/challenge?address=${address}`)).json()).challenge;
  const signature = await wallet.signMessage(challenge);
  const verified = await fetch(`${origin}/api/v1/auth/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, signature, challenge }),
  });
  expect(verified.status).toBe(200);
  const token = (await verified.json()).token;
  const associated = await fetch(`${origin}/api/v1/auth/bridge/associate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ browserCode: start.browserCode, token }),
  });
  expect(associated.status).toBe(200);
  const retrieved = await request('poll', { browserCode: start.browserCode, pollSecret: start.pollSecret });
  expect(retrieved).toMatchObject({ status: 200, token, address: address.toLowerCase() });
  expect((await request('poll', { browserCode: start.browserCode, pollSecret: start.pollSecret })).status).toBe(404);
});
