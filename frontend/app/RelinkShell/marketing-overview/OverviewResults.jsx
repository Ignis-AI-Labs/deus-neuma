// OverviewResults — the bodies of the MARKETING board's ANGLES and POSTS
// panels (campaign plan §5): the ANGLE × ACCOUNT matrix (posts, reach and
// actions per cell; a press narrows the posts to it) and the posts
// themselves. The posts are one table (SDT-3, show-dont-tell audit finding
// 1): a legend row names the trace's window and each number's column once;
// a row is the account it speaks as (AccountMark), where it stands
// (StatusMark), its campaign, angle and group as chips, its own words, and —
// once it went out — its 7-day trace and its numbers under the legend ("—"
// with the reason on hover where a platform does not report). Its address
// and its card are door marks, named on hover. The panel frame and head are
// the board's (BoardPanels.jsx). Pure rendering.

import { uiSound } from '../../../services/ui-sound.js';
import { Trace } from '../hud-instruments.jsx';
import { AccountMark } from '../accounts/AccountMark.jsx';
import { StatusMark } from '../StatusMark.jsx';
import { requestWaitingJump } from '../waiting/waiting-jump.js';
import { DoorButton } from '../doors/DoorButton.jsx';
import { failedPostDoor } from '../doors/failed-post-door.js';
import { num, whyAbsent } from './overview-words.js';

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** ANGLE × ACCOUNT — shaded by actions per 1,000 seen, where both were reported. */
export const AngleMatrix = ({ matrix, onCell, lit }) => {
  const top = Math.max(0, ...matrix.rows.flatMap((r) => r.cells.map((c) => c.per1k || 0)));
  return (
    <table className="mko-matrix" data-mko-matrix>
      <thead><tr><th aria-label="angle" />{matrix.cols.map((a) => <th key={a}><AccountMark accountId={a} /></th>)}</tr></thead>
      <tbody>
        {matrix.rows.map((row) => (
          <tr key={row.angle}>
            <th>{row.angle}</th>
            {row.cells.map((c) => (
              <td key={c.accountId}>
                {c.posts ? (
                  <button type="button" className={`mko-mcell${lit?.angle === row.angle && lit?.accountIds?.[0] === c.accountId ? ' is-lit' : ''}`}
                    style={{ '--mko-shade': top && c.per1k !== null ? (c.per1k / top).toFixed(3) : 0 }}
                    onClick={() => onCell(row.angle, c.accountId)}
                    title={`${c.posts} post(s) · seen ${num(c.reach)} · acted ${num(c.converted)}`}>
                    {c.per1k === null ? '—' : c.per1k.toFixed(1)}
                  </button>
                ) : <span className="mko-none">·</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const METRICS = Object.freeze([['views', 'SEEN'], ['likes', 'LIKES'], ['replies', 'REPLIES'], ['shares', 'SHARES']]);
const LINKED = Object.freeze([['clicked', 'CLICKS', 'clicks through its counted links'], ['converted', 'DOWNLOADS', 'downloads its counted links led to']]);
const COLUMNS = Object.freeze([...METRICS.map(([, name]) => name), ...LINKED.map(([, name]) => name)]);

// When a reading was taken, short: the time today, else the day.
const readWhen = (iso, now) => {
  const t = new Date(iso);
  return now - t.getTime() < 864e5 ? t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : t.toLocaleDateString();
};

// impure — a post that is not out yet (or did not go) opens on its own card, where it is decided.
const openCard = (entry) => {
  uiSound('toggle');
  requestWaitingJump({ where: { app: entry.channelId, channelId: entry.channelId, entryId: entry.id, section: 'posts' } });
};

const CardIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" /><path d="M4.5 6.5 H11.5 M4.5 9.5 H9" />
  </svg>
);

const GroupIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <rect x="2" y="5" width="8" height="8" /><path d="M6 5 V2 H14 V10 H10" />
  </svg>
);

/** A failed post's fix, where a door fixes it: FIX KEYS, HOLDER, TRY AGAIN or REVISE. */
const FailedDoor = ({ entry }) => {
  const fix = failedPostDoor(entry);
  return fix ? <DoorButton door={fix.door} label={fix.label} className="mko-post-fix" /> : null;
};

/** A post's door: its address once it is out, else its card. A mark, named on hover. */
const PostDoor = ({ entry }) => (entry.url
  ? <a className="mko-door" href={entry.url} target="_blank" rel="noreferrer" title="OPEN THE POST" aria-label="OPEN THE POST">↗</a>
  : entry.status === 'sent' ? null
    : <button type="button" className="mko-door" title="OPEN ITS CARD" aria-label="OPEN ITS CARD" onClick={() => openCard(entry)}><CardIcon /></button>);

/** The posts' legend: the trace's window and each number's column, said once. */
const PostsLegend = () => (
  <div className="mko-post mko-post-legend" data-posts-legend>
    <span className="mko-post-main" aria-hidden="true" />
    <span className="mko-col-trace" title="seen over the last 7 days · when it was read · the scale's top">7 DAYS</span>
    {COLUMNS.map((name) => <span key={name} className="mko-col">{name}</span>)}
  </div>
);

// A sent post's numbers, one per legend column; "—" says why on hover.
const Numbers = ({ facts, why }) => [
  ...METRICS.map(([k, name]) => [name, facts.metrics[k], Number.isFinite(facts.metrics[k]) ? name : why]),
  ...LINKED.map(([k, name, what]) => [name, facts[k], facts[k] === null ? 'no counted link in this post' : `${name} — ${what}`]),
].map(([name, v, title]) => <span key={name} className="mko-num" data-col={name} title={title}>{num(v)}</span>);

const PostRow = ({ entry, facts, results, campaign, now }) => {
  const recent = facts.series.filter((s) => now - Date.parse(s.at) <= WEEK);
  const text = String(entry.text || '');
  const read = facts.readAt ? readWhen(facts.readAt, now) : null;
  return (
    <div className={`mko-post is-${entry.status}`} data-post-row={entry.id}>
      <span className="mko-post-main">
        <span className="mko-post-head">
          <AccountMark entry={entry} />
          <StatusMark entry={entry} />
          <span className="mko-chips">
            {campaign ? <i className="mko-chip" title="campaign">{campaign.name}</i> : <i className="mko-chip is-none" title="no campaign">·</i>}
            {entry.pillar ? <i className="mko-chip is-angle" title="angle">{entry.pillar}</i> : null}
            {entry.groupId ? <i className="mko-chip is-group" title={`group ${entry.groupId}`}><GroupIcon />{entry.groupId}</i> : null}
          </span>
          <PostDoor entry={entry} />
        </span>
        <span className="mko-post-text" data-own-words>{text.slice(0, 140)}{text.length > 140 ? '…' : ''}</span>
        {/* A FAILED post: the reason, and its fix door by cause (doors/failed-post-door.js). */}
        {entry.status === 'failed' && entry.error ? <span className="mko-post-failed"><span className="mko-post-error">{entry.error}</span><FailedDoor entry={entry} /></span> : null}
      </span>
      {entry.status === 'sent' ? (
        <>
          <span className="mko-col-trace" title={read ? `seen, the last 7 days · read ${read}` : 'seen, the last 7 days · not read yet — the sweep reads new posts every 6 hours'}>
            <Trace head={false} values={recent.map((s) => s.views)} capacity={Math.max(2, recent.length)} span={read || '—'} unit="" floor={1} />
          </span>
          <Numbers facts={facts} why={whyAbsent(entry, results)} />
        </>
      ) : null}
    </div>
  );
};

/** How many post rows show before SHOW ALL. */
export const SHOWN = 8;

/** The posts of the level and filter: the first eight, then all on SHOW ALL; the legend heads them once any shown went out. */
export const PostRows = ({ rows, factsOf, results, campaigns, now, all }) => {
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <div className="mko-posts">
      <div className="mko-posts-grid">
        {shown.some((e) => e.status === 'sent') ? <PostsLegend /> : null}
        {shown.map((e) => (
          <PostRow key={e.id} entry={e} facts={factsOf(e)} results={results} campaign={campaigns.find((c) => c.id === e.campaignId) || null} now={now} />
        ))}
      </div>
    </div>
  );
};
