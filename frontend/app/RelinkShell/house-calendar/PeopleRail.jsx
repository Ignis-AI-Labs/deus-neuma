// PeopleRail — whose calendar is in view, as one vertical instrument (the
// folder picker's rail idiom): EVERYONE first, then the people by standing —
// the operator, the house, the witnesses, the systems. Each reads its name
// over what is next for it; a click focuses on that person, more clicks add
// people, a click on a focused one releases them, EVERYONE clears the focus.
// A focused person carries the signal bar and a signal name.
import { Dot } from './CalendarParts.jsx';
import { standingGroups, nextUp } from './calendar-view.js';

const nextLine = (item, now) => {
  if (!item) return 'NOTHING AHEAD';
  const when = item.day === now.day ? (item.time ? `TODAY ${item.time}` : 'TODAY')
    : (() => { const d = new Date(`${item.day}T00:00:00`); return `${d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()} ${d.getDate()}`; })();
  return `${when} · ${item.title}`;
};

/**
 * @param {{people: Array<object>, focus: Set<string>, counts: Map<string, number>, items: Array<object>,
 *   now: {day: string, time: string}, onPick: (id: string) => void, onClear: () => void}} props
 */
export const PeopleRail = ({ people, focus, counts, items, now, onPick, onClear }) => (
  <nav className="hcal-rail" aria-label="Focus on people">
    <button type="button" className={`hcal-railitem is-everyone${focus.size ? '' : ' is-active'}`} aria-pressed={focus.size === 0} onClick={onClear}>
      <span className="hcal-railtext">
        <span className="hcal-railname">EVERYONE</span>
        <span className="hcal-railsub">{focus.size ? `FOCUS ON ${focus.size} · CLICK TO CLEAR` : `${people.length} CALENDARS`}</span>
      </span>
    </button>
    {standingGroups(people).map((group) => (
      <section key={group.id} className="hcal-railsec" aria-label={group.label}>
        <h4 className="hcal-railhead">
          <span>{group.label}</span>
          <span className="hcal-railhead-rule" aria-hidden="true" />
          <span className="hcal-railhead-count">{group.people.length}</span>
        </h4>
        <ul className="hcal-raillist">
          {group.people.map((p) => {
            const on = focus.has(p.id);
            const n = counts.get(p.id) || 0;
            return (
              <li key={p.id}>
                <button type="button" className={`hcal-railitem${on ? ' is-active' : ''}${n ? '' : ' is-quiet'}`} aria-pressed={on}
                  onClick={() => onPick(p.id)}
                  title={on ? `Release ${p.name} from the focus` : focus.size ? `Add ${p.name} to the focus` : `Focus on ${p.name}`}>
                  <Dot color={p.color} />
                  <span className="hcal-railtext">
                    <span className="hcal-railname">{p.name}</span>
                    <span className="hcal-railsub">{nextLine(nextUp(items, p.id, now), now)}</span>
                  </span>
                  <span className="hcal-railcount" aria-label={`${n} in view`}>{n}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    ))}
  </nav>
);
