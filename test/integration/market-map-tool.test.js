/**
 * market_map — the field a house member maps — through the REAL portal tool
 * dispatch in OBSERVE mode (RULE 0): a real workspace, real HTTP listeners in
 * the places of GeckoTerminal, DexScreener and DefiLlama serving their REAL
 * answers captured 2026-11-14, a real listener in Umbrae's place for its pool
 * list, and a real WebSocket pair. Observe mode is the point: research stays
 * open while the operator only watches. Offered to a member with no LP wallet
 * too: research does not need money.
 */
import process from 'node:process';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import { WebSocket, WebSocketServer } from 'ws';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { startUmbraeStandIn } from '../helpers/umbrae-stand-in.js';
import { startMarketStandIn } from '../helpers/market-stand-in.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { lpToolsFor } from '../../backend/services/umbrae-lp/lp-being-tools.js';
import { clearMarketCache } from '../../backend/services/market-map/market-data.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls } = __test;
const NEUMA_ID = 'mapper';
let root, originalRoot, umbrae, market, connections, httpServer, wss, serverWs, client;
const connection = () => ({ ws: serverWs, companion: { name: 'Mapper', neumaId: NEUMA_ID }, toolMode: 'observe', _writeOps: 0 });
const call = async (args) => (await processToolCalls(serverWs, `[TOOL: wallet/market_map ${JSON.stringify(args)}]`, connection()))[0];

beforeAll(async () => {
  root = await createTempDir('market-map-tool');
  originalRoot = getWorkspacesRoot();
  setWorkspacesRoot(root);
  await workspace.create(NEUMA_ID); // no LP wallet: research needs none
  umbrae = await startUmbraeStandIn({ provider: new ethers.JsonRpcProvider('http://127.0.0.1:9', ethers.Network.from(8453), { staticNetwork: true }) });
  market = await startMarketStandIn();
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
  await market?.close();
  await umbrae?.close();
  setWorkspacesRoot(originalRoot);
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  umbrae.reset();
  market.reset();
  clearMarketCache();
  connections?.restore();
  connections = connectionsOn(['market-data', 'umbrae-liquidity']);
});

describe('market_map through the real dispatch, in observe mode', () => {
  test('offered to a member with no LP wallet while Market data is on; not with it off', async () => {
    expect((await lpToolsFor(connection())).map((t) => t.name)).toEqual(['market_map']);
    connections.restore();
    connections = connectionsOn(['umbrae-liquidity']);
    expect(await lpToolsFor(connection())).toEqual([]);
  });

  test('no args: Base\'s busiest pools on every DEX, trending, and the Umbrae gaps with the act that fills each', async () => {
    const r = await call({});
    expect(r).toMatchObject({ tool: 'wallet/market_map', status: 'ok' });
    expect(r.content).toMatch(/^THE FIELD ON BASE: busiest pools by 24h volume/);
    expect(r.content).toContain('cbBTC / WETH 0.16% on aero-slipstream-base');
    expect(r.content).toContain('TRENDING now:');
    // the stand-in Umbrae trades WETH and USDC and has a WETH-USDC pool: cbBTC-WETH is a gap it can host
    expect(r.content).toMatch(/UMBRAE GAPS: pairs trading on Base with no Umbrae pool \(\d+\)/);
    expect(r.content).toContain('lp/create-pool {baseToken: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", quoteToken: "0x4200000000000000000000000000000000000006", check: true}');
    expect(r.content).toMatch(/SUSPECT \([^)]*234 trades/);
    expect(r.content).not.toMatch(/WETH \/ USDC 0\.3% on uniswap-v3-base[^\n]*\n {4}Umbrae has no pool/);
  });

  test('another network, the newest pools, a token\'s every market, yields anywhere', async () => {
    expect((await call({ network: 'robinhood' })).content).toMatch(/^THE FIELD ON ROBINHOOD/);
    expect(market.seen).toContain('/api/v2/networks/robinhood/pools?sort=h24_volume_usd_desc&page=1');
    expect((await call({ new: true })).content).toMatch(/^NEWEST POOLS ON BASE \(early; most fail or are traps/);
    expect((await call({ token: 'VIRTUAL' })).content).toMatch(/^MARKETS FOR VIRTUAL \(5, on [a-z, ]+\), deepest first/);
    expect((await call({ token: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' })).content).toContain('base · pancakeswap · cbBTC/WETH');
    const y = (await call({ yields: true, chain: 'Base', minTvlUsd: 2000000, limit: 3 })).content;
    expect(y).toMatch(/^YIELDS \(Base\), TVL at least \$2\.0M, highest first, of 7 tracked/);
    expect(y).toContain('Base · aerodrome-v1 · WETH-VVV');
  });

  test('answers are kept a few minutes: the same read twice asks the source once', async () => {
    await call({ yields: true });
    await call({ yields: true, chain: 'Ethereum' });
    expect(market.seen.filter((u) => u === '/pools')).toHaveLength(1);
  });

  test('pinned: a host that is not the source\'s own is never called', async () => {
    const prior = process.env.NEUMA_LLAMA_ORIGIN;
    process.env.NEUMA_LLAMA_ORIGIN = 'https://evil.example';
    try {
      expect((await call({ yields: true })).content).toBe('Yields were not read: refusing to call a host that is not yields.llama.fi');
    } finally {
      process.env.NEUMA_LLAMA_ORIGIN = prior;
    }
  });

  test('a source that asks to slow down, and Market data switched off, are said plainly', async () => {
    market.state.mode = 'slow-down';
    expect((await call({ network: 'eth' })).content).toMatch(/asked to slow down \(too many reads this minute\)/);
    connections.restore();
    connections = connectionsOn(['umbrae-liquidity']);
    market.reset();
    expect((await call({ yields: true })).content).toMatch(/market data is turned off on this computer/);
    expect(market.seen).toEqual([]);
  });
});
