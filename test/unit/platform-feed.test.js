/**
 * platform-feed — the being-facing read of the Umbrae platform's numbers.
 *
 * RULE 0: no mock, stub, spy or fake anywhere in this file. The shapers are
 * pure and are called with REAL recorded payloads (captured live from
 * www.umbrae.io on 2026-08-30, HTTP 200 on all three). The read path runs
 * against a REAL http server on a real socket, and the tool handler runs the
 * real handler through the real reader against that same real server.
 *
 * The laws under test are the ones that protect a being from narrating a
 * number that was never true:
 *   · absent is UNKNOWN, never zero
 *   · the platform's own doubt flags become caveats the being will read
 *   · a caller cannot point this client at a host of its choosing
 *   · the trading surface is not in the registry at all
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import {
  figure, momentOf, shapePlatform, shapeToken, shapePools,
} from '../../backend/services/platform-feed/platform-feed-shape.js';
import {
  FEEDS, FEED_NAMES, feedByName, describeFeeds,
} from '../../backend/services/platform-feed/platform-feed-sources.js';
import { permittedFeedUrl, readPlatformFeed } from '../../backend/services/platform-feed/platform-feed-read.js';
import {
  PLATFORM_FEED_TOOLS, isPlatformFeedTool, platformFeedToolsFor, handlePlatformFeedTool,
} from '../../backend/services/platform-feed/platform-feed-tools.js';
import { connectionsOn } from '../helpers/connections-kit.js';

// Public platform data is off until the person turns it on (CONNECTIONS); this suite proves it on.
const connections = connectionsOn(['platform-data']);
afterAll(() => connections.restore());

// Real bodies, captured live 2026-08-30 00:12.
const LIVE_PLATFORM = {
  volumeAllTimeUsd: 21628608.622931797,
  volume24hUsd: 5302.910226595295,
  feesAllTimeUsd: 23705.33356755381,
  protocolRevenueUsd: 1185.2666783776908,
  lpEarningsUsd: 22520.06688917612,
  protocolTakeRate: 0.05,
  tvlUsd: 210447.2187587649,
  tradeCount: 66654,
  damm: { volumeAllTimeUsd: 541057.0181685297, volume24hUsd: 118.48591610094863, feesAllTimeUsd: 6323.271895084266, protocolRevenueUsd: 316.16359475421336, lpEarningsUsd: 6007.108300330053, tvlUsd: 94230.62440143677, tradeCount: 1639 },
  dlmm: { volumeAllTimeUsd: 21087551.604763266, volume24hUsd: 5184.424310494346, feesAllTimeUsd: 17382.061672469546, protocolRevenueUsd: 869.1030836234773, lpEarningsUsd: 16512.958588846068, tvlUsd: 48357.82083905745, tradeCount: 65015 },
  lock: { tvlUsd: 67858.77351827068, lockedU1: 1125703.9569720991, isFresh: true },
  dlmmVolumeApproximate: true,
  asOf: 1788023790879,
};

const LIVE_TOKEN = {
  priceU1Weth: 0.000024567331209671536,
  priceU1Usd: 0.06028118947080558,
  change24hPct: -0.1011728386389366,
  volume24hUsd: 118.48591610094863,
  marketCapUsd: 250166.93630384316,
  fdvUsd: 301405.9473540279,
  circulatingSupply: 4150000,
  totalSupply: 5000000,
  tvlUsd: 94230.62440143677,
  aprPct: 0.5094370244623722,
  feeBps: 111,
  protocolFeePct: 500,
  wethUsd: 2453.71338695,
  isFresh: true,
  circulatingIsEstimated: false,
  poolCreatedAtUnix: 1778176831,
  lifetimeVolumeUsd: 541057.0181685297,
  lifetimeSwapCount: 1639,
  lifetimeFeesUsd: 6323.271895084266,
};

// Note the STRINGS — the pools feed publishes its figures as strings.
const LIVE_POOLS = {
  groups: [
    {
      name: 'VIRTUAL-WETH',
      mint_x: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b',
      tokenX: 'VIRTUAL', tokenY: 'WETH',
      tokenXIconUrl: 'https://dd.dexscreener.com/ds-data/tokens/base/0x0b3e.png?size=lg',
      tokenXPrice: 0.6912714386000579, tokenYPrice: 2453.71338695,
      priceChange24h: 0.49999999999998934, marketCap: 343558520.39137846,
      pairs: [{
        address: '0x05de9d85b9a32e4a97814b6c4ede8768536d3ec5',
        liquidity: '38561.23520903889', trade_volume_24h: '530.3042732006734',
        total_fees_usd: '3.4814652777326844', volume_all_time_usd: '736.60475876239',
        trade_count: 4, apy: 2.3724365273954033, high_24h_bin_id: 8386969,
      }],
    },
    {
      name: 'U1-WETH',
      mint_x: '0x14a4e80d633af55ace1160c320f5a36d41cced3e',
      tokenX: 'U1', tokenY: 'WETH',
      tokenXPrice: 0.06010602480569067, tokenYPrice: 2453.71338695,
      priceChange24h: 0, marketCap: 300530.1240284533,
      pairs: [
        { address: '0xd288889ef25ca7483277f39c262098f6ba615ff2', liquidity: '100.5', trade_volume_24h: '10', total_fees_usd: '1', volume_all_time_usd: '20', trade_count: 2 },
        { address: '0xaaa', liquidity: '99.5', trade_volume_24h: '5', total_fees_usd: '0.5', volume_all_time_usd: '10', trade_count: 3 },
      ],
    },
  ],
};

const READ_AT = '2026-08-30T00:12:00Z';

describe('absent is UNKNOWN, never zero', () => {
  test('figure() keeps a real zero and refuses to invent one', () => {
    expect(figure(0)).toBe(0);
    expect(figure('0')).toBe(0);
    // Number(null) is 0 and Number('') is 0 — the exact trap this guards.
    expect(figure(null)).toBe(null);
    expect(figure(undefined)).toBe(null);
    expect(figure('')).toBe(null);
    expect(figure('not a number')).toBe(null);
    expect(figure(NaN)).toBe(null);
  });

  test('a field the feed did not carry comes back null, not 0', () => {
    const shaped = shapeToken({ priceU1Usd: 1.5 }, READ_AT);
    expect(shaped.priceUsd).toBe(1.5);
    expect(shaped.marketCapUsd).toBe(null);
    expect(shaped.fdvUsd).toBe(null);
    expect(shaped.circulatingSupply).toBe(null);
  });

  test('an all-absent fold is null, not a zero sum', () => {
    const shaped = shapePools({ groups: [{ name: 'X-Y', tokenX: 'X', pairs: [{}, {}] }] }, READ_AT);
    expect(shaped.tokens[0].tvlUsd).toBe(null);
    expect(shaped.tokens[0].volume24hUsd).toBe(null);
    // The pool COUNT is a real count of a real array — that one is honest at 2.
    expect(shaped.tokens[0].poolCount).toBe(2);
  });
});

describe('the platform aggregate', () => {
  const shaped = shapePlatform(LIVE_PLATFORM, READ_AT);

  test('carries the headline figures and the venue split', () => {
    expect(shaped.tvlUsd).toBeCloseTo(210447.2187587649, 6);
    expect(shaped.tradeCount).toBe(66654);
    expect(shaped.byVenue.damm.tvlUsd).toBeCloseTo(94230.62440143677, 6);
    expect(shaped.byVenue.dlmm.tradeCount).toBe(65015);
    expect(shaped.lock.lockedU1).toBeCloseTo(1125703.9569720991, 6);
  });

  test('the epoch-millis moment becomes a readable ISO instant', () => {
    // 13 raw digits handed to a being invite it to read the moment as a quantity.
    expect(shaped.asOf).toBe(momentOf(1788023790879));
    expect(shaped.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("the source's own approximation flag becomes a sentence, not a boolean", () => {
    expect(shaped.approximate).toBe(true);
    expect(shaped.caveats).toHaveLength(1);
    expect(shaped.caveats[0]).toMatch(/CURRENT token prices/);
  });

  test('a feed that does NOT claim approximation carries no caveat', () => {
    const exact = shapePlatform({ ...LIVE_PLATFORM, dlmmVolumeApproximate: false }, READ_AT);
    expect(exact.approximate).toBe(false);
    expect(exact.caveats).toEqual([]);
  });
});

describe('the U1 token market', () => {
  test('carries price, market cap, FDV, supply and the lifetime figures', () => {
    const shaped = shapeToken(LIVE_TOKEN, READ_AT);
    expect(shaped.symbol).toBe('U1');
    expect(shaped.priceUsd).toBeCloseTo(0.06028118947080558, 12);
    expect(shaped.marketCapUsd).toBeCloseTo(250166.93630384316, 6);
    expect(shaped.fdvUsd).toBeCloseTo(301405.9473540279, 6);
    expect(shaped.change24hPct).toBeCloseTo(-0.1011728386389366, 12);
    expect(shaped.circulatingSupply).toBe(4150000);
    expect(shaped.lifetimeSwapCount).toBe(1639);
    // This endpoint publishes no asOf of its own, so the READ's moment is it.
    expect(shaped.asOf).toBe(READ_AT);
  });

  test('a healthy read carries no caveats', () => {
    expect(shapeToken(LIVE_TOKEN, READ_AT).caveats).toEqual([]);
  });

  test('isFresh:false is surfaced — a zero there may be a FAILED READ', () => {
    const stale = shapeToken({ ...LIVE_TOKEN, isFresh: false, volume24hUsd: 0 }, READ_AT);
    expect(stale.isFresh).toBe(false);
    expect(stale.caveats.join(' ')).toMatch(/NOT FRESH/);
    expect(stale.caveats.join(' ')).toMatch(/may be a failed read/i);
    // The zero is still reported — it is flagged, never quietly rewritten.
    expect(stale.volume24hUsd).toBe(0);
  });

  test('circulatingIsEstimated is surfaced — market cap is then OVERSTATED', () => {
    const est = shapeToken({ ...LIVE_TOKEN, circulatingIsEstimated: true }, READ_AT);
    expect(est.caveats.join(' ')).toMatch(/ESTIMATED/);
    expect(est.caveats.join(' ')).toMatch(/overstated/);
  });

  test('both doubts at once produce both sentences', () => {
    const both = shapeToken({ ...LIVE_TOKEN, isFresh: false, circulatingIsEstimated: true }, READ_AT);
    expect(both.caveats).toHaveLength(2);
  });
});

describe('the per-token pool figures', () => {
  const shaped = shapePools(LIVE_POOLS, READ_AT);

  test('STRING figures are coerced and folded across a token\'s pools', () => {
    const u1 = shaped.tokens.find((t) => t.token === 'U1');
    // '100.5' + '99.5' — string concatenation here would yield "100.599.5".
    expect(u1.tvlUsd).toBe(200);
    expect(u1.volume24hUsd).toBe(15);
    expect(u1.feesAllTimeUsd).toBe(1.5);
    expect(u1.tradeCount).toBe(5);
    expect(u1.poolCount).toBe(2);
  });

  test('price and market cap ride per token', () => {
    const virtual = shaped.tokens.find((t) => t.token === 'VIRTUAL');
    expect(virtual.priceUsd).toBeCloseTo(0.6912714386000579, 12);
    expect(virtual.marketCapUsd).toBeCloseTo(343558520.39137846, 4);
    expect(virtual.tokenAddress).toBe('0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b');
  });

  test('sorted by TVL — the platform\'s real weight reads first', () => {
    expect(shaped.tokens.map((t) => t.token)).toEqual(['VIRTUAL', 'U1']);
  });

  test('UI noise is dropped — icons and bin ids never reach a reasoning context', () => {
    const json = JSON.stringify(shaped);
    expect(json).not.toMatch(/IconUrl/);
    expect(json).not.toMatch(/bin_id/);
    expect(json).not.toMatch(/dexscreener/);
  });

  test('states that DAMM liquidity is not folded in, so the figure is not oversold', () => {
    expect(shaped.caveats.join(' ')).toMatch(/DLMM pool figures only/);
  });
});

describe('the registry is a closed set — the trading surface is not in it', () => {
  test('exactly three feeds, each a public GET path', () => {
    expect(FEED_NAMES).toEqual(['platform', 'token', 'pools']);
    for (const name of FEED_NAMES) expect(FEEDS[name].path).toMatch(/^\/api\//);
  });

  test('no acting route is reachable, by any spelling', () => {
    const paths = FEED_NAMES.map((n) => FEEDS[n].path).join(' ');
    for (const forbidden of ['positions', 'swap', 'build-transaction', 'send-transaction', 'pools/create', 'checkin']) {
      expect(paths).not.toContain(forbidden);
    }
  });

  test('no session-gated route is in the registry — this client carries no credential', () => {
    const paths = FEED_NAMES.map((n) => FEEDS[n].path);
    expect(paths).not.toContain('/api/token/pair-markets');
    expect(paths).not.toContain('/api/base/prices');
  });

  test('a name outside the registry resolves to nothing — a composed path dies here', () => {
    expect(feedByName('platform')).toBe(FEEDS.platform);
    expect(feedByName('positions')).toBe(null);
    expect(feedByName('../../etc/passwd')).toBe(null);
    expect(feedByName('constructor')).toBe(null);
    expect(feedByName('__proto__')).toBe(null);
    expect(feedByName(undefined)).toBe(null);
  });

  test('every feed can describe itself to a being', () => {
    expect(describeFeeds()).toHaveLength(3);
    expect(describeFeeds().join(' ')).toMatch(/market cap/);
  });
});

describe('the read client can only ever read the platform', () => {
  test('umbrae and loopback are permitted; nothing else is', () => {
    expect(permittedFeedUrl('https://umbrae.io/api/platform/stats')).toBe(true);
    expect(permittedFeedUrl('https://www.umbrae.io/api/base/damm/stats')).toBe(true);
    expect(permittedFeedUrl('http://127.0.0.1:5555/api/platform/stats')).toBe(true);
    expect(permittedFeedUrl('https://evil.example/api/platform/stats')).toBe(false);
    expect(permittedFeedUrl('https://umbrae.io.evil.example/x')).toBe(false);
    expect(permittedFeedUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(permittedFeedUrl('file:///etc/passwd')).toBe(false);
    expect(permittedFeedUrl('not a url')).toBe(false);
    // Plain http is loopback-only — the real feeds are https.
    expect(permittedFeedUrl('http://umbrae.io/api/platform/stats')).toBe(false);
  });

  test('a hostile origin is refused BEFORE any request is made', async () => {
    const prior = process.env.NEUMA_PLATFORM_API_ORIGIN;
    process.env.NEUMA_PLATFORM_API_ORIGIN = 'https://evil.example';
    const out = await readPlatformFeed('/api/platform/stats', { timeoutMs: 2000 });
    if (prior === undefined) delete process.env.NEUMA_PLATFORM_API_ORIGIN;
    else process.env.NEUMA_PLATFORM_API_ORIGIN = prior;
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/refusing to read/);
  });
});

describe('the read and the tool — against a real server, not a stub', () => {
  let server; let prior; let mode = 'ok'; let requests = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests += 1;
      if (mode === 'down') { res.writeHead(503); return res.end('{}'); }
      const body = req.url.startsWith('/api/platform/stats') ? LIVE_PLATFORM
        : req.url.startsWith('/api/base/damm/stats') ? LIVE_TOKEN
          : req.url.startsWith('/api/base/dlmm/pools') ? LIVE_POOLS
            : null;
      if (!body) { res.writeHead(404); return res.end('{}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(body));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    prior = process.env.NEUMA_PLATFORM_API_ORIGIN;
    process.env.NEUMA_PLATFORM_API_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (prior === undefined) delete process.env.NEUMA_PLATFORM_API_ORIGIN;
    else process.env.NEUMA_PLATFORM_API_ORIGIN = prior;
    await new Promise((r) => server.close(r));
  });

  const connection = { companion: { neumaId: 'test-being', name: 'Test' } };
  const call = (args, gate = {}) => {
    const events = [];
    const ports = { sendToolEvent: (_ws, _c, e) => events.push(e), ...gate };
    return handlePlatformFeedTool(null, connection, { tool: 'platform/platform_data' }, args, ports)
      .then((result) => ({ result, events }));
  };

  // Audit C3 (2026-10-19): the read never crossed the ACTS gate, so observe
  // mode and a lane's deny row were ignored and the request left anyway.
  test('observe mode holds the read: denied, and no request leaves', async () => {
    const before = requests;
    const { result, events } = await call({}, { mode: 'observe' });
    expect(result).toMatchObject({ tool: 'platform/platform_data', status: 'denied' });
    expect(events[0].status).toBe('denied');
    expect(requests).toBe(before);
  });

  test('a lane deny row refuses the read before any request leaves', async () => {
    const before = requests;
    const lanePolicy = { platform: { allowed: [], denied: ['platform_data'], requireApproval: [] } };
    const { result } = await call({ feed: 'token' }, { mode: 'ask', lanePolicy });
    expect(result).toMatchObject({ tool: 'platform/platform_data', status: 'denied' });
    expect(requests).toBe(before);
  });

  test('ask mode with the default policy still reads', async () => {
    const before = requests;
    const { result } = await call({ feed: 'token' }, { mode: 'ask', lanePolicy: null });
    expect(result.status).toBe('ok');
    expect(requests).toBe(before + 1);
  });

  test('a live read returns the real shape', async () => {
    const out = await readPlatformFeed('/api/platform/stats');
    expect(out.ok).toBe(true);
    expect(out.payload.tvlUsd).toBeCloseTo(210447.2187587649, 6);
    expect(out.readAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('no arguments reads every feed in one call', async () => {
    const { result, events } = await call({});
    expect(result.status).toBe('ok');
    const content = JSON.parse(result.content);
    expect(Object.keys(content)).toEqual(['platform', 'token', 'pools']);
    expect(content.token.priceUsd).toBeCloseTo(0.06028118947080558, 12);
    expect(content.platform.tvlUsd).toBeCloseTo(210447.2187587649, 6);
    expect(content.pools.tokenCount).toBe(2);
    expect(events[0].status).toBe('ok');
  });

  test('one named feed narrows to that feed alone', async () => {
    const { result } = await call({ feed: 'token' });
    const content = JSON.parse(result.content);
    expect(content.feed).toBe('token');
    expect(content.symbol).toBe('U1');
    expect(content.platform).toBeUndefined();
  });

  test('an unknown feed is refused by name, and says what IS carried', async () => {
    const { result } = await call({ feed: 'positions' });
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/no such feed "positions"/);
    expect(result.error).toMatch(/platform, token, pools/);
  });

  test('an unreachable platform is UNAVAILABLE, not an error the being got wrong', async () => {
    mode = 'down';
    const { result, events } = await call({ feed: 'platform' });
    mode = 'ok';
    expect(result.status).toBe('unavailable');
    expect(result.error).toMatch(/HTTP 503/);
    expect(events[0].status).toBe('unavailable');
  });

  test('a PARTIAL read still hands over the feeds that answered', async () => {
    // The pools path 404s here while the other two answer — a real partial.
    const priorOrigin = process.env.NEUMA_PLATFORM_API_ORIGIN;
    const partial = http.createServer((req, res) => {
      if (req.url.startsWith('/api/base/dlmm/pools')) { res.writeHead(503); return res.end('{}'); }
      const body = req.url.startsWith('/api/platform/stats') ? LIVE_PLATFORM : LIVE_TOKEN;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(body));
    });
    await new Promise((r) => partial.listen(0, '127.0.0.1', r));
    process.env.NEUMA_PLATFORM_API_ORIGIN = `http://127.0.0.1:${partial.address().port}`;
    const { result, events } = await call({});
    process.env.NEUMA_PLATFORM_API_ORIGIN = priorOrigin;
    await new Promise((r) => partial.close(r));

    expect(result.status).toBe('ok');
    const content = JSON.parse(result.content);
    expect(content.platform.tvlUsd).toBeCloseTo(210447.2187587649, 6);
    // The hole names itself rather than vanishing.
    expect(content.pools.error).toMatch(/HTTP 503/);
    expect(events[0].summary).toMatch(/2\/3 feeds read/);
  });
});

describe('the advertised surface', () => {
  test('one tool, on the platform server, with a closed feed enum', () => {
    expect(PLATFORM_FEED_TOOLS).toHaveLength(1);
    const [tool] = PLATFORM_FEED_TOOLS;
    expect(tool.name).toBe('platform_data');
    expect(tool.server).toBe('platform');
    expect(tool.inputSchema.properties.feed.enum).toEqual(['platform', 'token', 'pools']);
    expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  test('the description tells a being to read the caveats before quoting', () => {
    expect(PLATFORM_FEED_TOOLS[0].description).toMatch(/caveats/);
    expect(PLATFORM_FEED_TOOLS[0].description).toMatch(/absent is UNKNOWN, never zero/i);
  });

  test('every bound seat gets it — neuma and sealed witness alike', () => {
    expect(platformFeedToolsFor({ companion: { neumaId: 'keir' } })).toHaveLength(1);
    expect(platformFeedToolsFor({ companion: { laneId: 'witness-claude-Claude' } })).toHaveLength(1);
    // No companion is no seat.
    expect(platformFeedToolsFor({})).toHaveLength(0);
    expect(platformFeedToolsFor(null)).toHaveLength(0);
  });

  test('the call is recognised in every dialect the dispatcher sees', () => {
    expect(isPlatformFeedTool({ toolName: 'platform_data' })).toBe(true);
    expect(isPlatformFeedTool({ toolName: 'platform__platform_data' })).toBe(true);
    expect(isPlatformFeedTool({ tool: 'platform/platform_data' })).toBe(true);
    expect(isPlatformFeedTool({ toolName: 'get_telemetry' })).toBe(false);
    expect(isPlatformFeedTool({})).toBe(false);
  });
});
