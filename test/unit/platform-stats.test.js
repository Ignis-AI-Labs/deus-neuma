/**
 * THE PLATFORM STATS FEED — real numbers, or an honest refusal.
 *
 * RULE 0 holds. The payload below is not a fixture someone invented: it is the
 * REAL response recorded from https://umbrae.io/api/platform/stats on
 * 2026-08-29, kept verbatim so the pure mapping is tested against the shape the
 * platform actually publishes. The fetch itself is proven against a REAL
 * loopback HTTP server — including the 307 the live host answers with.
 *
 * The laws this file exists to keep are all about not lying on a public post:
 * 1. The source's own approximation flag reaches the pixel. `dlmmVolumeApproximate`
 *    is TRUE today, so all-time figures wear a `~` — the platform's standing
 *    mark for an estimate.
 * 2. "Earned" is not "claimed". lpEarningsUsd is what ACCRUED to liquidity
 *    providers; nothing here may call it claimed.
 * 3. An absent figure is UNKNOWN, never zero. A marketing card that invents a
 *    number is the worst failure this system can have.
 * 4. Whatever the feed produces must FIT the card frame it is going into.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import {
  money, count, asOfIso, asOfLabel, statFact, milestoneFrom, FACT_NAMES, fetchPlatformStats, statsUrl,
  permittedStatsUrl,
} from '../../backend/services/branding/platform-stats.js';
import { loadTemplate } from '../../backend/services/branding/brand-tokens.js';
import { fieldRefusals } from '../../backend/services/branding/card-svg.js';

// Recorded live, 2026-08-29. Note what it does NOT have: no `lock` block (the
// route on disk returns one; production had not shipped it yet) and no
// `schemaVersion`. Both absences are load-bearing tests below.
const LIVE = Object.freeze({
  volumeAllTimeUsd: 581703.4782901854,
  volume24hUsd: 9629.99402834461,
  feesAllTimeUsd: 6353.769936359354,
  protocolRevenueUsd: 317.6884968179677,
  lpEarningsUsd: 6036.081439541386,
  protocolTakeRate: 0.05,
  protocolSplitExact: true,
  tvlUsd: 172249.67836724588,
  tradeCount: 2025,
  damm: { volumeAllTimeUsd: 540939.3041507066, tvlUsd: 94100.17564862737, tradeCount: 1637 },
  dlmm: { volumeAllTimeUsd: 40764.174139478826, tvlUsd: 10212.310208031085, tradeCount: 388 },
  dlmmVolumeApproximate: true,
  asOf: 1787940328544,
});

describe('the figures, formatted for a frame', () => {
  test('money is compact enough to headline, at every magnitude', () => {
    expect(money(172249.67836724588)).toBe('$172.2K');
    expect(money(581703.47)).toBe('$581.7K');
    expect(money(1_400_000)).toBe('$1.4M');
    expect(money(2_100_000_000)).toBe('$2.1B');
    expect(money(842)).toBe('$842');
    expect(money(0)).toBe('$0');
    expect(money(-1500)).toBe('-$1.5K');
    expect(money('nonsense')).toBeNull();
    expect(money(undefined)).toBeNull();
  });

  test('counts read the way a person writes them', () => {
    expect(count(2025)).toBe('2,025');
    expect(count(0)).toBe('0');
    expect(count(null)).toBeNull();
  });

  test('asOf arrives as epoch MILLISECONDS and must never be drawn raw', () => {
    // A card that printed 1787940328544 would look like a bug on a public post.
    expect(asOfIso(LIVE)).toBe('2026-08-28T18:05:28Z');
    expect(asOfIso({ asOf: '2026-08-28T18:07:26Z' })).toBe('2026-08-28T18:07:26Z');
    expect(asOfIso({ asOf: 'sometime' })).toBeNull();
    expect(asOfIso({})).toBeNull();
  });
});

describe('the honesty rules', () => {
  test('the SOURCE\'s approximation flag reaches the number itself', () => {
    // dlmmVolumeApproximate is true in the live payload: DLMM all-time USD is
    // priced at CURRENT token prices because the subgraph stores no historical
    // USD. The platform says so; the card must too.
    const vol = statFact(LIVE, 'volumeAllTime');
    expect(vol.ok).toBe(true);
    expect(vol.approximate).toBe(true);
    expect(vol.value).toBe('~$581.7K');

    // ...and an exact figure is NOT marked, or the mark would mean nothing.
    const tvl = statFact(LIVE, 'tvl');
    expect(tvl.approximate).toBe(false);
    expect(tvl.value).toBe('$172.2K');
  });

  test('when the source stops calling it approximate, so do we', () => {
    const exact = statFact({ ...LIVE, dlmmVolumeApproximate: false }, 'volumeAllTime');
    expect(exact.value).toBe('$581.7K');
    expect(exact.approximate).toBe(false);
  });

  test('LP earnings are EARNED, never "claimed" — they are different sentences', () => {
    const fact = statFact(LIVE, 'lpEarnings');
    expect(fact.ok).toBe(true);
    expect(fact.label).toContain('earned by liquidity providers');
    expect(fact.label).not.toContain('claim');
    expect(fact.eyebrow).not.toContain('CLAIM');
  });

  test('a figure the feed did not carry is UNKNOWN — not zero, not "coming soon"', () => {
    // Production had no `lock` block when this payload was recorded.
    const out = statFact(LIVE, 'lockedTvl');
    expect(out.ok).toBe(false);
    expect(out.error).toContain('it is not zero, it is unknown');
    // ...and when production does ship it, the same fact just works.
    expect(statFact({ ...LIVE, lock: { tvlUsd: 40000 } }, 'lockedTvl').value).toBe('$40.0K');
  });

  test('a stat nobody publishes refuses and NAMES what the feed does carry', () => {
    const out = statFact(LIVE, 'users');
    expect(out.ok).toBe(false);
    expect(out.error).toContain('no such platform stat "users"');
    expect(out.error).toContain('tvl');
  });

  test('a card with no readable moment is refused outright', () => {
    const { asOf, ...noMoment } = LIVE;
    const out = statFact(noMoment, 'tvl');
    expect(out.ok).toBe(false);
    expect(out.error).toContain('a stat card without its moment is a claim, not a fact');
  });

  test('the moment reaches a card as a STAMP a reader reads, never as a log line', () => {
    // Design note, 2026-09-01, on a queued card that did not match the review sheet:
    // […]
    //
    // It did not match because the moment was formatted in TWO places and only
    // one of them was pretty: `brand-review-sheet.mjs` ran its own toUTCString
    // dance, while `statFact` handed the card the raw ISO. So the sheet showed
    // […] and the card Metidar queued printed
    // "2026-08-31T17:19:02Z". The reference was not showing what shipped.
    expect(statFact(LIVE, 'tvl').asOf).toBe('28 Aug 2026 18:05:28 UTC');
    expect(asOfLabel(LIVE)).toBe('28 Aug 2026 18:05:28 UTC');
    expect(statFact(LIVE, 'tvl').asOf).not.toMatch(/T\d{2}:\d{2}:\d{2}Z/);
    // The ISO form is still available — it is simply not what a card draws.
    expect(asOfIso(LIVE)).toBe('2026-08-28T18:05:28Z');
    expect(asOfLabel({ asOf: 'sometime' })).toBeNull();
  });

  test('the stamp is ALWAYS exactly 24 characters, which is why the field allows 24', () => {
    // `toUTCString` pads the day, so a 1st-of-month stamp is the same width as
    // a 31st. That is the whole reason `asOf.max` is 24 and not 23 — the fit is
    // exact, so a stamp can never be the field that overflows a card.
    for (const at of [
      '2026-01-01T00:00:00Z', '2026-09-01T05:36:12Z',
      '2026-08-31T17:19:02Z', '2026-12-25T23:59:59Z',
    ]) {
      const drawn = asOfLabel({ asOf: at });
      expect(drawn, `${at} drew "${drawn}"`).toHaveLength(24);
      expect(drawn).toMatch(/^\d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} UTC$/);
    }
  });
});

describe('what the feed produces FITS the card it is going into', () => {
  test('every publishable fact satisfies the milestone template\'s own limits', async () => {
    const t = await loadTemplate('milestone');
    const publishable = FACT_NAMES.filter((n) => statFact(LIVE, n).ok);
    expect(publishable.length).toBeGreaterThanOrEqual(6);
    for (const name of publishable) {
      const built = milestoneFrom(LIVE, name);
      expect(built.ok, name).toBe(true);
      // The template's own declaration is the judge — no separate list of
      // limits to drift out of step with it.
      expect(fieldRefusals(t.spec, built.data), `${name} does not fit the milestone frame`).toEqual([]);
    }
  });

  test('a headline figure stays short even at billions', async () => {
    const t = await loadTemplate('milestone');
    const huge = milestoneFrom({ ...LIVE, tvlUsd: 2_100_000_000 }, 'tvl');
    expect(huge.data.value).toBe('$2.1B');
    expect(fieldRefusals(t.spec, huge.data)).toEqual([]);
  });
});

describe('the read itself — against a real server, not a stub', () => {
  let server; let base; let mode = 'ok';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (mode === 'redirect' && req.url === '/api/platform/stats') {
        // Exactly what the live host does: umbrae.io 307s to www.umbrae.io.
        res.writeHead(307, { Location: '/www/api/platform/stats' });
        return res.end();
      }
      if (mode === 'down') { res.writeHead(503); return res.end('{}'); }
      if (mode === 'reported') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Failed to compute platform stats' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(LIVE));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    process.env.NEUMA_PLATFORM_STATS_URL = `${base}/api/platform/stats`;
  });

  afterAll(async () => {
    delete process.env.NEUMA_PLATFORM_STATS_URL;
    await new Promise((r) => server.close(r));
  });

  test('a live read returns the real shape', async () => {
    const out = await fetchPlatformStats();
    expect(out.ok).toBe(true);
    expect(out.payload.tvlUsd).toBeCloseTo(LIVE.tvlUsd, 6);
    expect(statFact(out.payload, 'tvl').value).toBe('$172.2K');
  });

  test('THE REDIRECT IS FOLLOWED — the live host answers 307 and a body-only read gets nothing', async () => {
    mode = 'redirect';
    const out = await fetchPlatformStats();
    mode = 'ok';
    // The redirect target serves the same payload; following it is the point.
    expect(out.ok).toBe(true);
    expect(out.payload.tradeCount).toBe(2025);
  });

  test('an unhealthy feed gives a reason a being can say out loud', async () => {
    mode = 'down';
    const down = await fetchPlatformStats();
    mode = 'reported';
    const reported = await fetchPlatformStats();
    mode = 'ok';
    expect(down.ok).toBe(false);
    expect(down.error).toContain('HTTP 503');
    expect(reported.ok).toBe(false);
    expect(reported.error).toContain('Failed to compute platform stats');
  });

  test('an unreachable feed never throws — the lane gets an outcome', async () => {
    process.env.NEUMA_PLATFORM_STATS_URL = 'http://127.0.0.1:9/api/platform/stats';
    const out = await fetchPlatformStats({ timeoutMs: 3000 });
    process.env.NEUMA_PLATFORM_STATS_URL = `${base}/api/platform/stats`;
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unreachable|cut short/);
  });
});

/**
 * THE LINE FOUNDER DREW (2026-08-29): […]
 *
 * This client cannot act on the platform — it is a GET with no body — but a
 * being can TRIGGER it (render_card {stat}), so the target is pinned. A read
 * client that could be pointed anywhere is a request-forgery primitive with a
 * friendly name.
 */
describe('the read client can only ever read the stats feed', () => {
  test('the platform aggregate and loopback are permitted; nothing else is', () => {
    expect(permittedStatsUrl('https://umbrae.io/api/platform/stats')).toBe(true);
    expect(permittedStatsUrl('https://www.umbrae.io/api/platform/stats')).toBe(true);
    expect(permittedStatsUrl('http://127.0.0.1:5555/api/platform/stats')).toBe(true);
    // Another host, a look-alike host, a non-http scheme, and the internal
    // metadata address every cloud runs — all refused.
    expect(permittedStatsUrl('https://evil.example/api/platform/stats')).toBe(false);
    expect(permittedStatsUrl('https://umbrae.io.evil.example/x')).toBe(false);
    expect(permittedStatsUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(permittedStatsUrl('file:///etc/passwd')).toBe(false);
    expect(permittedStatsUrl('not a url')).toBe(false);
    // Plain http is loopback-only — the real feed is https.
    expect(permittedStatsUrl('http://umbrae.io/api/platform/stats')).toBe(false);
  });

  test('a redirected env door is refused BEFORE any request is made', async () => {
    const prior = process.env.NEUMA_PLATFORM_STATS_URL;
    process.env.NEUMA_PLATFORM_STATS_URL = 'https://evil.example/api/platform/stats';
    const out = await fetchPlatformStats({ timeoutMs: 2000 });
    if (prior === undefined) delete process.env.NEUMA_PLATFORM_STATS_URL;
    else process.env.NEUMA_PLATFORM_STATS_URL = prior;
    expect(out.ok).toBe(false);
    expect(out.error).toContain('refusing to read platform stats from');
  });
});

describe('the exported surface', () => {
  test('the url is an env DOOR read per call, not a value frozen at import', () => {
    expect(typeof fetchPlatformStats).toBe('function');
    expect(statsUrl()).toContain('/api/platform/stats');
    // Every other export is pure and answers without IO.
    expect(statFact(LIVE, 'trades').value).toBe('2,025');
  });
});
