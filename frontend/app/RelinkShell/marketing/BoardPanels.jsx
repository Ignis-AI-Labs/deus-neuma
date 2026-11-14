// BoardPanels — each kind of panel the MARKETING board is built from
// (marketing-panel-plan.md §3), as SUBSTRATE's chamfered Panel on the
// 12-column grid: COMPANIES (the tiles), one CAMPAIGN per campaign, ACCOUNTS,
// ANGLES, POSTS and the SITE COUNTER here; PLATFORM, TOP POSTS and FUNNEL in
// KindPanels.jsx; NEXT 7 DAYS, COMPANY WATCH and CMO LOG in KindPanelsLog.jsx. A head is a short title and an aside;
// a glyph key is the title's hover; an empty panel is one short line and one
// door; the title row ends in the panel's marks and its ⋯ menu (`tools`).
// Pure rendering — every press is the board's.

import { Panel } from '../sub-panel.jsx';
import { CompanyTiles } from './CompanyTiles.jsx';
import { paceOf } from './marketing-health.js';
import { CompanyGrid, CampaignBody, ACCOUNT_KEY, CAMPAIGN_KEY } from '../marketing-overview/OverviewPanels.jsx';
import { AngleMatrix, PostRows, SHOWN } from '../marketing-overview/OverviewResults.jsx';
import { SiteCounterRow, COUNTER_KEY } from '../marketing-overview/SiteCounterRow.jsx';
import { MARK } from '../marketing-overview/overview-words.js';
import { Empty } from './PanelEmpty.jsx';
import { PlatformPanel, TopPostsPanel, FunnelPanel } from './KindPanels.jsx';
import { WeekPanel, WatchPanel, CmoLogPanel } from './KindPanelsLog.jsx';

const TILE_KEY = `ACCOUNTS: ${Object.values(MARK).map((m) => `${m.glyph} ${m.words}`).join(' · ')} · ACTIVE: one segment per campaign, lit while active, then active of all · ◆ waits on you there: ◇ posts to decide · asks · ▲ failed sends · press a company to zoom in`;
const PACE = Object.freeze({ on: ['ok', 'on pace: its KPI is at least as far along as its time'], behind: ['warm', 'behind: its KPI is less far along than its time'] });


const TilesPanel = ({ entry, b, tools }) => (
  <Panel tools={tools} title={entry.scope.companyId ? 'SUBSIDIARIES' : 'COMPANIES'} aside={String(b.tiles.filter((t) => t.id).length)} span={entry.span} part="tiles" hint={TILE_KEY}>
    <CompanyTiles tiles={b.tiles} litLoose={b.litLoose} onZoom={b.onZoom} onLoose={b.onLoose} />
  </Panel>
);

/**
 * One campaign as a panel — the same on the BOARD and on CAMPAIGNS (Founder
 * 2026-11-12: […]): its
 * name, company, goal and pace at the head; its KPI, time, funnel, the
 * accounts it runs on and OPEN below.
 * @param {{card: object, companies: object[], onOpen?: (id: string) => void, span: number, tools?: object, nameOpens?: boolean}} props
 *   nameOpens — its name is itself the press that opens it (CAMPAIGNS' list)
 */
export const CampaignCardPanel = ({ card, companies, onOpen, span, tools = null, nameOpens = false }) => {
  const pace = card.status === 'active' ? PACE[paceOf(card)] || ['unknown', 'not measured: no KPI reading or no window'] : null;
  const company = companies.find((x) => x.id === card.companyId)?.name || 'NO COMPANY';
  const aside = [company, card.goal ? card.goal.kind.toUpperCase() : null, card.status === 'active' ? null : card.status.toUpperCase(),
    card.asksForYou ? `◆ ${card.asksForYou} ASK${card.asksForYou === 1 ? '' : 'S'}` : null].filter(Boolean).join(' · ');
  return (
    <Panel tools={tools} aside={aside} span={span} part={`campaign:${card.id}`} level={pace?.[0]}
      title={nameOpens && onOpen
        ? <button type="button" className="mkc-name" data-campaign-row={card.id} onClick={() => onOpen(card.id)}>{card.name}</button>
        : card.name}
      hint={`${pace ? `${pace[1]} · ` : ''}${CAMPAIGN_KEY}`}>
      <CampaignBody card={card} onOpen={onOpen} />
    </Panel>
  );
};

const CampaignPanel = ({ entry, b, tools }) => {
  const card = b.view.cards.find((c) => c.id === entry.scope.campaignId);
  if (!card) {
    return (
      <Panel tools={tools} title="CAMPAIGNS" span={entry.span} part="campaign:none">
        <Empty line="No campaign" door="CAMPAIGNS" onDoor={() => b.onTab('campaigns')} />
      </Panel>
    );
  }
  return <CampaignCardPanel card={card} companies={b.companies} onOpen={b.onOpenCampaign} span={entry.span} tools={tools} />;
};

const AccountsPanel = ({ entry, b, tools }) => {
  const { grid } = b.view;
  const optional = entry.scope.companyId ? 0 : b.data.check?.house?.optional || 0;
  return (
    <Panel tools={tools} title="ACCOUNTS" aside={optional ? `${optional} OPTIONAL` : null} span={entry.span} part="accounts" hint={ACCOUNT_KEY}>
      {grid.rows.length + grid.unsorted.length === 0 ? <Empty line="No company, no account" door="ACCOUNTS" onDoor={() => b.onTab('accounts')} /> : (
        <div className="mkb-scroll">
          <CompanyGrid grid={grid} channelNames={b.channelNames} onCell={(ids) => b.toggle({ accountIds: ids })} lit={b.filter.accountIds || null} />
        </div>
      )}
    </Panel>
  );
};

const AnglesPanel = ({ entry, b, tools }) => (
  <Panel tools={tools} title="ANGLES × ACCOUNTS" aside="PER 1,000 SEEN" span={entry.span} part="angles"
    hint="actions per 1,000 seen, where a platform reported both · — = not reported · a press narrows the posts to that angle and account">
    {b.view.matrix.rows.length ? (
      <div className="mkb-scroll">
        <AngleMatrix matrix={b.view.matrix} lit={b.filter} onCell={(angle, accountId) => b.toggle({ angle, accountIds: [accountId] })} />
      </div>
    ) : <Empty line="No sent post names an angle" door="CAMPAIGNS" onDoor={() => b.onTab('campaigns')} />}
  </Panel>
);

const PostsPanel = ({ entry, b, tools }) => {
  const { rows, total } = b.view;
  const shown = Math.min(rows.length, b.all ? rows.length : SHOWN);
  return (
    <Panel tools={tools} title="POSTS" aside={`${shown}/${rows.length}${rows.length !== total ? ` · ${total} IN ALL` : ''}`} span={entry.span} part="posts"
      hint="newest first · shown of the posts here · ↗ opens a post that went out · the card mark opens a post not out yet on its own card, where it is decided">
      {b.showing || rows.length > SHOWN ? (
        <span className="mkb-posts-bar">
          {b.showing ? <button type="button" className="mko-link" data-showing onClick={() => b.toggle({})}>SHOWING {b.showing} · SHOW ALL</button> : null}
          {rows.length > SHOWN ? <button type="button" className="mko-link" onClick={b.onAll}>{b.all ? 'SHOW FEWER' : `SHOW ALL ${rows.length}`}</button> : null}
        </span>
      ) : null}
      {rows.length ? <PostRows rows={rows} factsOf={b.view.factsOf} results={b.data.results} campaigns={b.data.campaigns} now={b.now} all={b.all} />
        : <Empty line={b.showing ? 'No post matches' : 'No post'} door={b.showing ? null : 'CAMPAIGNS'} onDoor={() => b.onTab('campaigns')} />}
    </Panel>
  );
};

const LinksPanel = ({ entry, b, tools }) => (
  <Panel tools={tools} title="SITE COUNTER" aside={b.data.site?.root?.replace(/^https?:\/\//, '') || null} span={entry.span} part="links" hint={COUNTER_KEY}>
    <SiteCounterRow site={b.data.site} links={b.data.links} onChanged={b.refresh} />
  </Panel>
);

const KINDS = Object.freeze({
  tiles: TilesPanel, campaign: CampaignPanel, accounts: AccountsPanel, angles: AnglesPanel, posts: PostsPanel, links: LinksPanel,
  platform: PlatformPanel, 'top-posts': TopPostsPanel, funnel: FunnelPanel, 'next-7-days': WeekPanel, 'company-watch': WatchPanel, 'cmo-log': CmoLogPanel,
});

/**
 * One board entry as its panel.
 * @param {{entry: {kind: string, span: number, scope: object}, b: object, tools?: object}} props - `b`: the board's view,
 *   reads and presses; `tools`: the panel's marks and ⋯ menu (PanelTools.jsx)
 */
export const BoardPanel = ({ entry, b, tools }) => {
  const Kind = KINDS[entry.kind];
  return Kind ? <Kind entry={entry} b={b} tools={tools} /> : null;
};
