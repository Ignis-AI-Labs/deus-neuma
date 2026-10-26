// OverviewPanels — the bodies of the MARKETING board's ACCOUNTS and CAMPAIGN
// panels (campaign plan §5; marketing-panel-plan.md §3): COMPANIES ×
// PLATFORMS (one mark per account, a press narrows the posts to those
// accounts) and one campaign (the goal dial, time against the window, the
// funnel, its subs). The panel frame, title and aside are the board's
// (BoardPanels.jsx); a glyph key lives in the title's hover, never in a
// legend sentence. A campaign says each name once (SDT-3): the KPI's metric
// on one line with its by-date under it, the time as its share → the
// window's end, how many sent posts reported a funnel step as dots, its subs
// as AccountMarks. Pure rendering over the folds; the presses are the parent's.

import { Dial, Bar } from '../hud-instruments.jsx';
import { AccountMark } from '../accounts/AccountMark.jsx';
import { MARK, num, pct } from './overview-words.js';

/** The grid's glyph key, said once — in the ACCOUNTS title's hover. */
export const ACCOUNT_KEY = `${Object.values(MARK).map((m) => `${m.glyph} ${m.words}`).join(' · ')} · · no account — a press narrows the posts to a cell's accounts`;

/** COMPANIES × PLATFORMS — a press on a cell narrows the board's posts to its accounts. */
export const CompanyGrid = ({ grid, channelNames, onCell, lit }) => (
  <table className="mko-grid" data-mko-grid>
    <thead>
      <tr><th aria-label="company" />{grid.platforms.map((p) => <th key={p}>{channelNames[p] || p}</th>)}<th title="active campaigns">ACTIVE</th></tr>
    </thead>
    <tbody>
      {[...grid.rows, ...grid.unsorted].map((row) => (
        <tr key={row.id || 'unsorted'} className={row.id ? '' : 'is-unsorted'}>
          <th style={{ paddingLeft: `${8 + row.depth * 14}px` }}>{row.depth ? '└ ' : ''}{row.name}</th>
          {grid.platforms.map((p) => {
            const cell = row.cells[p];
            const ids = cell.map((c) => c.accountId);
            const on = lit && ids.length && ids.every((id) => lit.includes(id));
            return (
              <td key={p}>
                {cell.length ? (
                  <button type="button" className={`mko-cell${on ? ' is-lit' : ''}`} onClick={() => onCell(ids)} title={cell.map((c) => `${c.accountId}: ${MARK[c.mark].words}`).join('\n')}>
                    {cell.slice(0, 3).map((c) => <i key={c.accountId} className={`mko-mark is-${c.mark}`}>{MARK[c.mark].glyph}</i>)}
                    {cell.length > 3 ? <small>+{cell.length - 3}</small> : null}
                  </button>
                ) : <span className="mko-none">·</span>}
              </td>
            );
          })}
          <td className="mko-active">{row.active}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const FUNNEL = Object.freeze([['reach', 'SEEN'], ['engaged', 'ENGAGED'], ['clicked', 'CLICKED'], ['converted', 'ACTED']]);
// Past this many sent posts the dots would crowd the bar: the fraction says it in numbers.
const MAX_DOTS = 8;

/** What a campaign panel's instruments say, in its title's hover. */
export const CAMPAIGN_KEY = 'the dial: the KPI against its target, → the day it is due · TIME: how far through its window → the window\'s end · SEEN → ENGAGED → CLICKED → ACTED on one axis, each with one dot per sent post, lit for each that reported it · clicks and downloads are counted last click by code · a lit sub has a post staged for the coming 7 days';

/** How many of the sent posts reported a step: one dot per post, lit for each that reported. */
const Reported = ({ n, of }) => (of > MAX_DOTS
  ? <span className="mko-frac">{`${n}/${of}`}</span>
  : (
    <span className="mko-frac" role="img" aria-label={`${n} of ${of}`}>
      {Array.from({ length: of }, (_, i) => <i key={i} className={i < n ? 'is-on' : ''} />)}
    </span>
  ));

/** One campaign: its KPI on a dial, its time on a bar, its funnel on one shared axis, its subs, its OPEN (on the BOARD; the campaign's own page draws it with none). */
export const CampaignBody = ({ card, onOpen }) => {
  const top = Math.max(1, ...FUNNEL.map(([k]) => card.funnel[k].value || 0));
  const kpi = card.kpi;
  const why = kpi && kpi.value === null ? ' · not measured yet: conversions count downloads for a downloads goal; followers are not read' : '';
  return (
    <div className={`mko-campaign is-${card.status}`} data-campaign-card={card.id}>
      <span className="mko-campaign-body">
        {/* Progress, not load: the live tone at every fill (alert is for what cannot wait). */}
        <Dial tone={kpi?.ratio === null || !kpi ? 'idle' : 'live'} label={kpi ? kpi.metric.toUpperCase() : 'NO KPI'} ratio={kpi?.ratio ?? null} value={kpi ? num(kpi.value) : '—'}
          unit={kpi ? `/${num(kpi.target)}` : ''} sub={kpi?.by ? `→ ${kpi.by}` : null}
          title={kpi ? `KPI ${kpi.metric}: ${num(kpi.value)} of ${num(kpi.target)}${kpi.by ? ` by ${kpi.by}` : ''}${why}` : undefined} />
        <span className="mko-campaign-bars">
          <Bar tone={card.time === null ? 'idle' : 'live'} name="TIME" value={card.time === null ? null : card.time * 100} max={100}
            text={card.window ? `${pct(card.time)} → ${card.window.end.slice(5)}` : 'NO WINDOW'} title={card.window ? `${card.window.start} → ${card.window.end}` : undefined} />
          {FUNNEL.map(([k, label]) => (
            <Bar key={k} name={label} value={card.funnel[k].value} max={top} tone={card.funnel[k].value === null ? 'idle' : 'live'}
              text={<>{num(card.funnel[k].value)}{card.funnel[k].of ? <Reported n={card.funnel[k].reporting} of={card.funnel[k].of} /> : null}</>}
              title={`${num(card.funnel[k].value)} — reported by ${card.funnel[k].reporting} of ${card.funnel[k].of} sent post(s)`} />
          ))}
        </span>
      </span>
      <span className="mko-campaign-foot">
        <span className="mko-subs">
          {card.subs.length ? card.subs.map((s) => (
            <i key={s.accountId} className={s.staged ? 'is-on' : ''}>
              <AccountMark accountId={s.accountId} note={s.staged ? 'staged for the coming 7 days' : 'nothing staged for the coming 7 days'} />
            </i>
          )) : <i>NO SUBS</i>}
        </span>
        {onOpen ? <button type="button" className="settings-set mko-open" onClick={() => onOpen(card.id)}>OPEN</button> : null}
      </span>
    </div>
  );
};
