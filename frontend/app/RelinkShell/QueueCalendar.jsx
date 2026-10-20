// QueueCalendar — the month the board zooms OUT to (Design note, 2026-07-28: […]). A navigator, not a
// second board: each day carries only the counts that decide whether it is
// worth opening — the cards themselves stay in the day view. The register is
// the board's own: SIGNAL for a decision owed, quiet ink for the rest, and
// replies marked R so engagement reads separately at a glance. The count
// LANES are a prop (F4, 2026-08-31): the queue spec below is the default, so
// HERALD renders byte-identically without passing anything; another domain
// (the vessel calendar, Wave-3) passes its own lanes over the same grid.
// The grid itself is MonthCalendar's; this is the queue's fold and letters.

import { buildMonthGrid, filterQueueToDay } from './campaigns-helpers.js';
import { MonthCalendar } from './MonthCalendar.jsx';

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

export const QueueCalendar = ({
  year, monthIndex, entries, now, selectedKey,
  onPick, onPrevMonth, onNextMonth, onToday,
  countLanes = QUEUE_COUNT_LANES,
}) => {
  const unscheduled = filterQueueToDay(entries, null).length;
  return (
    <MonthCalendar
      year={year}
      monthIndex={monthIndex}
      weeks={buildMonthGrid(year, monthIndex, entries, { now })}
      countLanes={countLanes}
      selectedKey={selectedKey}
      onPick={onPick}
      onPrevMonth={onPrevMonth}
      onNextMonth={onNextMonth}
      onToday={onToday}
      extra={unscheduled > 0 ? (
        // The bucket is a day view like any other — it just has no date, so
        // it lives beside the grid rather than inside it.
        <button type="button" className="settings-set" onClick={() => onPick(null)}>
          UNSCHEDULED ({unscheduled})
        </button>
      ) : null}
    />
  );
};
