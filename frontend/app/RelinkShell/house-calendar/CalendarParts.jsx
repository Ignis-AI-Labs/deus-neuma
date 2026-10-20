// CalendarParts — the house calendar's small pieces: one scheduled item as it
// reads in a cell or on the day's line (a button that opens its detail), a
// person's dot, the detail card, and the quick-add form that puts a task on
// someone's day. The task is written where tasks
// live (the operator's list or the member's standing work) — the calendar
// only shows it back.
import { useState } from 'react';
import { addMineTask, addNeumaTask } from '../todo-client.js';
import { toneOf, spanOf, kindOf, quickAddWakes } from './calendar-view.js';

const TONE_WORD = Object.freeze({ overdue: 'OVERDUE', done: 'DONE', past: 'PAST', held: 'WAITS FOR QUIET HOURS', projected: 'EXPECTED' });

export const Dot = ({ color, title = undefined }) => (
  <i className="hcal-dot" style={{ background: color }} title={title} aria-hidden={title ? undefined : true} />
);

/** One scheduled item: its time, its title, its tone — and its person's colour on the edge. */
export const AgendaItem = ({ item, now, color, wide = false, selected = false, onSelect }) => {
  const tone = toneOf(item, now);
  // on the day's line the time already has its own column; only a span
  // (start to end) adds anything there
  const span = wide && !item.endTime && !item.endDay ? '' : spanOf(item);
  // a stack of repeats (three meditations) reads once: its first time and how many
  const times = item.times?.filter(Boolean) || [];
  const stacked = times.length > 1;
  return (
    <button
      type="button"
      className={`hcal-item is-${tone}${wide ? ' is-wide' : ''}${selected ? ' is-selected' : ''}`}
      style={{ '--who': color }}
      title={[kindOf(item), stacked ? times.join(' · ') : span, item.title, TONE_WORD[tone]].filter(Boolean).join(' · ')}
      aria-pressed={selected}
      onClick={() => onSelect?.(item)}
    >
      {span || item.channel || stacked ? (
        <span className="hcal-meta">
          {span ? <span className="hcal-time">{stacked ? times[0] : span}</span> : null}
          {item.channel ? <span className="hcal-chan">{item.channel.toUpperCase()}</span> : null}
          {stacked ? <span className="hcal-times">×{times.length}</span> : null}
        </span>
      ) : null}
      <span className="hcal-title">{item.title}</span>
      {wide && TONE_WORD[tone] ? <span className="hcal-tone label-data">{TONE_WORD[tone]}</span> : null}
    </button>
  );
};

const longDay = (key) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
const LISTED = Object.freeze(['operator', 'neuma', 'witness']);

/** One item, in full: what, whose, when, its standing — and the way to its list. */
export const ItemDetail = ({ item, person, now, onClose, onOpenList }) => {
  const tone = toneOf(item, now);
  const span = spanOf(item);
  const note = tone === 'projected' ? 'EXPECTED — worked out from its rhythm; not on record yet'
    : tone === 'held' ? `WAITS — falls inside ${item.held}` : null;
  return (
    <aside className="hcal-detail" aria-label="Scheduled item" style={{ '--who': person.color }}>
      <div className="hcal-detail-head">
        <span className="label-data hcal-detail-kind">{kindOf(item)}{item.list ? ` · ${item.list}` : ''}</span>
        <button type="button" className="hcal-quick-x" onClick={onClose} aria-label="Close the detail">×</button>
      </div>
      <p className="hcal-detail-title">{item.title}</p>
      <dl className="hcal-detail-facts">
        <dt>WHOSE</dt><dd><Dot color={person.color} />{person.name}</dd>
        <dt>WHEN</dt><dd>{longDay(item.day)}{item.times?.length > 1 ? ` · ${item.times.join(' · ')}` : span ? ` · ${span}` : ' · ALL DAY'}</dd>
        {item.channel ? <><dt>CHANNEL</dt><dd>{item.channel.toUpperCase()}</dd></> : null}
        {item.status ? <><dt>STATUS</dt><dd>{(TONE_WORD[tone] || item.status).toUpperCase()}</dd></> : null}
      </dl>
      {note ? <p className="hcal-quiet label-data">{note}</p> : null}
      {item.source === 'task' && LISTED.includes(person.kind) && onOpenList ? (
        <button type="button" className="hcal-btn" onClick={() => onOpenList(person.id)}>OPEN {person.name}'S LIST</button>
      ) : null}
    </aside>
  );
};

/**
 * Put a one-shot task on a person's day — the operator's own list, or the
 * member's standing work: a start and an end make it a time block, an end
 * alone a deadline, neither an all-day task. It says, as the times are typed,
 * whether the task will wake anyone. impure — network.
 */
export const QuickAdd = ({ person, day, onDone, onCancel }) => {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    if (!title.trim()) return;
    if (start && !time) { setErr('A BLOCK NEEDS ITS END TIME'); return; }
    if (start && time <= start) { setErr('THE END COMES AFTER THE START'); return; }
    setBusy(true);
    setErr('');
    const fields = { title: title.trim(), cadence: 'once', dueDate: day, ...(time ? { dueTime: time } : {}), ...(start ? { startTime: start } : {}) };
    try {
      await (person.kind === 'operator' ? addMineTask(fields) : addNeumaTask(person.id, fields));
      onDone();
    } catch (error) {
      setErr(error?.message || 'COULD NOT ADD');
      setBusy(false);
    }
  };
  return (
    <form className="hcal-quick" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <input
        className="hcal-input hcal-quick-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={`Task for ${person.name}`}
        aria-label={`New task for ${person.name} on ${day}`}
        autoFocus
        maxLength={200}
      />
      <input className="hcal-input hcal-quick-time" type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time (optional — with an end, a block)" />
      <span className="hcal-quick-to" aria-hidden="true">→</span>
      <input className="hcal-input hcal-quick-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="End or due time (optional)" />
      <button type="submit" className="hcal-btn" disabled={busy || !title.trim()}>{busy ? '…' : 'ADD'}</button>
      <button type="button" className="hcal-quick-x" onClick={onCancel} aria-label="Cancel">×</button>
      <span className="hcal-quick-wakes" data-wakes={person.wakes && (start || time) ? 'yes' : 'no'}>{quickAddWakes(person, { start, time })}</span>
      {err ? <span className="hcal-error">{err}</span> : null}
    </form>
  );
};
