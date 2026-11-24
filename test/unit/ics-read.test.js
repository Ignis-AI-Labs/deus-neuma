// Reading a calendar someone else keeps (core/calendar/ics-read.js): the events in an .ics text, each time it
// happens at its real instant. The first event is shaped as a booking page writes one onto a Google calendar. Pure.
import { describe, it, expect } from 'vitest';
import { parseIcs, occurrencesIn, zonedMs, OCCURRENCES_MAX } from '../../core/calendar/ics-read.js';

const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Otto', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const ev = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const iso = (ms) => new Date(ms).toISOString();
const BOOKED = ev(
  'UID:booked-1@google.com', 'DTSTART:20261123T160000Z', 'DTEND:20261123T161500Z',
  'SUMMARY:Dana Reyes and Otto Lars Brandt', 'LOCATION:https://meet.google.com/abc-defg-hij',
  'DESCRIPTION:Event Name: 15 Minute Meeting\\nNeed to make changes to this event?\\, see ', // a folded line: the next
  ' https://calendly.com/reschedulings/x', // begins with one space, which is the fold and not part of the text
  'ORGANIZER;CN=Otto:mailto:otto@house.example',
  'ATTENDEE;CN=Dana Reyes;PARTSTAT=ACCEPTED:mailto:Dana@FundOne.example',
  'ATTENDEE;CN="Brandt, Otto";PARTSTAT=ACCEPTED:mailto:otto@house.example',
  'BEGIN:VALARM', 'TRIGGER:-PT10M', 'DESCRIPTION:not the event\'s own', 'END:VALARM',
);

describe('the events in a calendar\'s text', () => {
  it('a booked call: when, what, where, and who — folded lines joined, an alarm\'s words not taken for the event\'s', () => {
    const read = parseIcs(cal(BOOKED));
    expect(read).toMatchObject({ ok: true, name: 'Otto' });
    expect(read.events).toHaveLength(1);
    const [e] = read.events;
    expect(e).toMatchObject({ uid: 'booked-1@google.com', title: 'Dana Reyes and Otto Lars Brandt', place: 'https://meet.google.com/abc-defg-hij', lastsMs: 15 * 60_000, cancelled: false, rule: null });
    expect(iso(e.start.ms)).toBe('2026-11-23T16:00:00.000Z');
    expect(e.notes).toBe('Event Name: 15 Minute Meeting\nNeed to make changes to this event?, see https://calendly.com/reschedulings/x');
    expect(e.organizer).toEqual({ email: 'otto@house.example', name: 'Otto' });
    expect(e.attendees).toEqual([{ email: 'dana@fundone.example', name: 'Dana Reyes', declined: false }, { email: 'otto@house.example', name: 'Brandt, Otto', declined: false }]);
  });

  it('what is not a calendar is said so; a broken event is passed over, never thrown on', () => {
    expect(parseIcs('<html>Sign in</html>')).toEqual({ ok: false, name: null, events: [] });
    expect(parseIcs('')).toMatchObject({ ok: false });
    const read = parseIcs(cal(ev('UID:no-start', 'SUMMARY:nothing'), ev('DTSTART:20261123T160000Z', 'SUMMARY:no uid'), BOOKED));
    expect(read.events.map((e) => e.uid)).toEqual(['booked-1@google.com']);
  });

  it('a time in a named zone is its real instant on both sides of a clock change; a whole day has no time', () => {
    expect(iso(zonedMs({ y: 2026, mo: 3, d: 8, h: 10 }, 'America/New_York'))).toBe('2026-03-08T14:00:00.000Z'); // daylight time began that morning
    expect(iso(zonedMs({ y: 2026, mo: 11, d: 1, h: 10 }, 'America/New_York'))).toBe('2026-11-01T15:00:00.000Z'); // and ended that morning
    expect(iso(zonedMs({ y: 2026, mo: 6, d: 1, h: 9, mi: 30 }, 'Asia/Jakarta'))).toBe('2026-06-01T02:30:00.000Z');
    const [timed, day] = parseIcs(cal(ev('UID:t', 'DTSTART;TZID=Asia/Jakarta:20261124T093000', 'DURATION:PT45M', 'SUMMARY:Timed'), ev('UID:d', 'DTSTART;VALUE=DATE:20261125', 'SUMMARY:Day'))).events;
    expect(iso(timed.start.ms)).toBe('2026-11-24T02:30:00.000Z');
    expect(timed.lastsMs).toBe(45 * 60_000);
    expect(day.start).toMatchObject({ allDay: true });
    expect(iso(day.start.ms)).toBe('2026-11-25T00:00:00.000Z');
    expect(day.lastsMs).toBe(86_400_000);
  });
});

describe('each time an event happens, inside a window', () => {
  const window = [Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 31)];
  const times = (...events) => occurrencesIn(parseIcs(cal(...events)).events, ...window).map((o) => iso(o.startMs));

  it('one meeting, once, with everything the reminder needs', () => {
    const [one] = occurrencesIn(parseIcs(cal(BOOKED)).events, ...window);
    expect(one).toMatchObject({ uid: 'booked-1@google.com', key: `booked-1@google.com@${Date.UTC(2026, 10, 23, 16)}`, allDay: false, repeats: false, ruleUnread: false });
    expect(one.endMs - one.startMs).toBe(15 * 60_000);
    expect(occurrencesIn(parseIcs(cal(BOOKED)).events, Date.UTC(2026, 11, 1), Date.UTC(2026, 11, 2))).toEqual([]);
  });

  it('weekly on two weekdays keeps its wall-clock time across the clock change, and stops at its count', () => {
    expect(times(ev('UID:w', 'DTSTART;TZID=America/New_York:20261026T100000', 'DTEND;TZID=America/New_York:20261026T103000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6', 'SUMMARY:Standup'))).toEqual([
      '2026-11-02T15:00:00.000Z', '2026-11-04T15:00:00.000Z', '2026-11-09T15:00:00.000Z', '2026-11-11T15:00:00.000Z', // the two October ones are before the window; 10:00 is 15:00Z after the change
    ]);
  });

  it('duplicate weekdays expand once each and still honour the occurrence count', () => {
    expect(times(ev('UID:dup', 'DTSTART:20261102T100000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,MO,MO;COUNT=2', 'SUMMARY:Once'))).toEqual([
      '2026-11-02T10:00:00.000Z', '2026-11-09T10:00:00.000Z',
    ]);
  });

  it('every other day until a date, with one date left out and one moved', () => {
    const moved = ev('UID:d', 'RECURRENCE-ID:20261105T090000Z', 'DTSTART:20261105T140000Z', 'DTEND:20261105T143000Z', 'SUMMARY:Moved');
    const rule = ev('UID:d', 'DTSTART:20261101T090000Z', 'DTEND:20261101T093000Z', 'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261109T090000Z', 'EXDATE:20261107T090000Z', 'SUMMARY:Every other day');
    expect(times(rule, moved)).toEqual(['2026-11-01T09:00:00.000Z', '2026-11-03T09:00:00.000Z', '2026-11-05T14:00:00.000Z', '2026-11-09T09:00:00.000Z']);
  });

  it('monthly on the 31st skips the months without one; a cancelled event never happens', () => {
    const all = occurrencesIn(parseIcs(cal(ev('UID:m', 'DTSTART:20260131T120000Z', 'RRULE:FREQ=MONTHLY;COUNT=4', 'SUMMARY:Month end'))).events, Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31));
    expect(all.map((o) => iso(o.startMs).slice(0, 10))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
    expect(times(ev('UID:c', 'DTSTART:20261110T100000Z', 'STATUS:CANCELLED', 'SUMMARY:Off'))).toEqual([]);
  });

  it('a repeat rule this does not read is SAID, and its first time still shows; a rule with no end is bounded by the window', () => {
    const [odd] = occurrencesIn(parseIcs(cal(ev('UID:o', 'DTSTART:20261110T100000Z', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:Second Tuesday'))).events, ...window);
    expect(odd).toMatchObject({ repeats: true, ruleUnread: true });
    expect(iso(odd.startMs)).toBe('2026-11-10T10:00:00.000Z');
    const daily = occurrencesIn(parseIcs(cal(ev('UID:e', 'DTSTART:20200101T080000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Forever'))).events, ...window);
    expect(daily.length).toBeLessThanOrEqual(OCCURRENCES_MAX);
    expect(daily.every((o) => o.startMs >= window[0] - 1 && o.startMs <= window[1])).toBe(true);
  });
});
