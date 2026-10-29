// MonthMarks — an account's month as ONE count strip (show-dont-tell audit,
// finding 10 and the account level's ask: the month drawn once, not twice):
// each status of the month as its StatusMark and its count, named on hover,
// then the replies owed and the posts with no day. Each count is a door: a
// status lights the days that hold it on the queue's month (again clears),
// the replies open their board, the undated their bucket. A zero is drawn,
// quiet, and presses nothing.
//
// pure rendering — the presses are the caller's.

import { StatusMark } from '../StatusMark.jsx';

// The month's statuses in the queue's own letters (queue-calendar.js countInto), with the strip's tone.
const STATUSES = Object.freeze([['S', 'sent', 'sent'], ['A', 'approved', 'scheduled'], ['Q', 'draft', 'awaiting'], ['F', 'failed', 'failed']]);

const ReplyGlyph = () => (
  <svg className="amm-glyph" width="14" height="14" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <path d="M7 4 L2.5 8.5 L7 13 M2.5 8.5 H11 C14 8.5 15.5 10.5 15.5 14" />
  </svg>
);

const UndatedGlyph = () => (
  <svg className="amm-glyph" width="14" height="14" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <rect x="2.5" y="3.5" width="13" height="12" /><path d="M2.5 7 H15.5 M6 9.5 L12 13.5" />
  </svg>
);

const Count = ({ n, tone, title, lit, onClick, children }) => (
  <button type="button" className={`amm-n is-${tone}${n ? '' : ' is-zero'}${lit ? ' is-lit' : ''}`} disabled={!n}
    aria-pressed={lit} title={title} onClick={onClick}>
    {children}<b>{n}</b>
  </button>
);

/**
 * @param {{month: {S: number, A: number, Q: number, F: number}, replies: number, unscheduled: number,
 *   label: string, lit: ?string, onOpen: (focus: object) => void}} props
 *   label — the month's name; lit — the status letter lighting the queue's days (null: none)
 */
export const MonthMarks = ({ month, replies, unscheduled, label, lit, onOpen }) => (
  <span className="amm" role="group" aria-label={`${label}, by status`}>
    <span className="amm-k">{label}</span>
    {STATUSES.map(([k, status, tone]) => (
      <Count key={k} n={month[k]} tone={tone} lit={lit === k} title={`${month[k]} ${status === 'draft' ? 'awaiting you' : status === 'approved' ? 'scheduled' : status} this month — lights their days`}
        onClick={() => onOpen({ highlight: lit === k ? null : k })}>
        <StatusMark status={status} />
      </Count>
    ))}
    <Count n={replies} tone="reply" title={`${replies} replies owed`} onClick={() => onOpen({ section: 'replies' })}><ReplyGlyph /></Count>
    {unscheduled ? <Count n={unscheduled} tone="awaiting" title={`${unscheduled} with no day yet`} onClick={() => onOpen({ day: null })}><UndatedGlyph /></Count> : null}
  </span>
);
