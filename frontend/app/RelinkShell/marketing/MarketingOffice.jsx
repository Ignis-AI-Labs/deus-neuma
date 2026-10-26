// MarketingOffice — the MARKETING window: the CMO's office, zoomed down the
// company tree (marketing-panel-plan.md §2, slice 1). The path at the head
// says where the operator stands (HOUSE › company › subsidiary …) and takes
// them back up; one level shows at a time, on the same tabs at every level,
// each narrowed to that level's subtree:
//
//   BOARD      the health strip, then the level's panels on the 12-column
//              grid (MarketingBoard.jsx): the tiles (top-level companies at
//              HOUSE, subsidiaries under a company — press one to zoom in),
//              one panel per campaign, accounts, angles, posts, site counter
//   CAMPAIGNS  the campaign board; a campaign's page opens in place
//   ACCOUNTS   the social check
//   BRAND      the brand kit (a company is its kit)
//   LEADS      the lead ledger (the house's one book)
//   SEAT       the CMO and the MANDATE — the house's alone
//
// The deepest level is one platform ACCOUNT (account-level.js): the
// platform's space narrowed to it (PlatformSpace: console head, standing,
// account board, queue). Every AccountMark, a PLATFORM panel's title, a NEXT
// 7 DAYS lane and an ACCOUNTS card open it; so does any old platform window's
// id (retired-windows.js), and a post's card or a STANDING drawer lands there.
//
// A card's landing (a campaign card's OPEN, a WAITING ON YOU row) zooms to
// the campaign's company and opens its page; a landing that names no
// campaign (a paused mandate) opens SEAT. The last place is remembered per
// house (zoom-memory.js). READ NOW stands beside the path on the BOARD.
//
// impure — the one read, the landing latch, the remembered place.

import { useEffect, useMemo, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { takeCardLanding, onCardLanding } from '../card-landing.js';
import { useCalmGate } from '../use-calm-gate.js';
import { useMarketingOverview } from '../marketing-overview/use-marketing-overview.js';
import { subtreeOf } from '../marketing-overview/overview-fold.js';
import { MarketingBoard } from './MarketingBoard.jsx';
import { useReadNow } from './use-read-now.js';
import { CampaignsSection } from '../CampaignsSection.jsx';
import { SocialCheckApp } from '../social-check/SocialCheckApp.jsx';
import { BrandKitsSection } from '../brandkits/BrandKitsSection.jsx';
import { LeadsSection } from '../LeadsSection.jsx';
import { MandatePanel } from '../mandate/MandatePanel.jsx';
import { PlatformSpace } from '../PlatformSpace.jsx';
import { accountLanding, accountCrumb } from './account-level.js';
import { HOUSE, TABS, settlePlace, pathOf, houseTiles, childTiles, landingPlace } from './zoom-fold.js';
import { readZoom, writeZoom } from './zoom-memory.js';
import { ZoomPath, OfficeTabs } from './ZoomPath.jsx';
import { CmoRow } from './CmoRow.jsx';
import './MarketingOffice.css';

const sameIds = (a, b) => Boolean(a && b) && a.length === b.length && a.every((id) => b.includes(id));

export const MarketingOffice = () => {
  const calm = useCalmGate();
  const read = useMarketingOverview({ calm });
  const { data, companies, accounts, known, houseError } = read;
  const [place, setPlace] = useState(() => ({ ...HOUSE, ...(readZoom() || {}) }));
  const [landing, setLanding] = useState(() => takeCardLanding('marketing'));
  const [filter, setFilter] = useState({});
  // What a landing opens on the account level (a post's card, a STANDING drawer), numbered per landing.
  const [focus, setFocus] = useState({ n: 0 });
  const reading = useReadNow(read.refresh);

  // A landing waits for the bench (its campaign's company), the house's companies and accounts — and a
  // post's landing for the queue (the account it speaks as) — then puts the operator there.
  useEffect(() => onCardLanding('marketing', setLanding), []);
  useEffect(() => {
    if (!known || !landing) return;
    const at = landing.account ? accountLanding(landing, { accounts, companies, queue: data?.queue ?? null }) : null;
    const to = landing.account ? at?.place : landingPlace(landing, data?.campaigns ?? null);
    if (!to) return;
    setPlace(to);
    setFilter({});
    setFocus((f) => ({ ...(at?.focus || {}), n: f.n + 1 }));
    setLanding(null);
  }, [landing, data, known, accounts, companies]);

  // Until the house's companies are read, the remembered place stands as it is (never dropped as unknown);
  // a failed read never overwrites it.
  const here = known ? settlePlace(place, companies, accounts) : place;
  const accountKey = here.account ? `${here.account.channelId}:${here.account.accountId || ''}` : '';
  useEffect(() => { if (known && !houseError) writeZoom(here); }, [known, houseError, here.companyId, here.tab, accountKey]);

  const scope = useMemo(() => (here.companyId ? subtreeOf(companies, here.companyId) : null), [companies, here.companyId]);
  const tiles = useMemo(() => {
    if (!data) return [];
    const house = { companies, accounts, check: data.check, campaigns: data.campaigns, queue: data.queue };
    return here.companyId ? childTiles(here.companyId, house) : houseTiles(house);
  }, [data, companies, accounts, here.companyId]);

  const go = (next) => { uiSound('toggle'); setPlace(next); setFilter({}); };
  const zoom = (companyId) => go({ companyId, tab: 'board', campaignId: null });
  const openCampaign = (campaignId) => setLanding({ campaignId });
  const narrow = (accountIds) => { uiSound('toggle'); setFilter((f) => (sameIds(f.accountIds, accountIds) ? {} : { accountIds })); };
  const tab = (next) => go({ ...here, tab: next, campaignId: null, account: null });

  const body = {
    board: (
      <MarketingBoard read={read} scope={scope} companyId={here.companyId} tiles={tiles} filter={filter} onFilter={setFilter} reading={reading}
        onOpenCampaign={openCampaign} onTab={tab} onZoom={zoom} onLoose={narrow} calm={calm} />
    ),
    campaigns: (
      <CampaignsSection channelId={null} calm={calm} scope={scope} companyId={here.companyId || ''} read={read}
        selectedId={here.campaignId} onSelect={(campaignId) => setPlace({ ...here, campaignId })} />
    ),
    accounts: <SocialCheckApp scope={scope} />,
    brand: <BrandKitsSection key={here.companyId || 'house'} brand={here.companyId} />,
    leads: (
      <>
        {here.companyId ? <p className="mkt-whole" title="leads carry no company; the ledger is the house's one book">LEADS · WHOLE HOUSE</p> : null}
        <LeadsSection />
      </>
    ),
    seat: (
      <section className="settings-sec" data-mkt-seat>
        <CmoRow />
        <MandatePanel />
      </section>
    ),
  };

  // The path names companies, so nothing is drawn until the house's companies are read.
  if (!known) return <div className="mkt" data-marketing-office><p className="settings-note">Reading the house&rsquo;s companies…</p></div>;
  const { account } = here;
  return (
    <div className="mkt" data-marketing-office {...calm.handlers}>
      {houseError ? <p className="settings-err">Could not read the house&rsquo;s companies: {houseError}</p> : null}
      <div className="mkt-head">
        <div className="mkt-pathrow">
          <ZoomPath crumbs={pathOf(companies, here.companyId)} onGo={(id) => (id ? zoom(id) : go(HOUSE))}
            account={account ? accountCrumb(account, accounts) : null} />
          {here.tab === 'board' && !account ? (
            <button type="button" className="settings-set mkt-read" disabled={reading.busy || read.loading} onClick={reading.run}
              title="read every due post's numbers from its platform now">{reading.busy ? 'READING…' : 'READ NOW'}</button>
          ) : null}
        </div>
        {reading.error ? <p className="settings-err">{reading.error}</p> : null}
        {account ? null : <OfficeTabs tabs={here.companyId ? TABS.company : TABS.house} on={here.tab} onTab={tab} />}
      </div>
      {account ? (
        <div className="mkt-body" data-mkt-level="account" data-mkt-account={accountKey}>
          <PlatformSpace key={accountKey} channelId={account.channelId} accountId={account.accountId} landing={focus} companyId={here.companyId} />
        </div>
      ) : (
        <div className="mkt-body" data-mkt-level={here.companyId || 'house'} data-mkt-tab={here.tab}>
          {body[here.tab] || body.board}
        </div>
      )}
    </div>
  );
};
