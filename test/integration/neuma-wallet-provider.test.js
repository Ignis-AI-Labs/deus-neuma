/**
 * The wallet's RPC provider (RULE 0: a real HTTP server standing at the
 * configured Base endpoint, counting what reaches it). A read against an
 * endpoint that fails is answered null and then the endpoint is left alone:
 * a provider made per read and never destroyed kept re-running network
 * detection every second for the life of the process.
 */
import http from 'node:http';
import { test, expect, afterAll } from 'vitest';
import { loadConfig, _resetConfig } from '../../backend/config.js';
import { balanceOfAddress } from '../../backend/services/neuma-wallet.js';

const ADDRESS = '0x' + '11'.repeat(20);

afterAll(() => _resetConfig());

test('a failed balance read leaves the endpoint alone afterwards', async () => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    req.resume();
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('down for the proof');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    loadConfig({ NODE_ENV: 'test', BASE_MAINNET_RPC_URL: `http://127.0.0.1:${server.address().port}` });
    expect(await balanceOfAddress(ADDRESS, { network: 'base' })).toBeNull();
    expect(await balanceOfAddress(ADDRESS, { network: 'base' })).toBeNull();
    const settled = requests;
    expect(settled).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(requests).toBe(settled);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
