/**
 * SETTINGS → API → CHANNEL KEYS, the TikTok card, and a TikTok post's
 * choices on its approval card, rendered for real (react-dom/server) from
 * the board the REAL registry masks and the creator info the REAL law reads:
 * no token is ever an input, CONNECT waits for the client key and secret, a
 * connected account is named; on the post's card the account is named,
 * privacy starts unchosen, interactions start off and an account-disabled
 * one is greyed, the AI label is fixed, and TikTok's declaration and links
 * stand above APPROVE. No mocks: real components, real i18n catalog, real
 * masking, real law.
 */
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../frontend/i18n/index.js';
import { TikTokPostSettings } from '../../frontend/app/RelinkShell/TikTokPostSettings.jsx';
import { EMPTY_CHOICE, creatorView, choiceBlockers, readChoice } from '../../frontend/utils/tiktok-consent.js';
import { renderAccountCard } from '../helpers/account-card-kit.js';

const render = (store, test = null) => renderAccountCard('tiktok', store, test);

describe('the TikTok card', () => {
  test('nothing saved: the client key and secret inputs only, CONNECT waits for them', () => {
    const html = render(undefined);
    expect(html).toContain('placeholder="Client Key"');
    expect(html).toContain('placeholder="Client Secret"');
    expect(html).not.toMatch(/Refresh Token|Access Token/);
    expect(html).toContain('NOT CONNECTED');
    expect(html).toContain('Save the TikTok client key and secret first, then CONNECT.');
    expect(html).toMatch(/<button type="button" class="settings-set" disabled="">CONNECT<\/button>/);
  });

  test('connected: the account named from the live flight test, RECONNECT offered, no token rendered', () => {
    const html = render(
      { clientKey: 'k', clientSecret: 's', refreshToken: 'rt', accessToken: 'at', accessExpiresAt: '2099-01-01T00:00:00.000Z' },
      { ok: true, account: { id: 'open-1', name: 'Deus Neuma', title: 'Deus Neuma' } },
    );
    expect(html).toContain('CONNECTED · Deus Neuma');
    expect(html).toContain('RECONNECT');
    expect(html).not.toMatch(/>rt<|>at</);
  });
});

describe('a TikTok post\'s choices on its approval card', () => {
  const creator = creatorView({
    creator_username: 'deusneuma', creator_nickname: 'Deus Neuma',
    privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
    comment_disabled: false, duet_disabled: true, stitch_disabled: false,
  });
  const suggested = { privacyLevel: 'PUBLIC_TO_EVERYONE', allow: { comment: true, duet: false, stitch: false }, promotion: { ownBrand: false, paid: false } };
  const draft = { id: 'q1', channelId: 'tiktok', status: 'draft', text: 'Forge night\nprivacy: everyone' };
  const live = (choice) => renderToStaticMarkup(createElement(TikTokPostSettings, {
    entry: draft,
    state: {
      live: true, card: { ok: true, mode: 'post', creator, suggested }, choice, setChoice: () => {},
      blockers: choiceBlockers(readChoice(choice), creator),
    },
  }));

  test('as it opens: the account named, privacy unchosen with the author\'s suggestion beside it, every toggle off, duet greyed', () => {
    const html = live(EMPTY_CHOICE);
    expect(html).toContain('Deus Neuma');
    expect(html).toContain('@deusneuma');
    expect(html).toMatch(/lc-sel-trigger is-placeholder[^>]*aria-label="Who can watch this video"[^>]*><span class="lc-sel-value">CHOOSE</);
    expect(html).toContain('SUGGESTED · Everyone');
    expect(html).toContain('SUGGESTED · comment');
    expect(html).not.toMatch(/settings-desk-toggle on/);
    expect(html).toMatch(/<button type="button" class="settings-desk-toggle" aria-pressed="false" disabled="" title="Turned off in this account&#x27;s TikTok settings">DUET<\/button>/);
    expect(html).toContain('NOT DISCLOSED');
    expect(html).toContain('ON · ALWAYS');
    expect(html).not.toMatch(/AI-generated[^<]*<\/span><button/);
    expect(html).toContain('By posting, you agree to TikTok&#x27;s <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"');
    expect(html).not.toContain('bc-policy');
    expect(html).toContain('it may take a few minutes for the video to process and be visible on the profile');
    expect(html).toContain('TO APPROVE · Choose who can watch this video');
  });

  test('branded content chosen: the label and both policies; under only me it is greyed with TikTok\'s reason', () => {
    const branded = { ...EMPTY_CHOICE, privacyLevel: 'MUTUAL_FOLLOW_FRIENDS', commercial: { on: true, yourBrand: false, branded: true } };
    const html = live(branded);
    expect(html).toContain('Your video will be labeled as &#x27;Paid partnership&#x27;');
    expect(html).toContain('href="https://www.tiktok.com/legal/page/global/bc-policy/en"');
    expect(html).toMatch(/Branded Content Policy<\/a> and <a[^>]*>Music Usage Confirmation<\/a>/);
    expect(html).not.toContain('TO APPROVE');
    const onlyMe = live({ ...EMPTY_CHOICE, privacyLevel: 'SELF_ONLY', commercial: { on: true, yourBrand: false, branded: false } });
    expect(onlyMe).toMatch(/disabled="" title="Branded content visibility cannot be set to private.">BRANDED CONTENT/);
    expect(onlyMe).toContain('TO APPROVE · You need to indicate if your content promotes yourself, a third party, or both.');
  });

  test('approved: the card reads back exactly what was approved, and that it may take a few minutes to show', () => {
    const html = renderToStaticMarkup(createElement(TikTokPostSettings, {
      entry: {
        ...draft, status: 'approved',
        tiktokConsent: {
          privacyLevel: 'MUTUAL_FOLLOW_FRIENDS', allow: { comment: true, duet: false, stitch: false },
          commercial: { on: true, yourBrand: true, branded: false }, account: { username: 'deusneuma', nickname: 'Deus Neuma' },
        },
      },
      state: { live: false, card: null, choice: EMPTY_CHOICE, setChoice: () => {}, blockers: [] },
    }));
    expect(html).toContain('Friends · comment on · duet off · stitch off · Promotional content · AI-generated label on · to @deusneuma');
    expect(html).toContain('it may take a few minutes for the video to process and be visible on the profile');
  });

  test('a draft for the TikTok inbox: no choices here, it is finished in the TikTok app', () => {
    const html = renderToStaticMarkup(createElement(TikTokPostSettings, {
      entry: { ...draft, text: 'x\nsend: drafts' },
      state: { live: true, card: { ok: true, mode: 'drafts' }, choice: EMPTY_CHOICE, setChoice: () => {}, blockers: [] },
    }));
    expect(html).toContain('finish the post there, and turn the AI-generated label on');
    expect(html).not.toContain('Who can watch');
  });
});
