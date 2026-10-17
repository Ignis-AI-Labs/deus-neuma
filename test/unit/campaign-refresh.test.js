/**
 * Which acts move the campaign board.
 *
 * Design note, 2026-07-27, with a screenshot: a witness declared a campaign on the X
 * space and reported it created; the CAMPAIGNS panel went on saying
 * […] No campaign event existed anywhere,
 * so the board only ever re-read on mount or after the operator's own edits.
 *
 * The decision is pure, and both halves matter equally: a WRITE must refresh
 * (or a being's work stays invisible), and a READ must NOT (or the board
 * re-fetches every time a being lists campaigns, which is the call a being
 * makes most, and the panel loops during ordinary work).
 */
import { describe, it, expect } from 'vitest';
import { changesCampaigns } from '../../frontend/app/RelinkShell/campaign-refresh.js';

describe('acts that move the board', () => {
  it.each([
    ['marketing/campaign_create'],
    ['marketing/campaign_update'],
    // Staging is a filed INTENT now (Stage 2): the sweep's settled chip
    // arrives as `intents/social.queue`.
    ['intents/social.queue'],
    ['social/queue_cancel'],
  ])('refreshes on a successful %s', (tool) => {
    expect(changesCampaigns({ tool, status: 'ok' })).toBe(true);
  });

  it('accepts a bare tool name as well as server/tool', () => {
    expect(changesCampaigns({ tool: 'campaign_create', status: 'ok' })).toBe(true);
  });

  it('refreshes on a campaign REMOVAL — a vanished campaign is a change too', () => {
    expect(changesCampaigns({ tool: 'marketing/campaign_remove', status: 'ok' })).toBe(true);
  });

  // The remaining queue tools are channel-parameterized (`queue_reply_to_<channel>`).
  // An exact match on `queue_reply_to_x` would have quietly stopped working the
  // day a second poster shipped, reintroducing the stale board one channel over.
  it.each(['x', 'bluesky', 'mastodon', 'discord', 'telegram', 'facebook'])(
    'refreshes for a channel that did not exist when this was written: queue_reply_to_%s',
    (channel) => {
      expect(changesCampaigns({ tool: `social/queue_reply_to_${channel}`, status: 'ok' })).toBe(true);
    },
  );

  // The reply lane stages into the same board — a staged answer changes the
  // REPLIES tab the same way a staged post changes QUEUED.
  it('refreshes on a staged REPLY — the REPLIES tab must not read stale', () => {
    expect(changesCampaigns({ tool: 'social/queue_reply_to_x', status: 'ok' })).toBe(true);
    expect(changesCampaigns({ tool: 'social/queue_reply_to_x', status: 'denied' })).toBe(false);
  });

  // The edit lane (#208): an edited post changes what the board shows exactly
  // as much as a staged one — including through a channel that did not exist
  // when this was written.
  it.each(['queue_update_to_x', 'queue_bulk_update_to_x', 'queue_update_to_bluesky'])(
    'refreshes on a successful %s edit',
    (tool) => {
      expect(changesCampaigns({ tool: `social/${tool}`, status: 'ok' })).toBe(true);
      expect(changesCampaigns({ tool: `social/${tool}`, status: 'denied' })).toBe(false);
    },
  );

  it('does not let the prefix match something unrelated', () => {
    expect(changesCampaigns({ tool: 'social/queue_post_review', status: 'ok' })).toBe(false);
    expect(changesCampaigns({ tool: 'social/read_x', status: 'ok' })).toBe(false);
  });
});

describe('acts that must NOT move the board', () => {
  it('never refreshes on a READ — that is the loop this avoids', () => {
    expect(changesCampaigns({ tool: 'marketing/campaign_list', status: 'ok' })).toBe(false);
    expect(changesCampaigns({ tool: 'social/queue_list', status: 'ok' })).toBe(false);
  });

  it('never refreshes on an unrelated tool', () => {
    expect(changesCampaigns({ tool: 'filesystem/write_file', status: 'ok' })).toBe(false);
    expect(changesCampaigns({ tool: 'web/web_search', status: 'ok' })).toBe(false);
  });

  it('never refreshes on a refusal or an error — a denial is not a change', () => {
    expect(changesCampaigns({ tool: 'marketing/campaign_create', status: 'denied' })).toBe(false);
    expect(changesCampaigns({ tool: 'marketing/campaign_create', status: 'error' })).toBe(false);
    expect(changesCampaigns({ tool: 'marketing/campaign_create', ok: false })).toBe(false);
  });

  it('survives junk without throwing — it is handed every frame', () => {
    expect(changesCampaigns(null)).toBe(false);
    expect(changesCampaigns(undefined)).toBe(false);
    expect(changesCampaigns({})).toBe(false);
    expect(changesCampaigns('nope')).toBe(false);
  });
});
