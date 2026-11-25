// CampaignsSection — the campaign board and each campaign's page: in the
// MARKETING window's CAMPAIGNS tab (the zoomed company's), and in a platform
// window for the campaigns that run on its accounts.
//
// Campaigns are the organizing spine of the outward-speech machine: the CMO
// designation names the one being holding the marketing position, each
// campaign carries its company, goal, angles, sub-campaigns and plans, and its
// content calendar is the queue's own month view of its posts. Decision law is
// unchanged — every post is decided on its own card, never here.

import { useEffect, useMemo, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { getCampaigns } from '../../services/campaigns-client.js';
import { getPostQueue } from '../../services/social-channels-client.js';
import { useHouseAccounts } from './accounts/use-house-accounts.js';
import { companyNameOf } from './accounts/account-words.js';
import { CampaignEditor } from './campaigns/CampaignEditor.jsx';
import { DoorButton } from './doors/DoorButton.jsx';
import { CampaignPage } from './campaigns/CampaignPage.jsx';
import { runsOn } from './campaigns/campaign-form.js';
import { campaignCard, linkTotals } from './marketing-overview/results-fold.js';
import { CampaignCardPanel } from './marketing/BoardPanels.jsx';
import './campaigns/campaign-list.css';

// The campaign board, scoped to ONE space: a platform's own campaigns
// (channelId = a catalog id), or the MARKETING window's (channelId = null),
// narrowed to the company the operator has zoomed to (`scope`, null = the
// whole house). There a campaign's page opens IN PLACE of the list, with the
// way back above it; the window owns which campaign is open (`selectedId`,
// `onSelect`), so a card's landing can open it from anywhere. Each platform
// requires its own approach, so its campaigns live in its own space too
// (ruling, 2026-07-23). The CMO seat lives in the window's SEAT tab. A page
// opens on the picture the BOARD draws of it (CampaignPage.jsx), from the
// window's one read (`read`, use-marketing-overview.js): its posts' numbers.
export const CampaignsSection = ({ channelId = null, calm = null, scope = null, companyId = '', selectedId: openId, onSelect, read = null }) => {
  const [campaigns, setCampaigns] = useState(null);
  const [vocab, setVocab] = useState({ statuses: [], goalKinds: [], kpiMetrics: [] });
  const { accounts, companies } = useHouseAccounts();
  const [queue, setQueue] = useState(null);
  const [ownId, setOwnId] = useState(null);
  const [composing, setComposing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const controlled = typeof onSelect === 'function';
  const selectedId = controlled ? openId ?? null : ownId;
  const select = controlled ? onSelect : setOwnId;
  const inPlace = channelId === null;

  // A successful read always clears a stale error — the board never shows a
  // failure it has already recovered from.
  // A being's act (below) is BACKGROUND news: it waits while the person works
  // the window (calm-gate.js); the first read and their own edits land at once.
  const refresh = async ({ background = false } = {}) => {
    const [board, staged] = await Promise.all([getCampaigns(), getPostQueue()]);
    const apply = () => {
      setCampaigns(board.campaigns);
      setVocab({ statuses: board.statuses || [], goalKinds: board.goalKinds || [], kpiMetrics: board.kpiMetrics || [] });
      setQueue(staged.queue);
      setLoadError(null);
    };
    if (!calm) apply();
    else if (background) calm.offer('campaigns', apply);
    else calm.now('campaigns', apply);
  };

  useEffect(() => { refresh().catch((e) => setLoadError(e.message)); }, []);

  // A BEING declaring a campaign must land on this board without the operator
  // hunting for REFRESH. Before this, a witness created "Umbrae Market Depth"
  // and the panel went on saying […], which
  // is a confident lie about work that had already happened.
  useEffect(() => {
    const onChanged = () => { refresh({ background: true }).catch((e) => setLoadError(e.message)); };
    window.addEventListener('neuma:campaigns-changed', onChanged);
    return () => window.removeEventListener('neuma:campaigns-changed', onChanged);
  }, []);

  // The space's own slice of the bench: a platform space shows the campaigns
  // with a sub on one of its accounts; MARKETING the zoomed company's subtree.
  const inScope = (c) => (channelId ? runsOn(c, channelId) : scope === null || (c.companyId != null && scope.has(c.companyId)));
  const scoped = campaigns?.filter(inScope) ?? null;
  const selected = scoped?.find((c) => c.id === selectedId) || null;
  const page = inPlace && (selected || composing);
  const data = read?.data || null;
  const card = useMemo(() => (selected && data
    ? campaignCard(selected, { queue: data.queue, results: data.results, totals: linkTotals(data.links, data.results.links?.counts), now: Date.now() })
    : null), [selected, data]);
  // MARKETING's list is the BOARD's own campaign panels (Design note, 2026-11-12: […]) — one picture of a campaign wherever it stands; a platform window keeps its rows.
  const cards = useMemo(() => {
    if (!inPlace || !data || !scoped) return null;
    const totals = linkTotals(data.links, data.results.links?.counts);
    const now = Date.now();
    return scoped.map((c) => campaignCard(c, { queue: data.queue, results: data.results, totals, now }));
  }, [inPlace, data, scoped]);
  const open = (id) => { uiSound('toggle'); setComposing(false); select(id); };

  return (
    <section className="settings-sec" data-campaigns-board>
      {page ? (
        <button type="button" className="outreach-back label-data" onClick={() => { uiSound('toggle'); setComposing(false); select(null); }}>
          ← CAMPAIGNS
        </button>
      ) : (
        <div className="mkc-head">
          <span className="label-data settings-h">CAMPAIGNS</span>
          {/* A new campaign starts at the head of the list it joins. */}
          {inPlace ? (
            <button type="button" className="settings-set" onClick={() => { uiSound('toggle'); setComposing(true); select(null); }}>NEW CAMPAIGN</button>
          ) : null}
        </div>
      )}

      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {!campaigns && !loadError ? <p className="settings-note">Reading the board…</p> : null}

      {page ? null : (
        <>
          {scoped?.length === 0 ? <p className="settings-note">No campaigns yet — the field is open.</p> : null}
          {cards ? (
            <div className="sub-grid mkc-grid" data-campaign-panels>
              {cards.map((c) => (
                // Its name and its OPEN open its page — real buttons, never one wrapped round the others.
                <div key={c.id} className="sub-span-6 mkc-row">
                  <CampaignCardPanel card={c} companies={companies} onOpen={open} span={12} nameOpens />
                </div>
              ))}
            </div>
          ) : scoped?.map((c) => (
            <button key={c.id} type="button" data-campaign-row={c.id}
              className={`settings-provider-row${selectedId === c.id ? ' is-sel' : ''}`}
              onClick={() => { uiSound('toggle'); select(selectedId === c.id ? null : c.id); setComposing(false); }}>
              <code>{c.name} · {c.companyId ? companyNameOf(c.companyId, companies) : `${c.brand} (no company yet)`}</code>
              <span className="settings-sec-tags">
                <span className={c.status === 'active' ? 'settings-tag-ok' : 'settings-tag-dim'}>
                  {(c.status || '').toUpperCase()}
                </span>
                <span className="settings-tag-dim">{(c.angles || []).length} ANGLES</span>
                <span className="settings-tag-dim">{(c.subs || []).length} SUBS</span>
                {(c.asks || []).some((a) => a.state === 'open' && a.from === 'cmo')
                  ? <span className="settings-tag-warn">THE CMO ASKS YOU</span> : null}
              </span>
            </button>
          ))}
        </>
      )}

      {/* A campaign is a company's, opened in MARKETING; a platform window lists the ones on its accounts — and its door goes there. */}
      {channelId ? (
        <div className="settings-control">
          <DoorButton door={{ kind: 'marketing', tab: 'campaigns' }}
            title="MARKETING → CAMPAIGNS — the campaigns on this platform's accounts are each a sub of one company's campaign; give one a sub here and it shows on this board" />
        </div>
      ) : null}

      {composing ? (
        <CampaignEditor
          vocab={vocab}
          companies={companies}
          accounts={accounts}
          companyId={companyId}
          onSaved={async (saved) => { setComposing(false); await refresh(); select(saved.id); }}
          onCancel={() => setComposing(false)}
        />
      ) : null}

      {selected ? (
        <CampaignPage
          key={selected.id}
          campaign={selected}
          card={card}
          vocab={vocab}
          companies={companies}
          accounts={accounts}
          queue={queue}
          onChanged={refresh}
          onDeleted={async () => { select(null); await refresh(); }}
        />
      ) : null}

      {/* MARKETING re-reads on every change a being or the operator makes; a platform window keeps its REFRESH. */}
      {inPlace ? null : (
        <div className="settings-control">
          <button type="button" className="settings-set" onClick={() => refresh().catch((e) => setLoadError(e.message))}>
            REFRESH
          </button>
        </div>
      )}
    </section>
  );
};
