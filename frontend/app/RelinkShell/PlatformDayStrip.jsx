// PlatformDayStrip — the four weeks around today as one instrument: a column
// per day, stacked by status (queue-status.css), scaled to the busiest day,
// each day a door into it. Shared by a platform window's console head
// (PlatformHeader.jsx) and MARKETING's account head (account-level/AccountHead.jsx).

import { STRIP_BEFORE } from './platform-pulse.js';

/** The four weeks around today: one column per day, stacked by status, scaled to the busiest day. */
export const DayStrip = ({ strip, onDay }) => {
  const total = (c) => c.S + c.A + c.Q + c.F + c.R;
  const max = Math.max(1, ...strip.map((d) => total(d.counts)));
  // Today and every seventh day from it carry the axis when the strip is too narrow for every date.
  const today = strip.findIndex((d) => d.today);
  return (
    <div className="pc-strip" role="group" aria-label="the four weeks around today">
      {strip.map((d, i) => {
        const c = d.counts;
        const parts = [['sent', c.S], ['scheduled', c.A], ['awaiting', c.Q], ['failed', c.F], ['reply', c.R]].filter(([, n]) => n > 0);
        return (
          <button
            key={d.key}
            type="button"
            className={`pc-strip-day${d.today ? ' is-today' : ''}${i < STRIP_BEFORE ? ' is-past' : ''}`}
            onClick={() => onDay(d.key)} data-tick={(i - today) % 7 === 0 ? '' : undefined}
            title={`${d.key} — ${parts.length ? parts.map(([k, n]) => `${n} ${k}`).join(', ') : 'nothing'}`}
          >
            <span className="pc-strip-col" style={{ height: `${(total(c) / max) * 100}%` }}>
              {parts.map(([k, n]) => <i key={k} className={`qs-${k}`} style={{ flexGrow: n }} />)}
            </span>
            <span className="pc-strip-date">{Number(d.key.slice(8))}</span>
          </button>
        );
      })}
    </div>
  );
};

