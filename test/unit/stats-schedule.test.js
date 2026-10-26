/**
 * The stats sweep's pure law — the decaying schedule, the slow-down reading,
 * the shared YouTube budget, and each platform's answer read into one shape
 * (stats-schedule.js, stats-metrics.js). Real inputs, real outputs.
 */
import { describe, it, expect } from 'vitest';
import { pullIntervalMs, duePosts, backoffMs, youtubeBudgetAllows, untilQuotaResetMs } from '../../backend/services/social/stats/stats-schedule.js';
import { fromX, fromYouTube, fromTikTok, CAPABILITY } from '../../backend/services/social/stats/stats-metrics.js';
import { sweepStaysDown } from '../../backend/services/social/stats/stats-sweep.js';

const H = 3600e3;
const NOW = Date.parse('2026-10-24T12:00:00Z');

describe('the decaying schedule', () => {
  it('every 6 hours under 3 days, daily under 30, weekly under 90, then never', () => {
    expect(pullIntervalMs(1 * H)).toBe(6 * H);
    expect(pullIntervalMs(4 * 24 * H)).toBe(24 * H);
    expect(pullIntervalMs(40 * 24 * H)).toBe(7 * 24 * H);
    expect(pullIntervalMs(91 * 24 * H)).toBeNull();
  });

  it('only sent posts with a platform id, due by their own interval, most overdue first', () => {
    const sent = (id, hoursAgo) => ({ id, status: 'sent', postId: `p-${id}`, sentAt: new Date(NOW - hoursAgo * H).toISOString() });
    const entries = [sent('a', 2), sent('b', 100), { ...sent('c', 2), status: 'approved' }, { ...sent('d', 2), postId: null }, sent('e', 24 * 100)];
    expect(duePosts(entries, {}, NOW).map((e) => e.id)).toEqual(['a', 'b']);
    expect(duePosts(entries, { a: new Date(NOW - 1 * H).toISOString() }, NOW).map((e) => e.id)).toEqual(['b']);
  });
});

describe('slowing down', () => {
  it('Retry-After as seconds or a date; X\'s reset as epoch seconds; else 15 minutes; never past a day', () => {
    expect(backoffMs({ retryAfter: '120' }, NOW)).toBe(120000);
    expect(backoffMs({ retryAfter: new Date(NOW + 300000).toUTCString() }, NOW)).toBe(300000);
    expect(backoffMs({ resetAt: String((NOW + 600000) / 1000) }, NOW)).toBe(600000);
    expect(backoffMs({}, NOW)).toBe(15 * 60000);
    expect(backoffMs({ retryAfter: String(9 * 24 * 3600) }, NOW)).toBe(24 * H);
  });

  it('YouTube\'s shared day: uploads come first; the quota resets at 08:00 UTC', () => {
    expect(youtubeBudgetAllows(undefined, 0, 1, NOW)).toBe(true);
    expect(youtubeBudgetAllows({ day: '2026-10-24', units: 9900 }, 1, 1, NOW)).toBe(false); // 100 held for the upload
    expect(youtubeBudgetAllows({ day: '2026-10-23', units: 9999 }, 0, 1, NOW)).toBe(true); // yesterday's spend does not count
    expect(untilQuotaResetMs(NOW)).toBe(20 * H);
  });
});

describe('one shape for every platform\'s answer', () => {
  it('a metric the platform does not report is absent — never 0', () => {
    expect(fromX({ public_metrics: { impression_count: 10, like_count: 0 } })).toEqual({ views: 10, likes: 0 });
    expect(fromYouTube({ statistics: { viewCount: '50', commentCount: '0' } })).toEqual({ views: 50, replies: 0 });
    expect(fromTikTok({ view_count: 5 })).toEqual({ views: 5 });
    expect(CAPABILITY.linkedin).toMatchObject({ reads: false, reports: [] });
    expect(CAPABILITY.mastodon.reports).not.toContain('views');
  });
});

describe('where the sweep stands', () => {
  it('on the operator\'s own backend; never in an agent\'s pipeline lane unless asked; off with NEUMA_STATS_SWEEP=0', () => {
    expect(sweepStaysDown({})).toBeNull();
    expect(sweepStaysDown({ NEUMA_STATS_SWEEP: '0' })).toBe('NEUMA_STATS_SWEEP=0');
    expect(sweepStaysDown({ NEUMA_PIPELINE_ID: 'claude:42:0' })).toMatch(/agent pipeline lane/);
    expect(sweepStaysDown({ NEUMA_PIPELINE_ID: 'claude:42:0', NEUMA_STATS_SWEEP: '1' })).toBeNull();
  });
});
