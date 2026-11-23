// ics-read.js — reading a calendar someone else keeps (RFC 5545): the text of an .ics feed in, the events it holds
// out, each occurrence at its real instant. The house calendar already WRITES one (backend/services/tasks-ics.js);
// this is the other direction, so a call booked through a scheduling page, or anything on the operator's own
// calendar, stands on the house calendar too (Design note, 2026-11-20: […]).
//
// What is read: each VEVENT's start and end (a UTC time, a time in a named zone, a floating local time, or a whole
// day), its title, place, link, who is invited, whether it was cancelled, and how it repeats — DAILY, WEEKLY (with
// its weekdays), MONTHLY and YEARLY on the same date, with INTERVAL, COUNT, UNTIL and the dates left out. A repeat
// rule this does not read (the "second Tuesday" kinds) is SAID on the event, and its first time still shows: a
// meeting is never dropped for being unusual.
//
// Pure: no clock, no network. Times in a named zone are worked out with the runtime's own zone tables (Intl).

const DAY_MS = 86_400_000;
const WEEKDAYS = Object.freeze(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']);
/** The most times one repeating event is laid out, however long the window. */
export const OCCURRENCES_MAX = 400;

// A folded line continues on the next line after one space or tab (RFC 5545 §3.1).
const unfold = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
const unescape = (v) => String(v ?? '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

// One content line → {name, params, value}. A parameter value may be quoted and hold colons.
const lineOf = (line) => {
  let inQuote = false;
  let at = -1;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ':' && !inQuote) { at = i; break; }
  }
  if (at < 0) return null;
  const [name, ...rest] = line.slice(0, at).split(';');
  const params = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(at + 1) };
};

/**
 * The instant of a wall-clock time in a named zone. The zone's offset at that moment is found from the runtime's
 * own tables; an unknown zone reads as the machine's local time. Pure.
 * @returns {number} epoch ms
 */
export const zonedMs = ({ y, mo, d, h = 0, mi = 0, s = 0 }, zone) => {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!zone) return new Date(y, mo - 1, d, h, mi, s).getTime();
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  } catch {
    return new Date(y, mo - 1, d, h, mi, s).getTime();
  }
  // What the zone's clock shows at a guess, against what it should show: the difference is the offset. Twice, so a
  // guess that lands across a clock change settles on the right side.
  const shown = (ms) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  };
  let guess = asUtc - (shown(asUtc) - asUtc);
  guess = asUtc - (shown(guess) - guess);
  return guess;
};

// A DATE or DATE-TIME value → its wall-clock fields and how it is anchored.
const whenOf = (prop) => {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(prop?.value ?? '').trim());
  if (!m) return null;
  const local = { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: Number(m[4] ?? 0), mi: Number(m[5] ?? 0), s: Number(m[6] ?? 0) };
  const allDay = m[4] === undefined;
  const zone = m[7] ? 'UTC' : (prop.params.TZID || null);
  return { local, allDay, zone, ms: allDay ? Date.UTC(local.y, local.mo - 1, local.d) : zonedMs(local, zone) };
};

const durationMs = (value) => {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const ms = (Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * DAY_MS + Number(m[4] ?? 0) * 3_600_000 + Number(m[5] ?? 0) * 60_000 + Number(m[6] ?? 0) * 1000;
  return m[1] === '-' ? -ms : ms;
};

const ruleOf = (value) => {
  if (!value) return null;
  const parts = Object.fromEntries(String(value).split(';').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = String(parts.FREQ ?? '').toUpperCase();
  const byday = parts.BYDAY ? parts.BYDAY.split(',').map((d) => d.toUpperCase()) : [];
  const until = parts.UNTIL ? whenOf({ value: parts.UNTIL, params: {} }) : null;
  // What is read: the four plain rhythms, weekly by weekday. Anything else is said, never guessed.
  const plain = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)
    && byday.every((d) => WEEKDAYS.includes(d)) && (freq === 'WEEKLY' || byday.length === 0)
    && !['BYMONTHDAY', 'BYSETPOS', 'BYMONTH', 'BYYEARDAY', 'BYWEEKNO', 'BYHOUR'].some((k) => parts[k]);
  return {
    freq, interval: Math.max(1, Number.parseInt(parts.INTERVAL ?? '1', 10) || 1),
    count: parts.COUNT ? Number.parseInt(parts.COUNT, 10) : null,
    untilMs: until ? (until.allDay ? until.ms + DAY_MS - 1 : until.ms) : null,
    byday, read: plain,
  };
};

const mailOf = (value) => String(value ?? '').replace(/^mailto:/i, '').trim().toLowerCase();

/**
 * Every event in a calendar's text. A malformed event is passed over, never thrown on. Pure.
 * @param {string} text - the .ics body
 * @returns {{ok: boolean, name: (string|null), events: Array<Object>}} ok: the text IS a calendar
 */
export const parseIcs = (text) => {
  const lines = unfold(text).split('\n');
  const isCalendar = lines.some((l) => l.trim().toUpperCase() === 'BEGIN:VCALENDAR');
  const events = [];
  let name = null;
  let cur = null;
  let depth = 0; // inside a VALARM (or any other part) of an event, nothing is the event's own
  for (const raw of lines) {
    const line = lineOf(raw);
    if (!line) continue;
    if (line.name === 'BEGIN') {
      if (line.value.toUpperCase() === 'VEVENT') { cur = { props: {}, attendees: [], exdates: [] }; depth = 0; } else if (cur) depth += 1;
      continue;
    }
    if (line.name === 'END') {
      if (line.value.toUpperCase() !== 'VEVENT') { if (cur && depth > 0) depth -= 1; continue; }
      const p = cur?.props ?? {};
      const start = whenOf(p.DTSTART);
      if (cur && start && p.UID) {
        const end = whenOf(p.DTEND);
        const lasts = end ? end.ms - start.ms : durationMs(p.DURATION?.value) ?? (start.allDay ? DAY_MS : 0);
        events.push({
          uid: unescape(p.UID.value),
          title: unescape(p.SUMMARY?.value) || '(no title)',
          start, lastsMs: Math.max(0, lasts),
          place: unescape(p.LOCATION?.value) || null,
          notes: unescape(p.DESCRIPTION?.value) || null,
          link: unescape(p.URL?.value) || null,
          organizer: p.ORGANIZER ? { email: mailOf(p.ORGANIZER.value), name: p.ORGANIZER.params.CN || null } : null,
          attendees: cur.attendees,
          cancelled: String(p.STATUS?.value ?? '').toUpperCase() === 'CANCELLED',
          rule: ruleOf(p.RRULE?.value),
          exdates: cur.exdates,
          // A changed single time of a repeating event names the time it replaces.
          replaces: p['RECURRENCE-ID'] ? whenOf(p['RECURRENCE-ID'])?.ms ?? null : null,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) { if (line.name === 'X-WR-CALNAME') name = unescape(line.value); continue; }
    if (depth > 0) continue;
    if (line.name === 'ATTENDEE') cur.attendees.push({ email: mailOf(line.value), name: line.params.CN || null, declined: String(line.params.PARTSTAT ?? '').toUpperCase() === 'DECLINED' });
    else if (line.name === 'EXDATE') for (const v of line.value.split(',')) { const w = whenOf({ value: v, params: line.params }); if (w) cur.exdates.push(w.ms); }
    else cur.props[line.name] = line;
  }
  return { ok: isCalendar, name, events };
};

// The local fields of the n-th step of a rhythm from a start, kept in wall-clock time so "every Monday 10:00"
// stays 10:00 across a clock change.
const stepped = (local, freq, n) => {
  if (freq === 'DAILY' || freq === 'WEEKLY') {
    const day = new Date(Date.UTC(local.y, local.mo - 1, local.d + n * (freq === 'WEEKLY' ? 7 : 1)));
    return { ...local, y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate() };
  }
  const months = (local.mo - 1) + (freq === 'YEARLY' ? 12 * n : n);
  const y = local.y + Math.floor(months / 12);
  const mo = (months % 12) + 1;
  // A date its month does not have (the 31st in April) is skipped, as the standard says.
  return new Date(Date.UTC(y, mo - 1, local.d)).getUTCMonth() === mo - 1 ? { ...local, y, mo } : null;
};

/**
 * Every time an event happens inside a window, each at its real instant. A cancelled event happens never; a single
 * changed time replaces the one it names. Sorted by start. Pure.
 * @param {Array<Object>} events - parseIcs events
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {Array<{uid:string, key:string, title:string, startMs:number, endMs:number, allDay:boolean, place:(string|null),
 *   link:(string|null), notes:(string|null), organizer:(Object|null), attendees:Array, repeats:boolean, ruleUnread:boolean}>}
 */
export const occurrencesIn = (events, fromMs, toMs) => {
  const moved = new Set(events.filter((e) => e.replaces !== null).map((e) => `${e.uid}\u0000${e.replaces}`));
  const out = [];
  const put = (e, startMs, extra = {}) => {
    const endMs = startMs + e.lastsMs;
    if (endMs < fromMs || startMs > toMs) return;
    out.push({
      uid: e.uid, key: `${e.uid}@${startMs}`, title: e.title, startMs, endMs, allDay: e.start.allDay, place: e.place, link: e.link, notes: e.notes,
      organizer: e.organizer, attendees: e.attendees, repeats: Boolean(e.rule), ruleUnread: Boolean(e.rule && !e.rule.read), ...extra,
    });
  };
  for (const e of events) {
    if (e.cancelled) continue;
    if (!e.rule || !e.rule.read || e.replaces !== null) { put(e, e.start.ms); continue; }
    const { freq, interval, count, untilMs, byday } = e.rule;
    const startDow = new Date(Date.UTC(e.start.local.y, e.start.local.mo - 1, e.start.local.d)).getUTCDay();
    // Weekly on several weekdays: each named weekday of the start's own week, repeated.
    const offsets = freq === 'WEEKLY' && byday.length ? byday.map((d) => WEEKDAYS.indexOf(d) - startDow).sort((a, b) => a - b) : [0];
    let made = 0;
    for (let n = 0; made < OCCURRENCES_MAX && n < 5000; n += 1) {
      const base = stepped(e.start.local, freq, n * interval);
      let past = false;
      for (const off of offsets) {
        if (!base) continue;
        const day = new Date(Date.UTC(base.y, base.mo - 1, base.d + off));
        const local = { ...base, y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate() };
        const ms = e.start.allDay ? Date.UTC(local.y, local.mo - 1, local.d) : zonedMs(local, e.start.zone);
        if (ms < e.start.ms) continue; // a weekday of the first week before the start itself
        if ((untilMs !== null && ms > untilMs) || (count !== null && made >= count) || ms > toMs) { past = true; break; }
        made += 1;
        if (e.exdates.includes(ms) || moved.has(`${e.uid}\u0000${ms}`)) continue;
        put(e, ms);
      }
      if (past) break;
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : 1));
};
