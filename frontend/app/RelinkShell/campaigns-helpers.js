// campaigns-helpers.js — pure display logic for the campaigns board. IO lives
// in campaigns-client.js / social-channels-client.js; everything here is
// defined inputs → defined output, so the grouping can be proven in isolation.
// The board's ordering law lives in queue-board.js and the calendar half in
// queue-calendar.js; both are re-exported here so every reader — and the
// path-pinned test — keeps its one import site.

export {
  groupQueueByDay, queueDayKey, queueById, filterQueueToDay, shiftDayKey,
  buildMonthGrid,
} from './queue-calendar.js';
export {
  isSettled, orderQueueForBoard, QUEUE_SECTIONS, sectionOf, QUEUE_LANES,
  laneOf, splitQueueIntoSections, AWAITING_LABEL, splitLaneIntoGroups,
  replyDispositionLabel, replyNeedsAttention,
} from './queue-board.js';

/**
 * Parse a comma-separated pillars input into the string[] the ledger keeps.
 * @param {string} raw
 * @returns {string[]}
 */
// pure
export const parsePillars = (raw) =>
  raw.split(',').map((p) => p.trim()).filter(Boolean);

/**
 * The X permalink for a post id — the handle-free /i/status/ form, which
 * resolves for any account, so a reply card can link the exact post being
 * answered without knowing its author's handle. Null when there is no id.
 * @param {string} postId an X post id (queue `reply.toPostId`, candidate `postId`)
 * @returns {string|null}
 */
// pure
export const xPostUrl = (postId) => {
  const id = String(postId || '').trim();
  // Encoded: an id is opaque data — a crafted value must not steer the path.
  return id ? `https://x.com/i/status/${encodeURIComponent(id)}` : null;
};

// pure — the candidate's one meta line: when the knock came, in the same
// data register as the queue's own labels.
export const replyWhenLabel = (c, now = Date.now()) => {
  const t = Date.parse(c?.postCreatedAt || c?.firstSeenAt || '');
  if (Number.isNaN(t)) return '';
  return `REPLIED ${relWhen(now - t)} AGO · ${absWhen(new Date(t), now)}`;
};

// THE ENTRY META LINE — one compact data-register line per entry, instead of
// prose sentences with raw locale datetimes (Design note, 2026-07-27: the board is a
// daily instrument — […]). Pure, so the
// whole truth table is unit-tested.

const DAYS = Object.freeze(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
const MONTHS = Object.freeze(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']);

const pad2 = (n) => String(n).padStart(2, '0');

// pure — compact absolute time, 12-HOUR (Design note, 2026-07-27: […]): within the
// week → 'TUE 9:12 PM', further out → 'JUL 27 · 9:30 AM'. Noon and midnight
// stay honest ('12:00 PM' / '12:05 AM').
const absWhen = (date, now) => {
  const h = date.getHours();
  const hhmm = `${h % 12 === 0 ? 12 : h % 12}:${pad2(date.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
  return Math.abs(now - date.getTime()) < 7 * 864e5
    ? `${DAYS[date.getDay()]} ${hhmm}`
    : `${MONTHS[date.getMonth()]} ${date.getDate()} · ${hhmm}`;
};

// pure — compact relative distance: '45M', '3H 12M', '2D 3H'. NOW under a
// minute — a scheduled slot firing reads live, never '0M'.
const relWhen = (ms) => {
  const mins = Math.round(Math.abs(ms) / 60000);
  if (mins < 1) return 'NOW';
  if (mins < 60) return `${mins}M`;
  const h = Math.floor(mins / 60);
  if (h < 48) return mins % 60 ? `${h}H ${mins % 60}M` : `${h}H`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}D ${h % 24}H` : `${d}D`;
};

/**
 * The entry's one meta line — when it happens or when it happened, in the
 * data register. A scheduled draft that missed its slot reads OVERDUE, not
 * silently stale; settled standings read their moment from the record's own
 * timestamps, falling back honestly when one is absent.
 * @param {object} entry queue entry (status, createdAt, scheduledFor, decidedAt, sentAt)
 * @param {number} [now=Date.now()] injectable for tests
 * @returns {string}
 */
// pure
export const queueWhenLabel = (entry, now = Date.now()) => {
  const at = (iso) => {
    const t = Date.parse(iso || '');
    return Number.isNaN(t) ? null : new Date(t);
  };
  const scheduled = at(entry?.scheduledFor);
  // THE REPLY'S CLOCK IS NOT A SLOT (Design note, 2026-08-06: an answer rides no
  // calendar — approval itself sends it — so its live standings speak the
  // approval law and the TTL, never the scheduler's vocabulary. Settled
  // standings (sending/sent/failed/…) read their moment like any entry.
  if (entry?.kind === 'reply') {
    if (entry?.status === 'draft') {
      const stagedAt = at(entry?.createdAt);
      const expiry = at(entry?.expiresAt);
      const staged = stagedAt ? `STAGED ${relWhen(now - stagedAt.getTime())} AGO · ` : '';
      const exp = expiry
        ? (expiry.getTime() > now
          ? ` · EXPIRES IN ${relWhen(expiry.getTime() - now)}`
          : ' · EXPIRED — WITHDRAWS UNANSWERED')
        : '';
      return `${staged}SENDS THE MOMENT YOU APPROVE${exp}`;
    }
    if (entry?.status === 'approved') {
      // A pre-law slot: armed before approve-and-send existed. It will never
      // send — the expiry sweep withdraws it — and the card says so.
      return 'LEGACY SLOT — ARMED BEFORE APPROVE-AND-SEND · EXPIRES UNANSWERED';
    }
  }
  switch (entry?.status) {
    case 'draft':
      if (scheduled) {
        const ms = scheduled.getTime() - now;
        return ms > 0
          ? `GOES OUT IN ${relWhen(ms)} · ${absWhen(scheduled, now)}`
          : `OVERDUE ${relWhen(ms)} · WAS ${absWhen(scheduled, now)}`;
      }
      return at(entry?.createdAt)
        ? `STAGED ${relWhen(now - at(entry.createdAt).getTime())} AGO · UNSCHEDULED`
        : 'UNSCHEDULED';
    case 'approved': {
      // THE SCHEDULE LOCK rides the card (Design note, 2026-07-28: […]) — the approval's timestamp AND the lock
      // id itself, citeable, so approval reads as a confirmation, not a hope.
      const lock = at(entry?.decidedAt);
      const lockLabel = lock
        ? ` · LOCKED ${absWhen(lock, now)}${entry?.id ? ` · ID ${entry.id}` : ''}`
        : '';
      if (!scheduled) return `SENDS ON THE NEXT PASS${lockLabel}`;
      return scheduled.getTime() - now > 0
        ? `SENDS IN ${relWhen(scheduled.getTime() - now)} · ${absWhen(scheduled, now)}${lockLabel}`
        : `SENDS ON THE NEXT PASS · WAS ${absWhen(scheduled, now)}${lockLabel}`;
    }
    case 'sending':
      return 'SENDING NOW';
    case 'sent': {
      const t = at(entry?.sentAt) || at(entry?.decidedAt);
      return t ? `SENT ${absWhen(t, now)}` : 'SENT';
    }
    case 'failed': {
      const t = at(entry?.decidedAt) || at(entry?.createdAt);
      return t ? `FAILED ${absWhen(t, now)}` : 'FAILED';
    }
    case 'rejected': {
      const t = at(entry?.decidedAt);
      return t ? `DECLINED ${absWhen(t, now)}` : 'DECLINED';
    }
    case 'withdrawn': {
      const t = at(entry?.decidedAt);
      return t ? `WITHDRAWN ${absWhen(t, now)}` : 'WITHDRAWN';
    }
    default:
      return '';
  }
};

/**
 * The entry's visual tone — which register its rail and standing chip speak
 * in. `await` is the one LIVE-by-design standing (a human owes a decision);
 * `live` moves on its own; `failed` wants an eye; `done` is history.
 * @param {string} status
 * @returns {'await'|'live'|'failed'|'done'}
 */
// pure
export const queueToneOf = (status) => {
  switch (String(status || '')) {
    case 'draft': return 'await';
    case 'approved':
    case 'sending': return 'live';
    case 'failed': return 'failed';
    default: return 'done';
  }
};

/** The standing chip's short label, in the lanes' own vocabulary. Pure. */
export const queueStandingLabel = (entry) => {
  switch (String(entry?.status || '')) {
    case 'draft': return 'AWAITS YOUR DECISION';
    case 'approved': return 'APPROVED';
    case 'sending': return 'SENDING…';
    case 'sent': return entry?.postId ? `SENT (${entry.postId})` : 'SENT';
    case 'failed': return 'DID NOT SEND';
    case 'rejected': return 'DECLINED';
    case 'withdrawn': return 'WITHDRAWN';
    default: return String(entry?.status || 'UNKNOWN').toUpperCase();
  }
};

// THE POST PREVIEW'S MEASURE — the platform's own constraint, made visible on
// the card (Design note, 2026-07-27: […]). Pure.

/**
 * Length the way a reader counts it — Unicode code points, not UTF-16 units,
 * so an emoji is ONE, not two. The platform's API remains the authority
 * (channel-registry maxChars is advisory); this is the card's honest measure.
 * @param {string} text
 * @returns {number}
 */
// pure
export const postLengthOf = (text) => [...String(text || '')].length;

/**
 * The preview's count readout: how long the post is, against the channel's
 * own ceiling when it has one. `over` marks what would not fit — the card
 * flags it, never hides it.
 * @param {object} entry queue entry (text)
 * @param {object|null} channel the channel board entry (maxChars) or null
 * @returns {{count: number, limit: (number|null), over: boolean}}
 */
// pure
export const postCountFor = (entry, channel) => {
  const count = postLengthOf(entry?.text);
  const limit = Number.isFinite(channel?.maxChars) && channel.maxChars > 0
    ? channel.maxChars
    : null;
  return Object.freeze({ count, limit, over: limit !== null && count > limit });
};
