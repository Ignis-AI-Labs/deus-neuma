// DayTimeline — one day of the house in time order: the all-day items first,
// then each timed item with whose it is and what kind of thing it is; on
// today, the NOW line between what has passed and what is coming. The day
// the week's headers and the month's cells open into.
import { AgendaItem, Dot } from './CalendarParts.jsx';
import { kindOf, nowIndex } from './calendar-view.js';

/**
 * @param {{day: string, items: Array<object>, people: Array<object>, now: {day: string, time: string},
 *   selectedId: ?string, onSelect: (item: object) => void}} props
 */
export const DayTimeline = ({ day, items, people, now, selectedId, onSelect }) => {
  if (items.length === 0) return <p className="hcal-quiet label-data">NOTHING SCHEDULED THIS DAY.</p>;
  const personOf = (lane) => people.find((p) => p.id === lane) || { name: lane, color: 'var(--color-text-tertiary)' };
  const cut = day === now.day ? nowIndex(items, now) : -1;
  return (
    <ul className="hcal-day" aria-label="The day, in time order">
      {items.map((item, i) => {
        const who = personOf(item.lane);
        return [
          i === cut ? <li key="now" className="hcal-dayline is-now label-data" role="separator">NOW · {now.time}</li> : null,
          <li key={item.id} className={`hcal-dayline${day === now.day && item.time && i < cut ? ' is-past' : ''}`}>
            <span className="hcal-dayline-time label-data">{item.time || 'ALL DAY'}</span>
            <span className="hcal-dayline-who label-data"><Dot color={who.color} />{who.name}</span>
            <span className="hcal-dayline-kind label-data">{kindOf(item)}</span>
            <AgendaItem item={item} now={now} color={who.color} wide selected={item.id === selectedId} onSelect={onSelect} />
          </li>,
        ];
      })}
      {cut === items.length ? <li className="hcal-dayline is-now label-data" role="separator">NOW · {now.time}</li> : null}
    </ul>
  );
};
