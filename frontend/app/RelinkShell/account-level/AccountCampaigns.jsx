// AccountCampaigns — the campaigns an account carries, at its account level
// (Design note, 2026-11-12: campaigns […]): each campaign with a sub on this account is a door to its own
// page, opened in place; an account no campaign uses keeps one door to its
// company's CAMPAIGNS.
// A campaign is its company's — this only shows which ones speak through here.

import { uiSound } from '../../../services/ui-sound.js';
import { DoorButton } from '../doors/DoorButton.jsx';

/**
 * The campaigns with a sub on one account. Pure.
 * @param {?ReadonlyArray<{id: string, name: string, subs?: Array<{accountId?: string}>}>} campaigns
 * @param {?string} accountId
 */
export const accountCampaigns = (campaigns, accountId) => (accountId
  ? (campaigns || []).filter((c) => (c.subs || []).some((s) => s.accountId === accountId))
  : []);

/**
 * @param {{campaigns: ?object[], accountId: ?string, companyId: ?string, onCampaign: (id: string) => void}} props
 *   onCampaign — MARKETING opens the campaign's page in place
 */
export const AccountCampaigns = ({ campaigns, accountId, companyId, onCampaign }) => {
  const mine = accountCampaigns(campaigns, accountId);
  if (!mine.length) return <DoorButton door={{ kind: 'marketing', tab: 'campaigns', companyId }} title="no campaign runs on this account yet — its company's CAMPAIGNS" />;
  return (
    <span className="acc-campaigns" data-account-campaigns>
      {mine.map((c) => (
        <button key={c.id} type="button" className={`settings-set acc-campaign is-${c.status || 'active'}`} data-account-campaign={c.id}
          title={`${c.name} — a campaign on this account; open its page`} onClick={() => { uiSound('open'); onCampaign(c.id); }}>
          ◆ {c.name}
        </button>
      ))}
    </span>
  );
};
