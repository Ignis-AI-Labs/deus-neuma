// WeekGrid — the house calendar's week: a row for each person in view with
// something scheduled in it (or focused on), seven days across; everyone
// quiet this week folds into one line beneath, so the busy rows lead. Each
// cell holds that person's items for the day, repeats folded into one (three
// meditations read once, ×3); today's cell draws the NOW line where its timed
// items cross from past to coming; a cell with more than fits opens the day.
// On a person who takes tasks, a cell's + puts one on that day. The names and
// the days stay put while the week scrolls.
import { AgendaItem, Dot, QuickAdd } from './CalendarParts.jsx';
import { canQuickAdd, nowIndex, stackRepeats, shortName, weekRows } from './calendar-view.js';

const FITS = 4;

const dayHead = (key) => {
  const d = new Date(`${key}T00:00:00`);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
    date: d.getDate(),
    long: d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
  };
};

const NowLine = () => <span className="hcal-now" role="separator" aria-label="Now" />;

/**
 * @param {{days: string[], people: Array<object>, focus: Set<string>, cells: Map<string, Array<object>>,
 *   now: {day: string, time: string}, quick: ?{personId: string, day: string}, selectedId: ?string,
 *   onPickDay: (day: string) => void, onQuick: (q: ?{personId: string, day: string}) => void,
 *   onAdded: () => void, onSelect: (item: object) => void, onFocus: (id: string) => void}} props
 */
export const WeekGrid = ({ days, people, focus, cells, now, quick, selectedId, onPickDay, onQuick, onAdded, onSelect, onFocus }) => {
  const { busy, quiet } = weekRows(people, cells, days, focus);
  return (
    <div className="hcal-weekwrap">
      <div className="hcal-week" role="grid" aria-label="The house's week">
        <div className="hcal-row is-head" role="row">
          <span className="hcal-corner" role="columnheader" />
          {days.map((day) => {
            const h = dayHead(day);
            return (
              <button key={day} type="button" role="columnheader" className={`hcal-dayhead${day === now.day ? ' is-today' : ''}${day < now.day ? ' is-past' : ''}`}
                aria-label={`Open ${h.long}`} onClick={() => onPickDay(day)}>
                <span className="hcal-dayhead-wd">{h.weekday}</span>
                <span className="hcal-date">{h.date}</span>
              </button>
            );
          })}
        </div>
        {busy.map((person) => (
          <div key={person.id} className={`hcal-row is-${person.kind}`} role="row">
            <span className="hcal-who" role="rowheader" title={person.name}>
              <span className="hcal-who-name"><Dot color={person.color} />{shortName(person.name)}</span>
            </span>
            {days.map((day) => {
              const list = stackRepeats(cells.get(`${person.id}|${day}`) || []);
              const shown = list.slice(0, FITS);
              const cut = day === now.day ? nowIndex(shown, now) : -1;
              const adding = quick?.personId === person.id && quick?.day === day;
              return (
                <div key={day} role="gridcell" className={`hcal-cell${day === now.day ? ' is-today' : ''}${day < now.day ? ' is-past' : ''}`}
                  aria-label={`${person.name}, ${dayHead(day).long}: ${list.length ? `${list.length} scheduled` : 'nothing scheduled'}`}>
                  {shown.map((item, i) => (
                    <span key={item.id} className="hcal-slot">
                      {i === cut ? <NowLine /> : null}
                      <AgendaItem item={item} now={now} color={person.color} selected={item.id === selectedId} onSelect={onSelect} />
                    </span>
                  ))}
                  {cut === shown.length && shown.length > 0 ? <NowLine /> : null}
                  {list.length > FITS ? (
                    <button type="button" className="hcal-more" onClick={() => onPickDay(day)}>+{list.length - FITS} MORE</button>
                  ) : null}
                  {adding ? (
                    <QuickAdd person={person} day={day} onDone={() => { onQuick(null); onAdded(); }} onCancel={() => onQuick(null)} />
                  ) : canQuickAdd(person) ? (
                    <button type="button" className="hcal-add" aria-label={`Add a task for ${person.name} on ${dayHead(day).long}`}
                      onClick={() => onQuick({ personId: person.id, day })}>+</button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
        {busy.length === 0 ? (
          <p className="hcal-weekempty">NOTHING SCHEDULED THIS WEEK FOR {focus.size ? 'THE FOCUS' : 'ANYONE'}.</p>
        ) : null}
      </div>
      {quiet.length ? (
        <div className="hcal-quietline" aria-label="Quiet this week">
          <span className="hcal-quietline-head">QUIET THIS WEEK</span>
          {quiet.map((p) => (
            <button key={p.id} type="button" className="hcal-quietname" onClick={() => onFocus(p.id)} title={`Focus on ${p.name} — add a task to their week`}>
              <Dot color={p.color} />{shortName(p.name)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
