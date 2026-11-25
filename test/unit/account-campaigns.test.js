/**
 * The campaigns an account carries (account-level/AccountCampaigns.jsx) —
 * real inputs, real outputs, and the account level's row rendered for real.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accountCampaigns, AccountCampaigns } from '../../frontend/app/RelinkShell/account-level/AccountCampaigns.jsx';

const CAMPAIGNS = [
  { id: 'c1', name: 'Launch Week', status: 'active', subs: [{ accountId: 'x-1' }, { accountId: 'bluesky-1' }] },
  { id: 'c2', name: 'Depth', status: 'paused', subs: [{ accountId: 'x-1' }] },
  { id: 'c3', name: 'Other', subs: [{ accountId: 'x-2' }] },
];

describe('an account\'s campaigns', () => {
  it('every campaign with a sub on the account, none for an account with none or no account', () => {
    expect(accountCampaigns(CAMPAIGNS, 'x-1').map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(accountCampaigns(CAMPAIGNS, 'tiktok-1')).toEqual([]);
    expect(accountCampaigns(CAMPAIGNS, null)).toEqual([]);
    expect(accountCampaigns(null, 'x-1')).toEqual([]);
  });

  it("each is its name, marked, a press to its page; an account with none names its company's CAMPAIGNS", () => {
    const html = renderToStaticMarkup(createElement(AccountCampaigns, { campaigns: CAMPAIGNS, accountId: 'x-1', companyId: 'northwind', onCampaign: () => {} }));
    expect(html).toContain('data-account-campaigns');
    expect(html).toContain('◆ Launch Week');
    expect(html).toContain('◆ Depth');
    expect(html).not.toContain('Other');
    expect(renderToStaticMarkup(createElement(AccountCampaigns, { campaigns: CAMPAIGNS, accountId: 'tiktok-1', companyId: 'northwind', onCampaign: () => {} }))).not.toContain('◆');
  });
});
