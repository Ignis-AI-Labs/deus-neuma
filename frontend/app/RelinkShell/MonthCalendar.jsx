// MonthCalendar — THE month grid of the desk: one component every calendar
// renders through (the post queue, the vessel, the house calendar), so the
// grid exists once. The fold that fills it stays each domain's own
// (month-grid.js buildMonthGrid + its countSpec); this draws the folded weeks:
// the navigator, the weekday row, and a 6×7 of days — each day its letter-
// coded counts and, when the domain gives them, its marks (the house
// calendar's one dot per person).

import './MonthCalendar.css';

const WEEKDAYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

// The cell's spoken form — the letters are colour-coded, so a screen reader
// gets the same counts in words.
const cellLabel = (cell, countLanes, emptyLabel) => {
  const day = new Date(`${cell.key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const parts = countLanes
    .filter((lane) => cell.counts[lane.key] > 0)
    .map((lane) => lane.label(cell.counts[lane.key]));
  return `${day} — ${parts.length ? parts.join(', ') : emptyLabel}. Show this day.`;
};

// One count as its LETTER; zero prints nothing — a quiet day stays quiet
// rather than reading a row of zeroes.
const Count = ({ n, tone, letter }) => (
  n > 0 ? <span className={`qcal-n is-${tone}`}>{letter}{n}</span> : null
);

/**
 * @param {{year: number, monthIndex: number, weeks: Array<Array<object>>,
 *   countLanes: Array<{key: string, letter: string, tone: string, label: (n: number) => string}>,
 *   selectedKey?: ?string, onPick: (key: string) => void,
 *   onPrevMonth: () => void, onNextMonth: () => void, onToday: () => void,
 *   navClass?: string, emptyLabel?: string, extra?: any, renderMarks?: (cell: object) => any,
 *   head?: boolean, quietCounts?: boolean, cellClass?: (cell: object) => string}} props — `head: false`
 *   when the host carries its own navigator; `quietCounts` when renderMarks draws the counts itself (the
 *   letters leave the cell, the spoken label keeps them); `cellClass` adds a domain's class to a day.
 */
export const MonthCalendar = ({
  year, monthIndex, weeks, countLanes, selectedKey = null,
  onPick, onPrevMonth, onNextMonth, onToday,
  navClass = 'settings-set', emptyLabel = 'nothing scheduled', extra = null, renderMarks = null, head = true,
  quietCounts = false, cellClass = null,
}) => {
  const monthLabel = new Date(year, monthIndex, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    .toUpperCase();
  return (
    <div className="qcal">
      {head ? <div className="qcal-head">
        <button type="button" className={navClass} aria-label="Previous month" onClick={onPrevMonth}>‹</button>
        <span className="label-data qcal-month" aria-live="polite">{monthLabel}</span>
        <button type="button" className={navClass} aria-label="Next month" onClick={onNextMonth}>›</button>
        <button type="button" className={navClass} onClick={onToday}>TODAY</button>
        {extra}
      </div> : null}
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
              className={`qcal-cell${cell.today ? ' is-today' : ''}${selectedKey === cell.key ? ' is-on' : ''}${cellClass ? ` ${cellClass(cell)}` : ''}`}
              aria-pressed={selectedKey === cell.key}
              aria-label={cellLabel(cell, countLanes, emptyLabel)}
              onClick={() => onPick(cell.key)}
            >
              <span className="qcal-day">{cell.date}</span>
              {renderMarks ? <span className="qcal-marks">{renderMarks(cell)}</span> : null}
              {quietCounts ? null : (
                <span className="qcal-counts">
                  {countLanes.map((lane) => (
                    <Count key={lane.key} n={cell.counts[lane.key]} tone={lane.tone} letter={lane.letter} />
                  ))}
                </span>
              )}
            </button>
          )
        ))}
      </div>
    </div>
  );
};
