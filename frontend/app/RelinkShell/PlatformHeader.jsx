// PlatformHeader — a platform window's console head (design-language.md
// § JŌHŌ SEKKEI): who it is and whether it can speak (the mark, the account a
// flight test proved, keys, holder, crew), what is waiting on the operator, what
// goes out next, and the month and the four weeks around today as instruments.
// Every count is a door into the queue (onOpen): a status lights the days that
// hold it on the month; a day opens that day; replies open their board. The fold is platform-pulse.js.

import { BrandMark } from './brand-marks.jsx';
import { STRIP_BEFORE, untilLabel } from './platform-pulse.js';
import { dayKeyOf } from './month-grid.js';

const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** One state of the platform's standing: a label and its value, toned. */
const Fact = ({ k, v, tone }) => (
  <span className={`pc-fact${tone ? ` is-${tone}` : ''}`}><span className="pc-fact-k">{k}</span>{v}</span>
);

/** One count of the month, a door into the lane that holds it. */
const Door = ({ n, label, tone, onClick, title }) => (
  <button type="button" className={`pc-door is-${tone}${n ? '' : ' is-zero'}`} onClick={onClick} disabled={!n} title={title}>
    <b>{n}</b><span>{label}</span>
  </button>
);

/** The four weeks around today: one column per day, stacked by status, scaled to the busiest day. */
const DayStrip = ({ strip, onDay }) => {
  const total = (c) => c.S + c.A + c.Q + c.F + c.R;
  const max = Math.max(1, ...strip.map((d) => total(d.counts)));
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
            onClick={() => onDay(d.key)}
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

/**
 * @param {{channel: object, test: ?object, holderName: ?string, crewCount: number,
 *   pulse: object, now: number, onOpen: (focus: object) => void, standingOpen: boolean,
 *   onStanding: () => void}} props
 */
export const PlatformHeader = ({ channel, test, holderName, crewCount, pulse, now, onOpen, standingOpen, onStanding }) => {
  const m = pulse.month;
  const account = test?.ok === true && test.account?.name ? `@${test.account.name}` : null;
  const keys = !channel.configured ? ['NOT SET', 'hot'] : test?.ok === true ? ['PROVEN', 'live'] : test?.ok === false ? ['FAILING', 'hot'] : ['SET', null];
  return (
    <header className="pc-head">
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
          {standingOpen ? 'CLOSE STANDING' : 'HOLDER · KEYS · CREW'}
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
              <span className="pc-next-text">{String(pulse.next.text || '').slice(0, 90)}</span>
            </button>
          ) : <span className="pc-next-v is-none">nothing approved is scheduled ahead</span>}
        </div>
      </div>
      <div className="pc-month">
        <span className="pc-month-k">THIS MONTH</span>
        <Door n={m.S} label="SENT" tone="sent" onClick={() => onOpen({ highlight: 'S' })} />
        <Door n={m.A} label="SCHEDULED" tone="scheduled" onClick={() => onOpen({ highlight: 'A' })} />
        <Door n={m.Q} label="AWAITING" tone="awaiting" onClick={() => onOpen({ highlight: 'Q' })} />
        <Door n={m.F} label="FAILED" tone="failed" onClick={() => onOpen({ highlight: 'F' })} />
        <Door n={pulse.repliesAwaiting} label="REPLIES OWED" tone="reply" onClick={() => onOpen({ section: 'replies' })} />
        {pulse.unscheduled ? <Door n={pulse.unscheduled} label="UNSCHEDULED" tone="awaiting" onClick={() => onOpen({ day: null })} /> : null}
      </div>
      <DayStrip strip={pulse.strip} onDay={(key) => onOpen({ day: key })} />
    </header>
  );
};
