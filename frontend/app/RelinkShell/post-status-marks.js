// post-status-marks — ONE vocabulary for where a post stands (show-dont-tell
// audit, finding 9). Every status a post, a queue entry or a mandate's DONE
// FOR YOU row can hold maps to one mark shape, one colour token and a name of
// at most two words; every surface that says a status (the post card, the
// board's rows, the campaign calendar, DONE FOR YOU, the platform head's
// doors, the board's filter words) reads it here, so the same status reads
// the same mark everywhere (CHOKKAN 4). Shape carries the meaning and colour
// only confirms it: ◇ waits on you, ○ will go out, ● went out, ▲ failed.
// The colours are the desk's own (queue-status.css): signal for what will go
// out, ink for what went out, alert for what failed, quiet for what is over.
//
// Every function here is pure.

/** The four tones, each a colour token the desk already speaks. */
export const STATUS_TONES = Object.freeze({
  signal: '--signal',
  ink: '--color-text-secondary',
  alert: '--alert',
  quiet: '--color-text-tertiary',
});

const mark = (shape, tone, name) => Object.freeze({ shape, tone, token: STATUS_TONES[tone], name });

/**
 * Status → mark. Post and queue statuses by their own key; a post the
 * MANDATE approved is `by-mandate`; DONE FOR YOU's act with no post is
 * `done`, one whose post is gone is `gone`; the mandate's own events are
 * `mandate-<kind>`.
 */
export const STATUS_MARKS = Object.freeze({
  draft: mark('diamond', 'signal', 'AWAITING'),
  approved: mark('ring', 'signal', 'SCHEDULED'),
  'by-mandate': mark('ring-dot', 'signal', 'BY MANDATE'),
  sending: mark('half', 'signal', 'SENDING'),
  sent: mark('disc', 'ink', 'SENT'),
  failed: mark('fault', 'alert', 'FAILED'),
  rejected: mark('cross', 'quiet', 'DECLINED'),
  withdrawn: mark('slash', 'quiet', 'WITHDRAWN'),
  done: mark('check', 'ink', 'DONE'),
  gone: mark('line', 'quiet', 'REMOVED'),
  'mandate-granted': mark('plus', 'ink', 'GRANTED'),
  'mandate-renewed': mark('plus-ring', 'ink', 'RENEWED'),
  'mandate-resumed': mark('play', 'ink', 'RESUMED'),
  'mandate-withdrawn': mark('square', 'quiet', 'MANDATE OFF'),
  'mandate-tripped': mark('pause', 'alert', 'PAUSED'),
  'mandate-held': mark('diamond-fill', 'alert', 'HELD'),
  'mandate-cleared': mark('check', 'quiet', 'CLEARED'),
});

/** The key a queue entry stands under: its status, or `by-mandate` when the mandate approved it. */
export const statusKeyOf = (entry) => {
  const status = String(entry?.status || '');
  return status === 'approved' && entry?.decidedUnder ? 'by-mandate' : status;
};

/** The key a DONE FOR YOU row stands under: an act by its post's status, an event as `mandate-<kind>`. */
export const feedKeyOf = (row) => (row?.kind === 'event' ? `mandate-${row.status}` : String(row?.status || ''));

/**
 * The mark for a key. A status this table has never met still says itself,
 * as a quiet bar (SHINKEI: an unknown reads as unknown, never as a guess).
 * @param {string} key
 * @returns {{shape: string, tone: string, token: string, name: string}}
 */
export const statusMark = (key) => STATUS_MARKS[key] || mark('line', 'quiet', String(key || 'unknown').replace(/^mandate-/, '').toUpperCase());
