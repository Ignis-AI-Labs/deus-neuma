/**
 * THE OPERATOR'S ZONE — every clock a being reads renders on the operator's
 * wall, not the machine's.
 *
 * 2026-09-25 (Founder): the conversation clock and PRESENT MOMENT rendered
 * server-local, so a desk in any other zone watched its being speak a clock
 * that was not theirs. The desk sends its IANA zone on the portal navigation
 * frames; the server validates at the boundary (fail-closed: an absent or
 * garbage zone is the machine's own zone, exactly as before) and every
 * time-reading section renders in it.
 *
 * Pure.
 */

/**
 * Is `zone` a real IANA time zone this runtime can render in? Pure.
 * @param {*} zone
 * @returns {boolean}
 */
export const isValidTimeZone = (zone) => {
  if (typeof zone !== 'string' || zone.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/**
 * Minutes east of UTC for `zone` at `date` (DST-honest — the offset is a
 * property of the instant, not the zone). Pure.
 * @param {string} zone - a zone isValidTimeZone accepted
 * @param {Date} date
 * @returns {number}
 */
export const zoneOffsetMinutes = (zone, date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  // hour12:false can name midnight "24" — Date.UTC rolls the overflow into
  // the next day, which is exactly the instant being described.
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
};

/**
 * The `UTC±hh:mm` label for the MACHINE's own zone at `date` — the wording
 * PRESENT MOMENT has always printed when no operator zone was named. Pure.
 * @param {Date} date
 * @returns {string}
 */
export const localOffsetLabel = (date) => {
  const mins = -date.getTimezoneOffset();
  const sign = mins < 0 ? '-' : '+';
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `UTC${sign}${pad(mins / 60)}:${pad(mins % 60)}`;
};

/**
 * The `UTC±hh:mm` label PRESENT MOMENT carries — the same wording the
 * server-zone path has always printed. Pure.
 * @param {string} zone
 * @param {Date} date
 * @returns {string}
 */
export const zoneOffsetLabel = (zone, date) => {
  const mins = zoneOffsetMinutes(zone, date);
  const sign = mins < 0 ? '-' : '+';
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `UTC${sign}${pad(mins / 60)}:${pad(mins % 60)}`;
};
