/**
 * A post's place in a campaign, its group, and its kept address — the pure
 * law (queue-campaign.js, queue-group.js, permalink.js). Real inputs, real
 * outputs, no mock.
 */
import { describe, it, expect } from 'vitest';
import { placeInCampaign, campaignFieldsRefusal, campaignFieldsOf, entryAngle } from '../../backend/services/social/queue-campaign.js';
import { approveGroupIn, groupJoinRefusal } from '../../backend/services/social/queue-group.js';
import { permalinkOf } from '../../backend/services/social/permalink.js';

const CAMPAIGN = Object.freeze({
  id: 'abcdef0123456789', name: 'Launch', status: 'active', companyId: 'northwind',
  angles: [{ id: 'proof', name: 'proof' }], subs: [{ accountId: 'x-1' }],
});
const ACCOUNTS = [
  { id: 'x-1', companyId: 'northwind' }, { id: 'x-2', companyId: 'labs' }, { id: 'x-3', companyId: 'brookmere' }, { id: 'tiktok-1', companyId: 'northwind' },
];
const COMPANIES = [{ id: 'northwind', rootId: 'northwind' }, { id: 'labs', rootId: 'northwind' }, { id: 'brookmere', rootId: 'brookmere' }];

describe('placeInCampaign', () => {
  it('a prefix names the campaign; an angle by name names its id; an old pillar is read as the angle', () => {
    expect(placeInCampaign({ campaigns: [CAMPAIGN], accounts: ACCOUNTS, campaignId: 'abcdef01', accountId: 'x-1', angle: 'Proof' }))
      .toEqual({ campaignId: CAMPAIGN.id, angleId: 'proof', pillar: 'proof' });
    expect(placeInCampaign({ campaigns: [CAMPAIGN], accounts: ACCOUNTS, campaignId: CAMPAIGN.id, accountId: 'x-1', pillar: 'proof' }).angleId).toBe('proof');
    expect(placeInCampaign({ campaigns: [CAMPAIGN], accounts: ACCOUNTS, accountId: 'x-1', pillar: 'free words' })).toEqual({ campaignId: null, angleId: null, pillar: 'free words' });
  });

  it('refuses another house\'s (absent) campaign, a done one, an account with no sub, an angle with no campaign', () => {
    expect(placeInCampaign({ campaigns: [], accounts: ACCOUNTS, campaignId: 'abcdef01', accountId: 'x-1' }).error).toMatch(/no campaign "abcdef01" in this house/);
    expect(placeInCampaign({ campaigns: [{ ...CAMPAIGN, status: 'done' }], accounts: ACCOUNTS, campaignId: CAMPAIGN.id, accountId: 'x-1' }).error).toMatch(/is done/);
    expect(placeInCampaign({ campaigns: [CAMPAIGN], accounts: ACCOUNTS, campaignId: CAMPAIGN.id, accountId: 'x-2' }).error).toMatch(/x-2 has no part in "Launch"/);
    expect(placeInCampaign({ campaigns: [CAMPAIGN], accounts: ACCOUNTS, accountId: 'x-1', angle: 'proof' }).error).toMatch(/name the campaign/);
  });

  it('the fields an entry keeps are copied only when set; their form is judged', () => {
    expect(campaignFieldsOf({})).toEqual({});
    expect(campaignFieldsOf({ angleId: 'proof', groupId: 'launch' })).toEqual({ angleId: 'proof', groupId: 'launch' });
    expect(campaignFieldsRefusal({ groupId: 'Launch Clip!' })).toMatch(/short name/);
    expect(campaignFieldsRefusal({ groupId: 'launch', kind: 'reply' })).toMatch(/never part of a group/);
    expect(entryAngle({ pillar: 'proof' }, CAMPAIGN)).toEqual({ id: 'proof', name: 'proof' });
  });
});

describe('the group law', () => {
  const at = new Date('2026-10-24T00:00:00Z');
  const draft = (id, accountId, channelId = 'x') => ({ id, accountId, channelId, text: `copy ${id}`, status: 'draft', groupId: 'g' });

  it('one tree, one post per account', () => {
    const members = [draft('a', 'x-1')];
    expect(groupJoinRefusal({ groupId: 'g', accountId: 'x-2' }, { members, accounts: ACCOUNTS, companies: COMPANIES })).toBeNull();
    expect(groupJoinRefusal({ groupId: 'g', accountId: 'x-3' }, { members, accounts: ACCOUNTS, companies: COMPANIES })).toMatch(/never spans two trees/);
    expect(groupJoinRefusal({ groupId: 'g', accountId: 'x-1' }, { members, accounts: ACCOUNTS, companies: COMPANIES })).toMatch(/already carries group "g"/);
  });

  it('a TikTok post keeps its own card: approved only with its choices, else named in ownCard', () => {
    const entries = [draft('a', 'x-1'), draft('b', 'tiktok-1', 'tiktok')];
    const ids = new Set(['a', 'b']);
    const result = approveGroupIn(entries, 'g', { ids, decidedBy: '0xop', textsSeen: { a: 'copy a', b: 'copy b' }, now: at });
    expect(result.ownCard).toEqual(['b']);
    expect(result.approved.map((e) => e.id)).toEqual(['a']);
    expect(entries.map((e) => e.status)).toEqual(['approved', 'draft']);
  });

  it('only the house\'s own members are touched, and a moved copy approves nothing', () => {
    const entries = [draft('a', 'x-1'), draft('c', 'x-2')];
    expect(approveGroupIn(entries, 'g', { ids: new Set(), decidedBy: '0xop', textsSeen: {}, now: at }).error).toBe('no such group');
    expect(approveGroupIn(entries, 'g', { ids: new Set(['a', 'c']), decidedBy: '0xop', textsSeen: { a: 'copy a', c: 'old' }, now: at }).error).toMatch(/x-2 changed/);
    expect(entries.every((e) => e.status === 'draft')).toBe(true);
  });
});

describe('the kept address', () => {
  it('the poster\'s own url wins; X, Bluesky and LinkedIn are built from the id; others stay null', () => {
    expect(permalinkOf('youtube', { id: 'v', url: 'https://www.youtube.com/watch?v=v' })).toBe('https://www.youtube.com/watch?v=v');
    expect(permalinkOf('x', { id: '1850000000000000001' })).toBe('https://x.com/i/status/1850000000000000001');
    expect(permalinkOf('bluesky', { id: 'at://did:plc:abc123/app.bsky.feed.post/3kq2' })).toBe('https://bsky.app/profile/did:plc:abc123/post/3kq2');
    expect(permalinkOf('linkedin', { id: 'urn:li:share:7000' })).toBe('https://www.linkedin.com/feed/update/urn:li:share:7000');
    expect(permalinkOf('telegram', { id: '55' })).toBeNull();
    expect(permalinkOf('x', { id: 'not-a-number' })).toBeNull();
  });
});
