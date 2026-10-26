// AccountHead — MARKETING's ACCOUNT level head (show-dont-tell-audit.md,
// SDT-6): one row says who the account is (its AccountMark), whether it can
// speak (KEYS · HOLDER · CREW as marks, each a door when not fine) and what
// goes out next (a countdown mark, '—' when nothing is scheduled); then the
// month as one count strip; then the four weeks around today, as they were
// (the inventory). What waits on the operator is the band above it, said once.
// COMMUNITY's own windows keep their console head (PlatformHeader.jsx).
//
// pure rendering — the reads and presses are PlatformSpace's.

import { AccountMark } from '../accounts/AccountMark.jsx';
import { BrandMark } from '../brand-marks.jsx';
import { CountdownMark } from '../CountdownMark.jsx';
import { DayStrip } from '../PlatformDayStrip.jsx';
import { dayKeyOf } from '../month-grid.js';
import { aheadOf } from '../queue-when.js';
import { keysStanding } from '../platform-standing.js';
import { StandingMarks } from './StandingMarks.jsx';
import { MonthMarks } from './MonthMarks.jsx';
import { keysMark, holderMark, crewMark } from './standing-marks.js';
import './account-head.css';

const MONTH_LABEL = Object.freeze(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']);

/**
 * @param {{channel: object, accountId: ?string, account: ?object, test: ?object,
 *   standing: {roster: object[], crew: object[], holder: ?{cmo: ?object}, channel: object}, read: boolean,
 *   pulse: object, now: number, lit: ?string, onOpen: (focus: object) => void,
 *   drawer: ?string, onDrawer: (d: ?string) => void, compact?: boolean, onWhole?: ?() => void}} props
 *   account — the house's record of this account (its binding); read — the house's accounts have answered
 */
export const AccountHead = ({ channel, accountId, account, test, standing, read, pulse, now, lit, onOpen, drawer, onDrawer, compact = false, onWhole = null }) => {
  // The flight test proves the platform's first account; another account's handle is its own record's.
  const proven = accountId === `${channel.id}-1` ? keysStanding(channel, test).account : null;
  const next = pulse.next ? aheadOf(pulse.next.scheduledFor, now) : null;
  const nextTitle = pulse.next ? `next out · ${String(pulse.next.text || '').slice(0, 90)}` : undefined;
  return (
    <header className={`pc-head is-account${compact ? ' is-compact' : ''}`}>
      <div className="ah-id">
        {accountId ? <AccountMark accountId={accountId} handle={proven} door={false} />
          : <span className="acm" title={`${channel.name} · no account yet`}><BrandMark id={channel.id} /><span className="acm-name">{channel.name}</span></span>}
        <StandingMarks keys={keysMark(channel, test, accountId)} drawer={drawer} onDrawer={onDrawer} picks={Boolean(accountId)}
          holder={holderMark({
            account, roster: standing.roster, cmo: standing.holder?.cmo ?? null, read: read && Boolean(standing.holder),
            // The platform's first account (or the one its keys will open) is the one the window binds the CMO to.
            awaitingKeys: (!accountId || accountId === `${channel.id}-1`) && standing.holder?.state === 'awaiting-keys',
          })}
          crew={crewMark(standing.crew, standing.roster, channel.name)} />
        {next ? (
          <button type="button" className="ah-next" title={nextTitle} onClick={() => onOpen({ day: dayKeyOf(pulse.next.scheduledFor) })}>
            <CountdownMark ahead={next} />
          </button>
        ) : <span className="ah-next"><CountdownMark ahead={null} none="nothing approved is scheduled ahead" /></span>}
      </div>
      <div className="ah-month">
        <MonthMarks month={pulse.month} replies={pulse.repliesAwaiting} unscheduled={pulse.unscheduled}
          label={MONTH_LABEL[new Date(now).getMonth()]} lit={lit} onOpen={onOpen} />
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
