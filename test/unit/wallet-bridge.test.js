import { fork } from 'node:child_process';
import { once } from 'node:events';
import { ethers } from 'ethers';
import { connectViaBrowserBridge, applyBridgeSession } from '../../frontend/services/wallet-bridge-core.js';

const helper = new URL('../helpers/wallet-bridge-backend-process.mjs', import.meta.url).pathname;
let child;
let origin;
let wallet;
let token;
const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)) };
};

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
  const [ready] = await once(child, 'message');
  origin = `http://127.0.0.1:${ready.port}`;
  wallet = ethers.Wallet.createRandom();
  const challenge = (await (await fetch(`${origin}/api/v1/auth/challenge?address=${wallet.address}`)).json()).challenge;
  const signature = await wallet.signMessage(challenge);
  const verified = await fetch(`${origin}/api/v1/auth/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: wallet.address, signature, challenge }),
  });
  token = (await verified.json()).token;
  globalThis.window = {
    location: { origin },
    neuma: {
      walletBridge: { start: () => request('start'), poll: (browserCode, pollSecret) => request('poll', { browserCode, pollSecret }) },
    },
  };
  globalThis.sessionStorage = storage();
  globalThis.localStorage = storage();
});

afterAll(async () => {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
  delete globalThis.window;
  delete globalThis.sessionStorage;
  delete globalThis.localStorage;
});

test('the desktop IPC bridge returns a real authenticated session without committing it early', async () => {
  const opened = [];
  const running = connectViaBrowserBridge({ open: (url) => {
    opened.push(url);
    const browserCode = new URL(url).searchParams.get('bridge');
    fetch(`${origin}/api/v1/auth/bridge/associate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ browserCode, token }),
    }).catch(() => {});
  }, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))) });
  const result = await running;
  expect(result.token).toBe(token);
  expect(result.address).toBe(wallet.address.toLowerCase());
  expect(opened[0]).toContain('/?bridge=');
  expect(sessionStorage.getItem('authToken')).toBeNull();
  applyBridgeSession(result);
  expect(sessionStorage.getItem('authToken')).toBe(token);
  expect(localStorage.getItem('walletAddress')).toBe(result.address);
  expect(localStorage.getItem('walletConnected')).toBe('true');
});

test('a real bridge with no association times out without a token', async () => {
  await expect(connectViaBrowserBridge({
    open: () => {}, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))), deadlineMs: 10,
  })).rejects.toThrow(/timed out/);
});
