// stats-schedule — WHEN the stats sweep reads a sent post, and how it keeps
// to each platform's terms (campaign plan §4.3, slice 9). Pure.
//
// A decaying schedule: a post under 3 days old is read every 6 hours, under
// 30 days daily, under 90 days weekly, then never again — fresh posts often,
// old posts rarely. A platform that says "slow down" (429, Retry-After) is
// left alone for exactly as long as it asked; a project quota every channel
// shares (YouTube's, 10,000 units a day) is budgeted with uploads first.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How often a post this old is read, or null when it is no longer read. */
export const pullIntervalMs = (ageMs) => {
  if (!(ageMs >= 0)) return null;
  if (ageMs < 3 * DAY) return 6 * HOUR;
  if (ageMs < 30 * DAY) return DAY;
  if (ageMs < 90 * DAY) return 7 * DAY;
  return null;
};

/**
 * The sent posts due a read now, the most overdue first: posts with a
 * platform id whose last read is older than their interval.
 * @param {ReadonlyArray<object>} entries - the house's queue
 * @param {Record<string, string>} pulls - entryId → ISO of its last read
 * @param {number} now - epoch ms
 */
export const duePosts = (entries, pulls, now) => (entries || [])
  .filter((e) => e.status === 'sent' && e.postId && !Number.isNaN(Date.parse(e.sentAt)))
  .map((e) => {
    const interval = pullIntervalMs(now - Date.parse(e.sentAt));
    const last = Date.parse(pulls?.[e.id] || '') || 0;
    return { entry: e, interval, overdue: now - last - (interval ?? Infinity) };
  })
  .filter((d) => d.interval !== null && d.overdue >= 0)
  .sort((a, b) => b.overdue - a.overdue)
  .map((d) => d.entry);

const DEFAULT_BACKOFF_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = DAY;

/**
 * How long a "slow down" asks to be left alone: Retry-After as seconds or an
 * HTTP date; X's x-rate-limit-reset as epoch seconds; else 15 minutes.
 * Capped at a day.
 * @param {{retryAfter?: ?string, resetAt?: ?string}} headers
 * @param {number} now
 */
export const backoffMs = ({ retryAfter, resetAt } = {}, now) => {
  const fromRetry = /^\d+$/.test(String(retryAfter ?? '').trim())
    ? Number(retryAfter) * 1000
    : (retryAfter ? Date.parse(retryAfter) - now : NaN);
  const fromReset = /^\d+$/.test(String(resetAt ?? '')) ? Number(resetAt) * 1000 - now : NaN;
  const ms = [fromRetry, fromReset].find((v) => Number.isFinite(v) && v > 0) ?? DEFAULT_BACKOFF_MS;
  return Math.min(ms, MAX_BACKOFF_MS);
};

/** Is a backoff still standing? */
export const backingOff = (backoff, key, now) => Boolean(backoff?.[key]) && Date.parse(backoff[key].until) > now;

/** The day a YouTube project quota counts in (it resets at midnight Pacific time, read here as 08:00 UTC). */
export const quotaDay = (now) => new Date(now - 8 * HOUR).toISOString().slice(0, 10);

/** How long until the YouTube project's quota resets (the next 08:00 UTC). */
export const untilQuotaResetMs = (now) => {
  const reset = new Date(now);
  reset.setUTCHours(8, 0, 0, 0);
  if (reset.getTime() <= now) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset.getTime() - now;
};

export const YOUTUBE_DAILY_UNITS = 10000;
export const YOUTUBE_UPLOAD_UNITS = 100;
export const YOUTUBE_STATS_UNITS = 1; // videos.list, up to 50 ids

/**
 * May the sweep spend `units` of the YouTube project's day? Uploads come
 * first: every YouTube post approved to go out within a day is held back
 * from the budget, then what this house's sweep already spent today.
 * @param {{day: string, units: number}|undefined} spent - this house's sweep spend
 * @param {number} uploadsAhead - YouTube posts approved for the coming day
 * @param {number} units
 * @param {number} now
 */
export const youtubeBudgetAllows = (spent, uploadsAhead, units, now) => {
  const today = quotaDay(now);
  const used = spent?.day === today ? spent.units : 0;
  return used + units <= YOUTUBE_DAILY_UNITS - uploadsAhead * YOUTUBE_UPLOAD_UNITS;
};
