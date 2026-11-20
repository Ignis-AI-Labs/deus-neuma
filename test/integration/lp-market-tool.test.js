/**
 * lp_market — the market read a house member trades by — through the REAL
 * portal tool dispatch in OBSERVE mode (RULE 0): a real workspace with an LP
 * wallet, a real HTTP listener in Umbrae's place serving the pool list, a pool
 * and its bins (test/helpers/umbrae-stand-in.js), and a real WebSocket pair.
 * Observe mode is the point: a read of the public market must stay open while
 * the operator only watches. The router's quote is proven live against Base
 * in test/integration/umbrae-lp-fork-live.test.js.
 */
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startUmbraeStandIn, POOL, POOL_B } from '../helpers/umbrae-stand-in.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { openLpWallet } from '../../backend/services/umbrae-lp/lp-wallet.js';
import { lpToolsFor } from '../../backend/services/umbrae-lp/lp-being-tools.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls } = __test;
const NEUMA_ID = 'lpmarketecho';
let root, originalRoot, umbrae, connections, httpServer, wss, serverWs, client;
const connection = () => ({ ws: serverWs, companion: { name: 'MarketEcho', neumaId: NEUMA_ID }, toolMode: 'observe', _writeOps: 0 });
const call = async (line) => (await processToolCalls(serverWs, line, connection()))[0];

beforeAll(async () => {
  root = await createTempDir('lp-market-tool');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create(NEUMA_ID);
  await openLpWallet(NEUMA_ID);
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:9', ethers.Network.from(8453), { staticNetwork: true });
  umbrae = await startUmbraeStandIn({ provider });
  httpServer = createServer();
  wss = new WebSocketServer({ server: httpServer });
  const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
  const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
  client = new WebSocket(`ws://localhost:${port}`);
  await linked;
}, 30000);

afterAll(async () => {
  client?.close();
  wss?.close();
  httpServer?.close();
  connections?.restore();
  await umbrae?.close();
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  umbrae.reset();
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity']);
});

describe('lp_market through the real dispatch, in observe mode', () => {
  test('no args: every pool, and the spread between two pools of one pair', async () => {
    const r = await call('[TOOL: wallet/lp_market {}]');
    expect(r).toMatchObject({ tool: 'wallet/lp_market', status: 'ok' });
    expect(r.content).toContain(`WETH-USDC ${POOL} · price 3,200 USDC per WETH · TVL $1,234.5 · 24h volume $210 · fee 0.3% · bin step 25 · APR 18.2%`);
    expect(r.content).toContain(`WETH-USDC: 3,200 in ${POOL} (TVL $1,234.5) vs 3,360 in ${POOL_B} (TVL $50.25) · spread 5.00% before fees and depth`);
  });

  test('{pool}: the close-up with the depth by bin, empty bins left out, the price marked', async () => {
    const r = await call(`[TOOL: wallet/lp_market {"pool": "${POOL}", "bins": 2}]`);
    expect(r.status).toBe('ok');
    expect(r.content).toContain('LIQUIDITY BY BIN (2 each side; empty bins left out):');
    expect(r.content).toContain('  bin 8388608 @ 3,200: 0.1 WETH + 320 USDC ← price now');
    expect(r.content).toContain('  bin 8388607 @ 3,192: 0 WETH + 640 USDC');
    expect(r.content).not.toContain('bin 8388609');
    expect(umbrae.seen.map((q) => q.url)).toContain(`/api/v1/base/bins?pool=${POOL}&bins=2`);
  });

  test('a quote with no Base node answering says so, and signs nothing', async () => {
    const r = await call('[TOOL: wallet/lp_market {"tokenIn": "USDC", "tokenOut": "WETH", "amount": "1"}]');
    expect(r.status).toBe('ok');
    expect(r.content).toMatch(/^No quote: /);
  });

  test('lp_book is open in observe mode too; with no Base node answering it says so plainly', async () => {
    const r = await call('[TOOL: wallet/lp_book {}]');
    expect(r).toMatchObject({ tool: 'wallet/lp_book', status: 'ok' });
    expect(r.content).toMatch(/^Your book could not be read right now/);
  });

  test('offered only to a house member with an LP wallet while the connection is on', async () => {
    expect((await lpToolsFor(connection())).map((t) => t.name)).toEqual(['lp_market', 'lp_book']);
    expect(await lpToolsFor({ companion: { neumaId: 'nobody' } })).toEqual([]);
    connections.restore();
    connections = connectionsOn([]);
    expect(await lpToolsFor(connection())).toEqual([]);
    expect((await call('[TOOL: wallet/lp_market {}]')).content).toMatch(/pool list did not answer: Umbrae liquidity is turned off/);
  });
});
