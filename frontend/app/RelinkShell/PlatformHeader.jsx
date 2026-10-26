// PlatformHeader — a platform window's console head (design-language.md
// § JŌHŌ SEKKEI): who it is and whether it can speak (the mark, the account a
// flight test proved, keys, holder, crew), what is waiting on the operator, what
// goes out next, and the month and the four weeks around today as instruments.
// Every count is a door into the queue (onOpen): a status lights the days that
// hold it on the month; a day opens that day; replies open their board. The fold is platform-pulse.js.

import { BrandMark } from './brand-marks.jsx';
import { untilLabel } from './platform-pulse.js';
import { DayStrip } from './PlatformDayStrip.jsx';
import { dayKeyOf } from './month-grid.js';
import { keysStanding } from './platform-standing.js';
import { StatusMark } from './StatusMark.jsx';

// The KEYS fact as the head names it — the same reading the standing's cell draws.
const KEYS_FACT = Object.freeze({ unset: ['NOT SET', 'hot'], failing: ['FAILING', 'hot'], proven: ['PROVEN', 'live'], set: ['SET', null] });

const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** One state of the platform's standing: a label and its value, toned. */
const Fact = ({ k, v, tone }) => (
  <span className={`pc-fact${tone ? ` is-${tone}` : ''}`}><span className="pc-fact-k">{k}</span>{v}</span>
);

/** One count of the month, a door into the lane that holds it — a post status says itself as its mark. */
const Door = ({ n, label, status, tone, onClick, title }) => (
  <button type="button" className={`pc-door is-${tone}${n ? '' : ' is-zero'}`} onClick={onClick} disabled={!n} title={title}>
    <b>{n}</b>{status ? <StatusMark status={status} named /> : <span>{label}</span>}
  </button>
);

/**
 * @param {{channel: object, test: ?object, holderName: ?string, crewCount: number,
 *   pulse: object, now: number, onOpen: (focus: object) => void, standingOpen: boolean,
 *   onStanding: () => void, compact?: boolean, onWhole?: ?() => void}} props
 *   compact — a short window: the counts only, the four weeks folded away (#585);
 *   onWhole — the door between the folded and the whole head (short windows only)
 */
export const PlatformHeader = ({ channel, test, holderName, crewCount, pulse, now, onOpen, standingOpen, onStanding, compact = false, onWhole = null }) => {
  const m = pulse.month;
  const { state, account } = keysStanding(channel, test);
  const keys = KEYS_FACT[state];
  return (
    <header className={`pc-head${compact ? ' is-compact' : ''}`}>
      <div className="pc-id">
        <span className="pc-mark"><BrandMark id={channel.id} /></span>
        <span className="pc-name">{channel.name}</span>
        {account ? <span className="pc-account">{account}</span> : null}
        <span className="pc-facts">
          <Fact k="KEYS" v={keys[0]} tone={keys[1]} />
          <Fact k="HOLDER" v={holderName ?? 'NONE — NO BEING MAY POST'} tone={holderName ? null : 'hot'} />
          <Fact k="CREW" v={crewCount} />
        </span>
        <button type="button" className={`pc-standing-btn${standingOpen ? ' is-on' : ''}`} aria-expanded={standingOpen} onClick={onStanding}>
          {standingOpen ? 'CLOSE STANDING' : compact ? 'STANDING' : 'HOLDER · KEYS · CREW'}
        </button>
      </div>
      <div className="pc-now">
        <button type="button" className={`pc-await${pulse.awaiting ? ' is-owed' : ''}`} disabled={!pulse.awaiting}
          onClick={() => onOpen({ highlight: 'Q' })}>
          <b>{pulse.awaiting}</b><span>AWAITING YOU</span>
        </button>
        <div className="pc-next">
          <span className="pc-next-k">NEXT OUT</span>
          {pulse.next ? (
            <button type="button" className="pc-next-v" onClick={() => onOpen({ day: dayKeyOf(pulse.next.scheduledFor) })}>
              <b>{untilLabel(pulse.next.scheduledFor, now)}</b> · {when(pulse.next.scheduledFor)}
              <span className="pc-next-text" data-own-words>{String(pulse.next.text || '').slice(0, 90)}</span>
            </button>
          ) : <span className="pc-next-v is-none">nothing approved is scheduled ahead</span>}
        </div>
      </div>
      <div className="pc-month">
        <span className="pc-month-k">THIS MONTH</span>
        <Door n={m.S} status="sent" tone="sent" onClick={() => onOpen({ highlight: 'S' })} />
        <Door n={m.A} status="approved" tone="scheduled" onClick={() => onOpen({ highlight: 'A' })} />
        <Door n={m.Q} status="draft" tone="awaiting" onClick={() => onOpen({ highlight: 'Q' })} />
        <Door n={m.F} status="failed" tone="failed" onClick={() => onOpen({ highlight: 'F' })} />
        <Door n={pulse.repliesAwaiting} label="REPLIES OWED" tone="reply" onClick={() => onOpen({ section: 'replies' })} />
        {pulse.unscheduled ? <Door n={pulse.unscheduled} label="UNSCHEDULED" tone="awaiting" onClick={() => onOpen({ day: null })} /> : null}
        {onWhole ? (
          <button type="button" className="pc-whole" aria-expanded={!compact} onClick={onWhole}>
            {compact ? 'FOUR WEEKS ▾' : 'FOLD ▴'}
          </button>
        ) : null}
      </div>
      {compact ? null : <DayStrip strip={pulse.strip} onDay={(key) => onOpen({ day: key })} />}
    </header>
  );
};
