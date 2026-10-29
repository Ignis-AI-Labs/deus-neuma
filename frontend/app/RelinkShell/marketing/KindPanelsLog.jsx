// KindPanelsLog — the MARKETING board's panels for what is coming and what
// was done (marketing-panel-plan.md §3, slice 4), each SUBSTRATE's chamfered
// Panel, marks first:
//
//   NEXT 7 DAYS    one lane per platform, a StatusMark per staged post at its
//                  time, today shaded and now ticked; a press opens its card
//   COMPANY WATCH  what changed in one company's repos, newest first: a mark
//                  per kind, its first words, its day, a door to the source
//   CMO LOG        who holds the seat, the mandate, what it did these 7 days
//                  (one mark per act), the asks open, the locked weekly plan
//
// Every count is a door; "—" and every mark say what they are on hover; an
// empty panel is one short line and one door. Rendering over the board's read
// (`b`, MarketingBoard.jsx); impure only in the two reads the panels make
// themselves (use-office-reads.js) and a post's press.

import { useMemo } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { Panel } from '../sub-panel.jsx';
import { StatusMark } from '../StatusMark.jsx';
import { feedKeyOf } from '../post-status-marks.js';
import { requestWaitingJump } from '../waiting/waiting-jump.js';
import { doorPlan } from '../doors/door-plan.js';
import { DoorButton } from '../doors/DoorButton.jsx';
import { weekLanes, cmoLog } from './kinds-fold.js';
import { firstWords } from './platform-fold.js';
import { useWeeklyPlan, useCompanyWatch } from './use-office-reads.js';
import { PlatformName } from './KindPanels.jsx';
import { Empty } from './PanelEmpty.jsx';
import './board-kinds.css';

const pct = (r) => `${(Math.max(0, Math.min(1, r)) * 100).toFixed(2)}%`;
const when = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

// impure — a staged post opens on its own card, where it is decided (the door table's `queue` door).
const openCard = (entry) => {
  uiSound('toggle');
  requestWaitingJump(doorPlan({ kind: 'queue', channelId: entry.channelId, accountId: entry.accountId, entryId: entry.id }).jump);
};

export const WeekPanel = ({ entry, b, tools }) => {
  const w = weekLanes({ accounts: b.levelAccounts, queue: b.data.queue, now: b.now });
  const hint = `staged posts from the start of today, one lane per platform · ◇ awaits you · ○ will go out · press one to open its card${w.unscheduled ? ` · ${w.unscheduled} more await you with no time set` : ''}`;
  return (
    <Panel tools={tools} title="NEXT 7 DAYS" aside={String(w.staged)} span={entry.span} part="next-7-days" hint={hint}>
      {!w.lanes.length ? <Empty line="No account" door="ACCOUNTS" onDoor={() => b.onTab('accounts')} /> : (
        <div className="mkk-week" data-mkk-week style={{ '--mkk-now': pct(w.nowAt) }}>
          <div className="mkk-week-days" aria-hidden="true">
            <span />
            <span className="mkk-week-axis">
              {w.days.map((d) => <span key={d.at} className={`mkk-week-day${d.today ? ' is-today' : ''}`} style={{ left: pct(d.at + 1 / 14) }} title={`${d.word} ${d.date}`}>{d.word}</span>)}
            </span>
          </div>
          {w.lanes.map((lane) => (
            <div key={lane.platform} className="mkk-lane" data-lane={lane.platform}>
              <span className="mkk-lane-name" title={b.names.platforms[lane.platform] || lane.platform}><PlatformName id={lane.platform} b={b} /></span>
              <span className="mkk-lane-track">
                <span className="mkk-today" aria-hidden="true" />
                <span className="mkk-now" aria-hidden="true" />
                {lane.posts.map(({ entry: e, at }) => (
                  <button key={e.id} type="button" className="mkk-week-post" data-week-post={e.id} style={{ left: pct(at) }}
                    title={`${when(e.scheduledFor)} · ${firstWords(e.text, 8)} · open its card`} aria-label={`open its card: ${firstWords(e.text, 8)}`}
                    onClick={() => openCard(e)}>
                    <StatusMark entry={e} />
                  </button>
                ))}
              </span>
            </div>
          ))}
          {w.staged ? null : <Empty line="Nothing staged" door="CAMPAIGNS" onDoor={() => b.onTab('campaigns')} />}
        </div>
      )}
    </Panel>
  );
};

// Each kind of change, by sight.
const WATCH_MARKS = Object.freeze({
  added: ['+', 'added'], changed: ['~', 'changed'], fixed: ['✓', 'fixed'], removed: ['−', 'removed'], security: ['!', 'security'],
  release: ['◆', 'a release note'], commit: ['·', 'a commit'],
});

export const WatchPanel = ({ entry, b, tools }) => {
  const id = entry.scope.company;
  const { ready, watch, error } = useCompanyWatch(id, { stamp: b.data, calm: b.calm });
  const name = b.companies.find((c) => c.id === id)?.name || id;
  const grant = { kind: 'brand', companyId: id, section: 'sources' };
  const body = () => {
    if (error) return <p className="settings-err">{error}</p>;
    if (!watch.listed) return <Empty line="No repo" deskDoor={grant} />;
    return (
      <>
        <span className="mkk-watch-counts" title={`over the last 30 days, in ${watch.repos} repo(s) the CMO may read · ${watch.commits} commit(s)`}>
          {Object.entries(watch.counts).map(([k, n]) => <span key={k} className={`mkk-wk is-${k}`} title={`${n} ${WATCH_MARKS[k][1]}`}><i>{WATCH_MARKS[k][0]}</i>{n}</span>)}
          {watch.unread.length ? (
            <span className="mkk-watch-unread" title={watch.unread.map((u) => `${u.repo}: ${u.why}`).join('\n')}>
              <i aria-hidden="true">▢</i>{watch.unread.length}<DoorButton door={grant} className="mkk-door" />
            </span>
          ) : null}
        </span>
        {watch.rows.length ? (
          <ol className="mkk-watch" data-mkk-watch>
            {watch.rows.map((r) => (
              <li key={`${r.sha}:${r.file || ''}:${r.kind}`} className={`mkk-watch-row is-${r.kind}`} data-watch-row={r.kind}>
                <i className="mkk-wk-mark" title={WATCH_MARKS[r.kind][1]}>{WATCH_MARKS[r.kind][0]}</i>
                <span className="mkk-own" data-own-words title={`${r.line}${r.more ? ` (+${r.more} more)` : ''} · ${r.repo} @ ${r.sha.slice(0, 9)}`}>{firstWords(r.line)}</span>
                <span className="mkk-when">{r.at ? r.at.slice(5, 10) : '—'}</span>
                {r.href ? <a className="mko-door" href={r.href} target="_blank" rel="noreferrer" title="OPEN THE SOURCE" aria-label="OPEN THE SOURCE">↗</a> : null}
              </li>
            ))}
          </ol>
        ) : watch.repos ? <p className="mkb-empty">Nothing changed</p> : null}
      </>
    );
  };
  return (
    <Panel tools={tools} title="WATCH" aside={name} span={entry.span} part={entry.id}
      hint={`what changed in ${name}'s repos the last 30 days, newest first — as the CMO may read them · + added · ~ changed · ✓ fixed · − removed · ! security · ◆ release · · commit`}>
      {watch?.company?.site ? <a className="mko-door mkk-site" href={watch.company.site} target="_blank" rel="noreferrer" title="OPEN THE SITE" aria-label="OPEN THE SITE">↗</a> : null}
      {ready ? body() : null}
    </Panel>
  );
};

// Where the mandate stands, as the mark DONE FOR YOU draws for its own events.
const STANDING = Object.freeze({
  active: ['mandate-granted', 'ON'], paused: ['mandate-tripped', 'PAUSED'], withdrawn: ['mandate-withdrawn', 'OFF'], expired: ['mandate-withdrawn', 'ENDED'], none: ['gone', 'OFF'],
});
const DAY_LETTERS = Object.freeze(['M', 'T', 'W', 'T', 'F', 'S', 'S']);

export const CmoLogPanel = ({ entry, b, tools }) => {
  // Re-read with the window's read, and when a board changes (the CMO's arrangements are counted there).
  const stamp = useMemo(() => ({}), [b.data, b.board]);
  const { plan, board, ready, error } = useWeeklyPlan({ stamp, calm: b.calm });
  const log = cmoLog({ mandate: b.mandate, campaigns: b.data.campaigns, plan, board, now: b.now });
  const seat = () => b.onTab('seat');
  if (!log.seat) {
    return (
      <Panel tools={tools} title="CMO LOG" span={entry.span} part="cmo-log">
        <Empty line="No CMO" door="SEAT" onDoor={seat} />
      </Panel>
    );
  }
  const [mark, word] = STANDING[log.standing] || STANDING.none;
  const firstAsk = log.asks.forYou[0] || log.asks.forCmo[0] || null;
  return (
    <Panel tools={tools} title="CMO LOG" aside={log.seat.name || log.seat.laneId} span={entry.span} part="cmo-log"
      hint="what the CMO did these 7 days and plans next · each act one mark, newest first · ◇ asks for you · ○ asks for the CMO · BOARD: times the CMO laid out the board">
      <div className="mkk-log" data-mkk-log>
        <button type="button" className="mkk-log-row" data-log="mandate" onClick={seat} title="the mandate — open SEAT">
          <span className="hud-label">MANDATE</span><StatusMark status={mark} /><b>{word}</b>
        </button>
        <button type="button" className="mkk-log-row" data-log="acts" onClick={seat}
          title={log.byWhat.length ? `${log.byWhat.map(([w, n]) => `${w} ${n}`).join(' · ')} — DONE FOR YOU in SEAT` : 'nothing done by the mandate these 7 days'}>
          <span className="hud-label">DONE</span><b>{log.acts.length}</b>
          <span className="mkk-acts">{log.acts.slice(0, 14).map((r) => <StatusMark key={r.id} status={feedKeyOf(r)} title={`${r.what}${r.where ? ` · ${r.where}` : ''}`} />)}</span>
        </button>
        <button type="button" className="mkk-log-row" data-log="asks" disabled={!firstAsk} onClick={() => firstAsk && b.onOpenCampaign(firstAsk.campaignId)}
          title={firstAsk ? `open ${firstAsk.campaign}` : 'no ask is open'}>
          <span className="hud-label">ASKS</span>
          <span className="mkk-ask" title={`${log.asks.forYou.length} the CMO asks you`}><StatusMark status="draft" />{log.asks.forYou.length}</span>
          <span className="mkk-ask" title={`${log.asks.forCmo.length} you asked the CMO`}><StatusMark status="approved" />{log.asks.forCmo.length}</span>
        </button>
        <span className="mkk-log-row" data-log="board"
          title={log.board ? `the CMO laid out the board ${log.board.changes} time(s) · last ${String(log.board.lastAt).slice(0, 16).replace('T', ' ')} UTC (${log.board.lastLevel})` : 'the CMO has not laid out the board'}>
          <span className="hud-label">BOARD</span><b>{log.board ? log.board.changes : ready && !error ? 0 : '—'}</b>
        </span>
        <span className="mkk-log-row" data-log="plan" title={log.plan ? `locked ${String(log.plan.approvedAt).slice(0, 10)}` : 'no weekly plan is locked'}>
          <span className="hud-label">PLAN</span>
          {log.plan ? (
            <span className="mkk-plan">{log.plan.days.map((d, i) => (
              <i key={d.day} className={d.posts ? 'is-on' : ''} title={d.theme ? `${d.day}: ${d.theme} — ${d.objective} · ${d.posts} post(s)` : `${d.day}: nothing planned`}>{DAY_LETTERS[i]}</i>
            ))}</span>
          ) : <b>—</b>}
        </span>
      </div>
    </Panel>
  );
};
