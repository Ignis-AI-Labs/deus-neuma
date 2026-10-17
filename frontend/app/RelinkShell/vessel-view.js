// vessel-view.js — every presentation decision for VESSEL, the stat-sheet
// window. Pure: vitals, records, benchmarks, and telemetry go in,
// render-ready facts come out. The data law holds — a missing measurement
// comes back null/'' (rendered —), never a fabricated zero, and a kind or
// cadence the view does not know still prints as itself.

const DAY_MS = 86400000;

/**
 * A benchmark score's movement against the previous run: up, down, or
 * level. Null when either side is missing — a trend with one end gone is
 * not a trend.
 * @param {number|null} current
 * @param {number|null} previous
 * @returns {'↑'|'↓'|'='|null}
 */
export const trendGlyph = (current, previous) => {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (current > previous) return '↑';
  if (current < previous) return '↓';
  return '=';
};

/**
 * How long ago a day was, in the witness's calendar: today, yesterday, or a
 * plain count of days. Future timestamps floor at today (a clock anomaly is
 * not tomorrow's business). Garbage in, empty string out.
 * @param {*} iso
 * @param {number} [now] ms clock, injectable for a deterministic read
 * @returns {'today'|'yesterday'|string}
 */
export const daysAgoLabel = (iso, now = Date.now()) => {
  const ms = Date.parse(iso);
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return '';
  const dayStart = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((dayStart(nowMs) - dayStart(ms)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} DAYS AGO`;
};

/**
 * A signed 30-day bodyweight delta, one decimal, minus as U+2212. Null or
 * non-finite in, empty string out — the card shows nothing rather than a
 * fabricated drift.
 * @param {number|null} n
 * @returns {string}
 */
export const fmtDelta = (n) => {
  if (!Number.isFinite(n)) return '';
  return `${n < 0 ? '−' : '+'}${Math.abs(n).toFixed(1)}`;
};

const KIND_LABELS = Object.freeze({
  pr: 'PR',
  bodyweight: 'BODYWEIGHT',
  session: 'SESSION',
  planned: 'PLANNED',
  life: 'MARKER',
  daily: 'DAILY',
  'dailies-set': 'DAILIES',
});

/**
 * A vitals entry's tag in the data register. An unrecognized kind still
 * prints as itself (uppercased) — never a fabricated one.
 * @param {string} kind
 * @returns {string}
 */
export const kindLabel = (kind) =>
  KIND_LABELS[kind] || String(kind ?? '—').toUpperCase();

/**
 * One human line for a vitals entry, shaped by its kind. Missing fields
 * degrade to '—' within the line; an unrecognized kind is an empty line
 * (the row shows only its tag and date).
 * @param {{kind: string}} entry
 * @returns {string}
 */
export const entryLine = (entry) => {
  if (!entry || typeof entry !== 'object') return '';
  switch (entry.kind) {
    case 'pr': {
      const lift = entry.lift || '—';
      const weight = Number.isFinite(entry.weight) ? `${entry.weight} ${entry.unit || ''}`.trimEnd() : '—';
      const reps = Number.isFinite(entry.reps) ? ` × ${entry.reps}` : '';
      return `${lift} ${weight}${reps}`;
    }
    case 'bodyweight':
      return Number.isFinite(entry.weight) ? `${entry.weight} ${entry.unit || ''}`.trimEnd() : '—';
    case 'session': {
      const duration = Number.isFinite(entry.durationMin) ? ` · ${entry.durationMin} min` : '';
      const work = Array.isArray(entry.exercises) && entry.exercises.length > 0 ? ` · ${entry.exercises.length} lift(s)` : '';
      return `${entry.title || '—'}${duration}${work}`;
    }
    case 'planned':
      return `${entry.title || '—'} → ${entry.scheduledFor || '—'}`;
    case 'life': {
      const note = entry.note ? ` — ${entry.note}` : '';
      return `${entry.marker || '—'}${note}`;
    }
    case 'daily':
      return entry.title || '—';
    case 'dailies-set': {
      const items = Array.isArray(entry.items) ? entry.items : [];
      return items.length === 0 ? 'dailies cleared' : `dailies set — ${items.map((i) => i.title).join(' · ')}`;
    }
    default:
      return '';
  }
};

/**
 * Is a benchmark overdue? Never measured is always due; otherwise the gap
 * since the last run is measured against the due window. A broken clock
 * (invalid `now`) answers not-due rather than raising a false alarm.
 * @param {*} lastRunAt ISO of the latest run, null when never measured
 * @param {number} [now] ms clock, injectable
 * @param {number} [dueDays] the due window in days
 * @returns {boolean}
 */
export const benchmarkDue = (lastRunAt, now = Date.now(), dueDays = 30) => {
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) return false;
  const ms = Date.parse(lastRunAt);
  if (!Number.isFinite(ms)) return true;
  return nowMs - ms > dueDays * DAY_MS;
};

/**
 * Has a life marker already been logged today? A missing marker list is an
 * honest no.
 * @param {Array<string>|*} markersToday
 * @param {string} marker
 * @returns {boolean}
 */
export const markerPresent = (markersToday, marker) =>
  Array.isArray(markersToday) && markersToday.includes(marker);
