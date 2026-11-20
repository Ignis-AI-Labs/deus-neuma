/**
 * A real HTTP listener in the place of GeckoTerminal, DexScreener and DefiLlama
 * (RULE 0: no mocked fetch), serving the REAL answers captured 2026-11-14
 * (test/fixtures/market-map/live-samples.json) on each source's own paths, and
 * pointing the client's three env doors at itself. state.mode 'slow-down'
 * answers 429 like GeckoTerminal past its rate.
 */
import process from 'node:process';
import http from 'node:http';
import fs from 'node:fs';

export const SAMPLES = JSON.parse(fs.readFileSync(new URL('../fixtures/market-map/live-samples.json', import.meta.url), 'utf8'));
const DOORS = ['NEUMA_GECKO_ORIGIN', 'NEUMA_DEXSCREENER_ORIGIN', 'NEUMA_LLAMA_ORIGIN'];

export const startMarketStandIn = async () => {
  const seen = [];
  const state = { mode: 'honest' };
  const answer = (url) => {
    if (state.mode === 'slow-down') return [429, { status: 429, error_message: 'Rate limit' }];
    const path = new URL(url, 'http://x').pathname;
    let m = /^\/api\/v2\/networks\/([a-z0-9_-]+)\/(pools|trending_pools|new_pools)$/.exec(path);
    if (m) return [200, m[2] === 'pools' ? SAMPLES.geckoTop : m[2] === 'trending_pools' ? SAMPLES.geckoTrending : SAMPLES.geckoNew];
    if (path === '/latest/dex/search') return [200, SAMPLES.dexSearch];
    m = /^\/token-pairs\/v1\/([a-z0-9_-]+)\/(0x[0-9a-fA-F]{40})$/.exec(path);
    if (m) return [200, SAMPLES.dexTokenPairs];
    if (path === '/pools') return [200, SAMPLES.llama];
    return [404, { error: 'not here' }];
  };
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    const [status, body] = answer(req.url);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const prior = Object.fromEntries(DOORS.map((k) => [k, process.env[k]]));
  for (const k of DOORS) process.env[k] = `http://127.0.0.1:${server.address().port}`;
  return {
    seen, state,
    reset: () => { seen.length = 0; state.mode = 'honest'; },
    close: async () => {
      for (const k of DOORS) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; }
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};
