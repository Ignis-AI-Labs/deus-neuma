// QueueCalendar — the month the board zooms OUT to (Design note, 2026-07-28: […]). A navigator, not a
// second board: each day carries only the counts that decide whether it is
// worth opening — the cards themselves stay in the day view. The register is
// the board's own: SIGNAL for a decision owed, quiet ink for the rest, and
// replies marked R so engagement reads separately at a glance. The count
// LANES are a prop (F4, 2026-08-31): the queue spec below is the default, so
// HERALD renders byte-identically without passing anything; another domain
// (the vessel calendar, Wave-3) passes its own lanes over the same grid.

import { buildMonthGrid, filterQueueToDay } from './campaigns-helpers.js';

const WEEKDAYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

// The queue's count lanes, in render order. Each lane: `key` indexes the
// cell's counts object (a count the grid never folded is undefined → the
// lane prints nothing), `letter` is the cell's letter-code, `tone` picks the
// .qcal-n.is-<tone> colour, `label` speaks the count in words for the cell's
// aria-label (singular/plural is the lane's own business).
const QUEUE_COUNT_LANES = Object.freeze([
  { key: 'Q', letter: 'Q', tone: 'await', label: (n) => `${n} awaiting approval` },
  { key: 'A', letter: 'A', tone: 'live', label: (n) => `${n} approved` },
  { key: 'U', letter: 'U', tone: 'done', label: (n) => `${n} unapproved` },
  { key: 'W', letter: 'W', tone: 'done', label: (n) => `${n} withdrawn` },
  { key: 'S', letter: 'S', tone: 'done', label: (n) => `${n} sent` },
  { key: 'F', letter: 'F', tone: 'fail', label: (n) => `${n} failed` },
  { key: 'R', letter: 'R', tone: 'reply', label: (n) => `${n} ${n === 1 ? 'reply' : 'replies'}` },
]);

// The cell's spoken form — the letters are colour-coded, so a screen reader
// gets the same counts in words.
const cellLabel = (cell, countLanes) => {
  const day = new Date(`${cell.key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const parts = countLanes
    .filter((lane) => cell.counts[lane.key] > 0)
    .map((lane) => lane.label(cell.counts[lane.key]));
  return `${day} — ${parts.length ? parts.join(', ') : 'nothing scheduled'}. Show this day.`;
};

// One count as its LETTER (Design note, 2026-07-28: […]). Zero prints nothing — a quiet day stays quiet
// rather than reading a row of zeroes.
const Count = ({ n, tone, letter }) => (
  n > 0 ? <span className={`qcal-n is-${tone}`}>{letter}{n}</span> : null
);

export const QueueCalendar = ({
  year, monthIndex, entries, now, selectedKey,
  onPick, onPrevMonth, onNextMonth, onToday,
  countLanes = QUEUE_COUNT_LANES,
}) => {
  const weeks = buildMonthGrid(year, monthIndex, entries, { now });
  const unscheduled = filterQueueToDay(entries, null).length;
  const monthLabel = new Date(year, monthIndex, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    .toUpperCase();

  return (
    <div className="qcal">
      <div className="qcal-head">
        <button type="button" className="settings-set" aria-label="Previous month"
          onClick={onPrevMonth}>‹</button>
        <span className="label-data qcal-month" aria-live="polite">{monthLabel}</span>
        <button type="button" className="settings-set" aria-label="Next month"
          onClick={onNextMonth}>›</button>
        <button type="button" className="settings-set" onClick={onToday}>TODAY</button>
        {unscheduled > 0 ? (
          // The bucket is a day view like any other — it just has no date, so
          // it lives beside the grid rather than inside it.
          <button type="button" className="settings-set" onClick={() => onPick(null)}>
            UNSCHEDULED ({unscheduled})
          </button>
        ) : null}
      </div>
      <div className="qcal-weekdays" aria-hidden="true">
        {WEEKDAYS.map((d) => <span key={d} className="qcal-weekday">{d}</span>)}
      </div>
      <div className="qcal-grid">
        {weeks.flat().map((cell, i) => (
          cell.date === null ? (
            // Padding keeps the grid 6×7 so the month never jumps height —
            // a blank seat, not a day that answers clicks.
            <span key={`pad-${i}`} className="qcal-cell is-pad" aria-hidden="true" />
          ) : (
            <button
              key={cell.key}
              type="button"
              className={`qcal-cell${cell.today ? ' is-today' : ''}${selectedKey === cell.key ? ' is-on' : ''}`}
              aria-pressed={selectedKey === cell.key}
              aria-label={cellLabel(cell, countLanes)}
              onClick={() => onPick(cell.key)}
            >
              <span className="qcal-day">{cell.date}</span>
              <span className="qcal-counts">
                {countLanes.map((lane) => (
                  <Count key={lane.key} n={cell.counts[lane.key]} tone={lane.tone} letter={lane.letter} />
                ))}
              </span>
            </button>
          )
        ))}
      </div>
    </div>
  );
};
