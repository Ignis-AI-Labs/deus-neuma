// HouseCalendar — the house's calendar in the TASKS window (Design note, 2026-10-17:
// […]). Everything scheduled — the operator's tasks, each member's work,
// the house's own rhythms, the machine's — from one read (use-house-agenda),
// in three views over the same items: the WEEK (a row per person), the MONTH
// (the desk's one month grid, a dot per person on each day — real items only;
// a daily on every future day would turn the month into noise), and a DAY in time
// order. FOCUS (ruling, 2026-10-17): click a person to see only them, click more
// to add them, click a focused one to release them, CLEAR to see everyone;
// the focus is kept. Any item opens its detail; ← → step the view, T is
// today, W / M / D switch views, Esc closes the detail.
import { useCallback, useMemo, useRef, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { getRoster, getWitnesses } from '../../../utils/companion-data.js';
import { buildMonthGrid, dayKeyOf, shiftDayKey } from '../month-grid.js';
import { MonthCalendar } from '../MonthCalendar.jsx';
import { useHouseAgenda } from './use-house-agenda.js';
import { useOperatorName } from '../use-operator-name.js';
import { WeekGrid } from './WeekGrid.jsx';
import { DayTimeline } from './DayTimeline.jsx';
import { ItemDetail } from './CalendarParts.jsx';
import { PeopleRail } from './PeopleRail.jsx';
import { useMonthFits } from './use-month-fits.js';
import {
  peopleOf, weekOf, monthSpan, cellsOf, focusItems, toggleFocus, inFocus, countsBy, dayOf, nowStamp,
  monthCountSpec, MONTH_COUNT_LANES,
} from './calendar-view.js';
import './HouseCalendar.css';
import './HouseCalendar-rail.css';
import './HouseCalendar-views.css';

const VIEWS = Object.freeze([{ id: 'week', label: 'WEEK' }, { id: 'month', label: 'MONTH' }, { id: 'day', label: 'DAY' }]);
const FOCUS_KEY = 'neuma.houseCalendar.focus';
const VIEW_KEYS = Object.freeze({ w: 'week', m: 'month', d: 'day' });

// impure — the people the operator focused on, kept across sessions
const readFocus = () => {
  try { return new Set(JSON.parse(localStorage.getItem(FOCUS_KEY) || '[]')); } catch { return new Set(); }
};
const keepFocus = (set) => {
  try { localStorage.setItem(FOCUS_KEY, JSON.stringify([...set])); } catch { /* private mode — the focus lasts the session */ }
};

const rangeOf = (view, anchor) => {
  if (view === 'week') { const days = weekOf(anchor); return { from: days[0], to: days[6], days }; }
  if (view === 'month') { const d = new Date(`${anchor}T00:00:00`); return { ...monthSpan(d.getFullYear(), d.getMonth()), days: [] }; }
  return { from: anchor, to: anchor, days: [anchor] };
};

// the view's range as it heads the calendar: the span large, its frame small
const labelOf = (view, anchor, days) => {
  const fmt = (key, opts) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, opts).toUpperCase();
  if (view === 'week') {
    const sameMonth = days[0].slice(0, 7) === days[6].slice(0, 7);
    return {
      main: sameMonth ? `${fmt(days[0], { month: 'short', day: 'numeric' })} – ${fmt(days[6], { day: 'numeric' })}`
        : `${fmt(days[0], { month: 'short', day: 'numeric' })} – ${fmt(days[6], { month: 'short', day: 'numeric' })}`,
      sub: `WEEK · ${days[6].slice(0, 4)}`,
    };
  }
  if (view === 'month') return { main: fmt(anchor, { month: 'long' }), sub: `MONTH · ${anchor.slice(0, 4)}` };
  return { main: fmt(anchor, { weekday: 'long', day: 'numeric' }), sub: fmt(anchor, { month: 'long', year: 'numeric' }) };
};

/**
 * @param {{onOpenList?: (laneId: string) => void, foot?: import('react').ReactNode}} props
 *   foot — pinned beneath the people rail (the TASKS window's subscribe link)
 */
export const HouseCalendar = ({ onOpenList = null, foot = null }) => {
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(() => dayKeyOf(new Date()));
  const [focus, setFocus] = useState(readFocus);
  const [quick, setQuick] = useState(null);
  const [selected, setSelected] = useState(null);
  const range = rangeOf(view, anchor);
  const { agenda, error, reload, ref } = useHouseAgenda(range);
  // the calendar's own element: the poll watches it, and focus returns to it
  // when the detail closes so the keyboard keeps working
  const root = useRef(null);
  const attach = useCallback((node) => { root.current = node; ref(node); }, [ref]);
  const operatorName = useOperatorName();
  const [monthBox, monthFits] = useMonthFits();
  const now = nowStamp();

  const people = useMemo(
    () => (agenda ? peopleOf(agenda.lanes, [...getRoster(), ...getWitnesses()], operatorName) : []),
    [agenda, operatorName],
  );
  // a focus on someone no longer in the house is no focus at all
  const live = new Set([...focus].filter((id) => people.some((p) => p.id === id)));
  const items = agenda ? focusItems(agenda.items, live) : [];
  const cells = cellsOf(items);
  // the rail counts what the view shows: the week's or the day's days; on the
  // month, real items only (as the month draws them)
  const counted = (agenda?.items || []).filter((i) => (view === 'month' ? !i.projected : range.days.includes(i.day)));
  const counts = countsBy(counted);
  const selectedItem = selected && items.find((i) => i.id === selected);

  const setKept = (next) => { setFocus(next); keepFocus(next); };
  const pickPerson = (id) => { uiSound('tick'); setKept(toggleFocus(live, id)); };
  const clearFocus = () => { uiSound('tick'); setKept(new Set()); };
  const select = (item) => { uiSound('toggle'); setSelected(item.id === selected ? null : item.id); };
  const closeDetail = () => { setSelected(null); root.current?.focus(); };
  const step = (delta) => {
    uiSound('tick');
    if (view === 'month') {
      const d = new Date(`${anchor}T00:00:00`);
      setAnchor(dayKeyOf(new Date(d.getFullYear(), d.getMonth() + delta, 1)));
    } else setAnchor(shiftDayKey(anchor, view === 'week' ? delta * 7 : delta));
  };
  const openDay = (day) => { uiSound('toggle'); setAnchor(day); setView('day'); };
  const today = () => { uiSound('tick'); setAnchor(dayKeyOf(new Date())); };
  // the keyboard, while focus is in the calendar and not in a field
  const onKey = (event) => {
    if (event.target.closest?.('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
    else if (key === 't') today();
    else if (VIEW_KEYS[key]) { uiSound('tick'); setView(VIEW_KEYS[key]); }
    else if (event.key === 'Escape' && selected) closeDetail();
    else return;
    event.preventDefault();
  };

  if (!agenda) {
    return error
      ? <p className="hcal-error label-data">THE CALENDAR IS UNREACHABLE — {String(error).toUpperCase()}</p>
      : <p className="hcal-quiet label-data">READING THE HOUSE…</p>;
  }

  const anchorDate = new Date(`${anchor}T00:00:00`);
  const standing = agenda.standing.filter((s) => inFocus(live, s.lane));
  const personOf = (lane) => people.find((p) => p.id === lane);

  const label = labelOf(view, anchor, range.days);
  // the month shows real items only (a daily on every day would be noise),
  // each day's first few by title in their person's colour
  const monthItems = items.filter((i) => !i.projected);
  const byDay = monthItems.reduce((m, i) => m.set(i.day, [...(m.get(i.day) || []), i]), new Map());
  // the weeks this month has (no all-blank sixth row); they share the height the window gives
  const monthWeeks = buildMonthGrid(anchorDate.getFullYear(), anchorDate.getMonth(), monthItems, { dayKeyOfEntry: (i) => i.day, countSpec: monthCountSpec })
    .filter((week) => week.some((cell) => cell.date !== null));
  const colorOf = (lane) => personOf(lane)?.color || 'var(--line)';

  return (
    // the keys route to the controls inside; nothing here is itself a control
    <div className="hcal" ref={attach} onKeyDown={onKey} tabIndex={-1}>
      {/* the frame lays out what the calendar's width allows (a container
          query styles what is inside its container, never the container) */}
      <div className="hcal-frame">
      <div className="hcal-side">
        <PeopleRail people={people} focus={live} counts={counts} items={agenda.items} now={now} onPick={pickPerson} onClear={clearFocus} />
        {foot ? <div className="hcal-sidefoot">{foot}</div> : null}
      </div>

      <div className="hcal-main">
        <header className="hcal-bar">
          <div className="hcal-range" aria-live="polite">
            <span className="hcal-range-main">{label.main}</span>
            <span className="hcal-range-sub">{label.sub}</span>
          </div>
          <div className="hcal-controls">
            <div className="hcal-views" role="group" aria-label="Calendar view">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" className={`hcal-view${view === v.id ? ' is-on' : ''}`} aria-pressed={view === v.id}
                  onClick={() => { uiSound('tick'); setView(v.id); }}>{v.label}</button>
              ))}
            </div>
            <div className="hcal-nav">
              <button type="button" className="hcal-btn is-icon" aria-label={`Previous ${view}`} onClick={() => step(-1)}>‹</button>
              <button type="button" className="hcal-btn" onClick={today}>TODAY</button>
              <button type="button" className="hcal-btn is-icon" aria-label={`Next ${view}`} onClick={() => step(1)}>›</button>
            </div>
          </div>
        </header>

        <div className="hcal-body">
          {view === 'week' ? (
            <WeekGrid days={range.days} people={people} focus={live} cells={cells} now={now} quick={quick} selectedId={selected}
              onPickDay={openDay} onQuick={setQuick} onAdded={reload} onSelect={select} onFocus={pickPerson} />
          ) : view === 'month' ? (
            <div className="hcal-monthbox" ref={monthBox} style={{ '--weeks': monthWeeks.length }}>
              <MonthCalendar
                year={anchorDate.getFullYear()}
                monthIndex={anchorDate.getMonth()}
                weeks={monthWeeks}
                countLanes={MONTH_COUNT_LANES}
                onPick={openDay}
                onPrevMonth={() => step(-1)}
                onNextMonth={() => step(1)}
                onToday={today}
                head={false}
                emptyLabel="nothing on record"
                renderMarks={(cell) => {
                  const list = byDay.get(cell.key) || [];
                  return [
                    ...list.slice(0, monthFits).map((i) => (
                      <span key={i.id} className="hcal-mini" style={{ '--who': colorOf(i.lane) }}>{i.time ? <b>{i.time}</b> : null}{i.title}</span>
                    )),
                    list.length > monthFits ? <span key="more" className="hcal-mini-more">+{list.length - monthFits}</span> : null,
                  ];
                }}
              />
            </div>
          ) : (
            <DayTimeline day={anchor} items={dayOf(items, anchor)} people={people} now={now} selectedId={selected} onSelect={select} />
          )}
          {view === 'month' ? <p className="hcal-foot">EXPECTED RUNS — DAILIES, WAKES, WATCHES — SHOW IN WEEK AND DAY</p> : null}

          {standing.length ? (
            <details className="hcal-standing">
              <summary>ALWAYS RUNNING <span className="hcal-standing-n">{standing.length}</span></summary>
              <ul>
                {standing.map((s) => (
                  <li key={s.id} className="hcal-standing-line">
                    <span className="hcal-standing-who">{s.lane.toUpperCase()}</span>
                    <span className="hcal-standing-title">{s.title}</span>
                    <span className="hcal-standing-every">{s.every.toUpperCase()}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {agenda.gaps.length ? (
            <p className="hcal-error">COULD NOT READ: {agenda.gaps.map((g) => g.source.toUpperCase()).join(', ')} — THOSE ITEMS ARE MISSING, NOT EMPTY.</p>
          ) : null}
        </div>

        {selectedItem ? (
          <ItemDetail item={selectedItem} person={personOf(selectedItem.lane) || { name: selectedItem.lane, color: 'var(--line)' }} now={now}
            onClose={closeDetail} onOpenList={onOpenList} />
        ) : null}
      </div>
      </div>
    </div>
  );
};
