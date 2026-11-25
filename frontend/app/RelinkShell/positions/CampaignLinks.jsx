// CampaignLinks — one position's campaigns and the campaigns of other
// positions each one works with (Design note, 2026-11-15: campaigns […]). Used on every position that runs campaigns:
// the operator links two campaigns of one company, sees the other side's
// state as it stands now, and takes a link away. The holder of each side reads
// the same line at the top of its turn (positions/campaign-links.js).
// impure — network.

import { useCallback, useEffect, useState } from 'react';
import { Select } from '../Select.jsx';
import { EmptyState } from '../empty-state.jsx';
import { uiSound } from '../../../services/ui-sound.js';
import { getHouseCampaigns, linkCampaigns, unlinkCampaigns } from '../../../services/positions-client.js';
import { Sheet } from '../sheet/Sheet.jsx';
import { officeWords, linkChoices } from './campaign-links-view.js';

// The campaigns one campaign works with, as a sheet (sheet/Sheet.jsx): one linked campaign a line.
const LinkSheet = ({ campaign, busy, onUnlink }) => (
  <Sheet label={`campaigns ${campaign.name} works with`} rows={campaign.links} rowKey={(l) => l.key} rowName={(l) => l.name} rowAttrs={(l) => ({ 'data-link-with': l.key })}
    columns={[
      { head: 'WORKS WITH', cell: (l) => l.name },
      { head: 'POSITION', cell: (l) => officeWords(l.office) },
      { head: 'STATE', cell: (l) => String(l.state).toUpperCase() },
      { head: 'WHAT IT IS', cell: (l) => l.summary || null, title: (l) => l.summary, tone: () => 'dim' },
      { head: 'NOTE', cell: (l) => l.note || null, title: (l) => l.note },
      { head: 'CHANGE', cell: (l) => <button type="button" className="sec-scan cline-mini cline-danger label-data" disabled={busy} aria-label={`UNLINK ${campaign.name} from ${l.name}`} onClick={() => onUnlink(campaign, l)}>UNLINK</button> },
    ]} />
);

const Row = ({ campaign, all, busy, onLink, onUnlink, onOpen = null }) => {
  const [pick, setPick] = useState('');
  const choices = linkChoices(campaign, all);
  return (
    <li className="cline-sec" data-linked-campaign={campaign.key}>
      <p className="cline-h label-data">{campaign.name}{campaign.company ? ` · FOR ${campaign.company.toUpperCase()}` : ''} · {String(campaign.state).toUpperCase()}</p>
      <p className="cline-move-t">{campaign.summary}</p>
      {onOpen ? <div className="cline-open"><button type="button" className="sec-scan label-data" disabled={busy} aria-label={`OPEN ${campaign.name} — its page, posts and results`} onClick={() => onOpen(campaign)}>OPEN {String(campaign.name).toUpperCase()}</button></div> : null}
      {campaign.links.length ? (
        <LinkSheet campaign={campaign} busy={busy} onUnlink={onUnlink} />
      ) : <p className="cline-move-t">WORKS WITH NO OTHER CAMPAIGN YET</p>}
      {choices.length ? (
        <div className="cline-open">
          <Select fill ariaLabel={`campaign to link with ${campaign.name}`} value={pick} onChange={setPick} disabled={busy}
            placeholder="link with a campaign of another position" options={choices} />
          <button type="button" className="sec-scan label-data" disabled={busy || !pick} aria-label={`LINK ${campaign.name}`}
            onClick={() => { onLink(campaign, pick); setPick(''); }}>LINK</button>
        </div>
      ) : null}
    </li>
  );
};

// impure — every campaign of the house with its links, and the two moves; shared by the full panel below and by a
// position that shows each link inside the campaign's own card (company-line/SalesCampaigns.jsx).
export const useCampaignLinks = () => {
  const [all, setAll] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const load = useCallback(() => getHouseCampaigns().then((r) => { setAll(r.campaigns); setError(null); }, (e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const move = async (fn) => {
    uiSound('activate');
    setBusy(true);
    try {
      setAll((await fn()).campaigns);
      setError(null);
    } catch (e) {
      setError(e.message); // surfaced, never swallowed
    } finally {
      setBusy(false);
    }
  };
  return { all, busy, error, reload: load, link: (campaign, other) => move(() => linkCampaigns(campaign.key, other)), unlink: (campaign, other) => move(() => unlinkCampaigns(campaign.key, other.key)) };
};

/** One campaign's links, inside that campaign's own card: what it works with, and the press to link another. */
export const CampaignLinkLine = ({ campaignKey, links }) => {
  const [pick, setPick] = useState('');
  const campaign = (links.all ?? []).find((c) => c.key === campaignKey);
  if (!campaign) return null;
  const choices = linkChoices(campaign, links.all);
  if (!campaign.links.length && !choices.length) return null;
  return (
    <div className="cline-aud-in" data-linked-campaign={campaign.key}>
      <p className="cline-aud-k label-data">WORKS WITH · {campaign.links.length}</p>
      {links.error ? <p className="sec-error" role="alert">{links.error}</p> : null}
      {campaign.links.length ? (
        <LinkSheet campaign={campaign} busy={links.busy} onUnlink={links.unlink} />
      ) : null}
      {choices.length ? (
        <div className="cline-open">
          <Select fill ariaLabel={`campaign to link with ${campaign.name}`} value={pick} onChange={setPick} disabled={links.busy}
            placeholder="link with a campaign of another position" options={choices} />
          <button type="button" className="sec-scan label-data" disabled={links.busy || !pick} aria-label={`LINK ${campaign.name}`}
            onClick={() => { links.link(campaign, pick); setPick(''); }}>LINK</button>
        </div>
      ) : null}
    </div>
  );
};

/** @param {{office: string, onOpen?: ?Function}} props - the position whose campaigns are shown; onOpen: the press onto one campaign's own page */
export const CampaignLinks = ({ office, onOpen = null }) => {
  const { all, busy, error, link, unlink } = useCampaignLinks();
  const mine = (all ?? []).filter((c) => c.office === office);
  return (
    <section className="cline-sec" aria-label="linked campaigns" data-campaign-links={office}>
      <p className="cline-h label-data">WORKING TOGETHER — {officeWords(office)}&apos;S CAMPAIGNS AND THE CAMPAIGNS THEY WORK WITH</p>
      {error ? <p className="sec-error" role="alert">{error}</p> : null}
      {all && !mine.length ? <EmptyState title="NO CAMPAIGN HERE YET" /> : null}
      <ul className="cline-list" aria-label={`${officeWords(office)} campaigns`}>
        {mine.map((c) => <Row key={c.key} campaign={c} all={all} busy={busy} onLink={link} onUnlink={unlink} onOpen={onOpen} />)}
      </ul>
      <p className="cline-move-t">A link changes neither campaign. It makes the member who holds each one read the other, as it stands, at the top of every turn, so the two say the same offer to the same people at the same time.</p>
    </section>
  );
};
