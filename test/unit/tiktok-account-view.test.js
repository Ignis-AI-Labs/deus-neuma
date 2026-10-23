/**
 * The TikTok account view's pure law, called with real inputs (no mocks,
 * nothing to fake): the fields each granted permission lets the platform ask
 * for, what TikTok's user and video answers become, the plain words for a
 * connection without the view's permissions, the refusal words, the short
 * counts, lengths and view shares the window draws, the picture relay's host
 * and type rules, the 19-digit video id kept exact, and the ACCOUNT board
 * and the Settings card rendered for real (react-dom/server) from the views
 * the real law makes. Field names and
 * scopes are TikTok's (Get User Info and Video Object references, Scopes
 * Reference, read 2026-10-23).
 */
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../frontend/i18n/index.js';
import {
  accountView, videoView, missingProfileScopes, userFieldsFor, profileReconnectWords, readRefusalWords, VIDEO_FIELDS, VIDEO_PAGE,
} from '../../backend/services/social/tiktok-profile-view.js';
import { TIKTOK_SCOPES, TIKTOK_POSTING_SCOPES, TIKTOK_PROFILE_SCOPES, tokenRecord } from '../../backend/services/social/tiktok-oauth.js';
import { tiktokImageUrlAllowed, imageTypeOf } from '../../backend/services/social/tiktok-image-relay.js';
import { quoteBigIds } from '../../backend/services/social/tiktok-api.js';
import { getChannel, maskChannelCredentials, resolveChannelCredentials } from '../../backend/services/social/channel-registry.js';
import {
  formatCount, exactCount, durationLabel, postedLabel, relayedImage, viewShares,
} from '../../frontend/utils/tiktok-account-view.js';
import { ChannelKeysSection } from '../../frontend/app/RelinkShell/ChannelKeysSection.jsx';
import { TikTokAccountBoard } from '../../frontend/app/RelinkShell/TikTokAccount.jsx';

const POSTING_ONLY = 'user.info.basic,video.publish,video.upload';

describe('permissions: what CONNECT asks for, and what a grant lets the view read', () => {
  test('CONNECT asks for all six; posting needs only its own three', () => {
    expect([...TIKTOK_SCOPES]).toEqual(['user.info.basic', 'video.publish', 'video.upload', 'user.info.profile', 'user.info.stats', 'video.list']);
    expect([...TIKTOK_POSTING_SCOPES]).toEqual(['user.info.basic', 'video.publish', 'video.upload']);
    expect([...TIKTOK_PROFILE_SCOPES]).toEqual(['user.info.profile', 'user.info.stats', 'video.list']);
  });

  test('a grant decides the user fields: basic always, profile and stats only where granted', () => {
    expect(missingProfileScopes(TIKTOK_SCOPES.join(','))).toEqual([]);
    expect(userFieldsFor([])).toEqual(['open_id', 'display_name', 'avatar_url', 'username', 'bio_description', 'is_verified',
      'profile_deep_link', 'profile_web_link', 'follower_count', 'following_count', 'likes_count', 'video_count']);
    expect(missingProfileScopes(POSTING_ONLY)).toEqual(['user.info.profile', 'user.info.stats', 'video.list']);
    expect(userFieldsFor(missingProfileScopes(POSTING_ONLY))).toEqual(['open_id', 'display_name', 'avatar_url']);
    expect(userFieldsFor(['user.info.stats'])).not.toContain('follower_count');
    expect(VIDEO_FIELDS).toEqual(['id', 'title', 'video_description', 'create_time', 'cover_image_url', 'share_url', 'duration',
      'view_count', 'like_count', 'comment_count', 'share_count']);
    expect(VIDEO_PAGE).toBe(20);
  });

  test('a connection made before the view records no grant: it holds posting\'s three, exactly', () => {
    const tiktok = getChannel('tiktok');
    const old = { clientKey: 'k', clientSecret: 's', refreshToken: 'r', accessToken: 'a', accessExpiresAt: '2099-01-01T00:00:00.000Z' };
    expect(resolveChannelCredentials(tiktok, old, {}).grantedScope).toBe(POSTING_ONLY);
    expect(maskChannelCredentials(tiktok, old, {}).configured).toBe(true);
    expect(tokenRecord({ access_token: 'a', refresh_token: 'r', expires_in: 60, scope: 'user.info.basic,video.list' }, 0).grantedScope)
      .toBe('user.info.basic,video.list');
    expect(tokenRecord({ access_token: 'a', refresh_token: 'r', expires_in: 60 }, 0)).not.toHaveProperty('grantedScope');
  });

  test('the missing-permission words: posting still works, what is missing in plain words, where to RECONNECT', () => {
    expect(profileReconnectWords([])).toBeNull();
    expect(profileReconnectWords(missingProfileScopes(POSTING_ONLY))).toBe(
      'Posting works. To see the profile details, the counts and the recent videos, TikTok needs new permissions: '
      + 'press RECONNECT in Settings → API → Channel keys → TikTok and allow every permission',
    );
    expect(profileReconnectWords(['video.list'])).toMatch(/^Posting works\. To see the recent videos, TikTok needs new permissions/);
    expect(profileReconnectWords(['user.info.profile', 'video.list'])).toMatch(/To see the profile details and the recent videos,/);
  });

  test('refusals in words: a scope TikTok refuses, an expired sign-in, a rate wall, an unknown code, no answer', () => {
    expect(readRefusalWords({ status: 401, code: 'scope_not_authorized', detail: 'x' })).toMatch(/^Posting works\. To see the profile details, the counts and the recent videos/);
    expect(readRefusalWords({ status: 401, code: 'access_token_invalid', detail: 'the sign-in has expired', reconnect: true })).toBe('the sign-in has expired');
    expect(readRefusalWords({ status: 429, code: 'rate_limit_exceeded', detail: 'x' })).toBe('TikTok asked to slow down; press REFRESH in a minute');
    expect(readRefusalWords({ status: 400, code: 'invalid_params', detail: 'TikTok refused the post' })).toBe('TikTok refused the account read (invalid_params)');
    expect(readRefusalWords({ status: 500, code: null, detail: 'x' })).toBe('TikTok refused the account read (HTTP 500)');
    expect(readRefusalWords({ detail: 'TikTok did not answer (fetch failed)' })).toBe('TikTok did not answer (fetch failed)');
  });
});

describe('what TikTok\'s answers become', () => {
  test('the full account: names, verified mark, bio, the web profile link first, the four counts', () => {
    const view = accountView({
      open_id: 'o1', display_name: 'Deus Neuma', avatar_url: 'https://p16-sign-va.tiktokcdn.com/a.jpeg', username: 'deusneuma',
      bio_description: 'Sovereign relationships with AI.', is_verified: true,
      profile_deep_link: 'https://vm.tiktok.com/Z/', profile_web_link: 'https://www.tiktok.com/@deusneuma',
      follower_count: 12345, following_count: 0, likes_count: 1500000, video_count: 3,
    });
    expect(view).toEqual({
      id: 'o1', displayName: 'Deus Neuma', username: 'deusneuma', bio: 'Sovereign relationships with AI.', verified: true,
      avatarUrl: 'https://p16-sign-va.tiktokcdn.com/a.jpeg', profileUrl: 'https://www.tiktok.com/@deusneuma',
      counts: { followers: 12345, following: 0, likes: 1500000, videos: 3 },
    });
    expect(Object.isFrozen(view)).toBe(true);
  });

  test('a basic-only answer: what was not readable is null (never a zero), the deep link stands in, a non-https link never becomes a press', () => {
    expect(accountView({ open_id: 'o1', display_name: 'D' })).toEqual({
      id: 'o1', displayName: 'D', username: null, bio: null, verified: null, avatarUrl: null, profileUrl: null,
      counts: { followers: null, following: null, likes: null, videos: null },
    });
    expect(accountView({ profile_deep_link: 'https://vm.tiktok.com/Z/' }).profileUrl).toBe('https://vm.tiktok.com/Z/');
    expect(accountView({ profile_web_link: 'javascript:alert(1)', profile_deep_link: 'snssdk1233://user' }).profileUrl).toBeNull();
    expect(accountView({ bio_description: '' }).bio).toBe('');
  });

  test('a video: title before description, the posted moment from epoch seconds, its counts; a missing one is null', () => {
    expect(videoView({
      id: '7300000000000000003', title: '', video_description: 'Forge night', create_time: 1761200000, duration: 15,
      cover_image_url: 'https://p16-sign.tiktokcdn-us.com/c.webp', share_url: 'https://www.tiktok.com/@d/video/1',
      view_count: 2000, like_count: 150, comment_count: 12, share_count: 3,
    })).toEqual({
      id: '7300000000000000003', caption: 'Forge night', postedAt: '2025-10-23T06:13:20.000Z', durationSec: 15,
      coverUrl: 'https://p16-sign.tiktokcdn-us.com/c.webp', shareUrl: 'https://www.tiktok.com/@d/video/1',
      counts: { views: 2000, likes: 150, comments: 12, shares: 3 },
    });
    expect(videoView({ id: 'v', title: 'T', video_description: 'D' }).caption).toBe('T');
    expect(videoView({ id: 'v' })).toMatchObject({ caption: '', postedAt: null, durationSec: null, shareUrl: null, counts: { views: null, likes: null } });
  });

  test('a 19-digit video id written raw by TikTok is kept exact, a quoted one untouched', () => {
    const raw = '{"data":{"videos":[{"id":7300000000000000003,"title":"x"},{"id":"7300000000000000002"}],"cursor":1761000000000,"has_more":false}}';
    const parsed = JSON.parse(quoteBigIds(raw));
    expect(parsed.data.videos.map((v) => v.id)).toEqual(['7300000000000000003', '7300000000000000002']);
    expect(parsed.data.cursor).toBe(1761000000000);
  });
});

describe('the window\'s readings', () => {
  test('short counts as TikTok\'s app writes them; a missing reading is a dash', () => {
    expect([0, 7, 999, 1000, 1234, 1999, 12345, 999999, 1500000, 12000000, 2500000000].map(formatCount))
      .toEqual(['0', '7', '999', '1K', '1.2K', '1.9K', '12K', '999K', '1.5M', '12M', '2.5B']);
    expect([null, undefined, 'x'].map(formatCount)).toEqual(['—', '—', '—']);
    expect(exactCount(12345, 'followers')).toBe('12,345 followers');
    expect(exactCount(null, 'followers')).toBe('followers: not readable yet');
  });

  test('lengths, dates, the relay path, and each video\'s share of the most-watched', () => {
    expect([8, 75, 600, null].map(durationLabel)).toEqual(['0:08', '1:15', '10:00', '—']);
    expect(postedLabel(null)).toBe('—');
    expect(postedLabel('2025-10-23T06:13:20.000Z')).toMatch(/2025/);
    expect(relayedImage('https://p16.tiktokcdn.com/a b.jpg?x=1&y=2'))
      .toBe('/api/v1/social-channels/tiktok/image?src=https%3A%2F%2Fp16.tiktokcdn.com%2Fa%20b.jpg%3Fx%3D1%26y%3D2');
    expect(relayedImage(null)).toBeNull();
    const counts = (views) => ({ counts: { views } });
    expect(viewShares([counts(2000), counts(500), counts(0), counts(null)])).toEqual([1, 0.25, 0, null]);
    expect(viewShares([counts(0)])).toEqual([0]);
  });
});

describe('the picture relay\'s rules', () => {
  test('https on TikTok\'s CDN domains only; no other host, scheme, port or credentials', () => {
    for (const ok of ['https://p16-sign-va.tiktokcdn.com/obj/a.jpeg?x-expires=1', 'https://p19-common-sign.tiktokcdn-us.com/c.webp',
      'https://p16-sign.tiktokcdn-eu.com/a.jpg']) expect(tiktokImageUrlAllowed(ok, undefined)).toBe(true);
    for (const no of ['http://p16-sign-va.tiktokcdn.com/a.jpeg', 'https://tiktokcdn.com.evil.example/a.jpg', 'https://eviltiktokcdn.com/a.jpg',
      'https://tiktokcdn.com/a.jpg', 'https://p16.tiktokcdn.com:8443/a.jpg', 'https://u:p@p16.tiktokcdn.com/a.jpg',
      'https://127.0.0.1/a.jpg', 'https://www.tiktok.com/@d', 'file:///etc/passwd', 'not a url', '']) {
      expect(tiktokImageUrlAllowed(no, undefined)).toBe(false);
    }
  });

  test('the tests\' one admitted origin is exact', () => {
    expect(tiktokImageUrlAllowed('http://127.0.0.1:4000/cdn/a.jpg', 'http://127.0.0.1:4000')).toBe(true);
    expect(tiktokImageUrlAllowed('http://127.0.0.1:4001/cdn/a.jpg', 'http://127.0.0.1:4000')).toBe(false);
  });

  test('picture types the desk can draw; never SVG, never a page', () => {
    expect(['image/jpeg', 'image/png; charset=binary', 'IMAGE/WEBP', 'image/gif', 'image/avif'].map(imageTypeOf))
      .toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
    expect(['image/svg+xml', 'text/html', 'application/octet-stream', '', null].map(imageTypeOf)).toEqual([null, null, null, null, null]);
  });
});

describe('the Settings card says when the account view needs RECONNECT', () => {
  test('connected without the view\'s permissions: the sentence beside the account; with them: none', () => {
    const tiktok = getChannel('tiktok');
    const store = { clientKey: 'k', clientSecret: 's', refreshToken: 'rt', accessToken: 'at', accessExpiresAt: '2099-01-01T00:00:00.000Z' };
    const render = (test) => renderToStaticMarkup(createElement(ChannelKeysSection, {
      channels: [maskChannelCredentials(tiktok, store, {})], tests: { tiktok: test }, error: null, onChanged: async () => {},
      onRetest: () => {}, stateFilter: '', openKey: 'channel:tiktok', onOpen: () => {},
    }));
    const words = profileReconnectWords(missingProfileScopes(POSTING_ONLY));
    const old = render({ ok: true, account: { id: 'open-1', name: 'Deus Neuma', title: 'Deus Neuma' }, profileNeeds: words });
    expect(old).toContain('CONNECTED · Deus Neuma');
    expect(old).toContain('Posting works. To see the profile details, the counts and the recent videos, TikTok needs new permissions');
    expect(old).toContain('RECONNECT');
    const full = render({ ok: true, account: { id: 'open-1', name: 'Deus Neuma', title: 'Deus Neuma' }, profileNeeds: null });
    expect(full).not.toContain('Posting works.');
  });
});

describe('the ACCOUNT board, drawn from the real law\'s views', () => {
  const board = (props) => renderToStaticMarkup(createElement(TikTokAccountBoard, {
    error: null, reading: false, onRefresh: () => {}, onKeys: () => {}, ...props,
  }));
  const fullView = () => ({
    account: accountView({
      open_id: 'o1', display_name: 'Deus Neuma', avatar_url: 'https://p16-sign-va.tiktokcdn.com/a.jpeg', username: 'deusneuma',
      bio_description: 'Sovereign relationships with AI.', is_verified: true, profile_web_link: 'https://www.tiktok.com/@deusneuma',
      follower_count: 12345, following_count: 12, likes_count: 1500000, video_count: 2,
    }),
    videos: [
      videoView({ id: '7300000000000000003', title: 'Forge night', create_time: 1761200000, duration: 15, share_url: 'https://www.tiktok.com/@d/video/3', view_count: 2000, like_count: 150, comment_count: 12, share_count: 3 }),
      videoView({ id: '7300000000000000002', video_description: 'Second light', create_time: 1761100000, duration: 75, share_url: 'https://www.tiktok.com/@d/video/2', view_count: 500, like_count: 40, comment_count: 0, share_count: 1 }),
    ],
    hasMore: false, videosError: null, missing: [], reconnect: null, readAt: '2026-10-23T12:00:00.000Z',
  });

  test('reading, then refused: the reason, the way to the keys, and TRY AGAIN', () => {
    expect(board({ view: null, reading: true })).toContain('Reading the TikTok account…');
    const refused = board({ view: null, error: 'TikTok is not connected: save the client key and secret' });
    expect(refused).toContain('TikTok is not connected');
    expect(refused).toContain('MANAGE KEYS');
    expect(refused).toContain('TRY AGAIN');
  });

  test('every permission: who it is, the verified mark, the bio, EDIT ON TIKTOK live, the four counts, the videos with their bars', () => {
    const html = board({ view: fullView() });
    expect(html).toContain('Deus Neuma');
    expect(html).toContain('@deusneuma');
    expect(html).toContain('aria-label="verified"');
    expect(html).toContain('Sovereign relationships with AI.');
    expect(html).toMatch(/<button type="button" class="ps-btn tta-edit" title="Opens the profile on TikTok[^"]*">EDIT ON TIKTOK<\/button>/);
    expect(html).toContain('REFRESH');
    for (const [n, label] of [['12K', 'FOLLOWERS'], ['12', 'FOLLOWING'], ['1.5M', 'LIKES'], ['2', 'VIDEOS']]) {
      expect(html).toContain(`<b>${n}</b><span>${label}</span>`);
    }
    expect(html).toContain('title="12,345 followers"');
    expect(html).toContain('RECENT VIDEOS · 2');
    expect(html).toContain('Forge night');
    expect(html).toContain('Second light');
    expect(html).toContain('1:15');
    expect(html).toContain('style="width:100%"');
    expect(html).toContain('style="width:25%"');
    expect((html.match(/OPEN ON TIKTOK/g) || []).length).toBe(2);
    expect(html).not.toContain('Posting works.');
  });

  test('a connection made before the view: the RECONNECT notice, dashes for every count, no edit link, no video list', () => {
    const missing = missingProfileScopes(POSTING_ONLY);
    const html = board({
      view: {
        account: accountView({ open_id: 'o1', display_name: 'Deus Neuma' }), videos: null, hasMore: false, videosError: null,
        missing, reconnect: profileReconnectWords(missing), readAt: '2026-10-23T12:00:00.000Z',
      },
    });
    expect(html).toContain('Posting works. To see the profile details, the counts and the recent videos');
    expect(html).toContain('>RECONNECT</button>');
    expect((html.match(/<b>—<\/b>/g) || []).length).toBe(4);
    expect(html).toContain('title="followers: not readable yet"');
    expect(html).toMatch(/<button type="button" class="ps-btn tta-edit" disabled="" title="TikTok gave no profile link[^"]*">EDIT ON TIKTOK<\/button>/);
    expect(html).not.toContain('RECENT VIDEOS');
    expect(html).not.toContain('Sovereign relationships');
  });

  test('the videos refused while the profile read: the reason stands where the videos would', () => {
    const html = board({ view: { ...fullView(), videos: null, videosError: 'TikTok asked to slow down; press REFRESH in a minute' } });
    expect(html).toContain('TikTok asked to slow down; press REFRESH in a minute');
    expect(html).not.toContain('RECENT VIDEOS');
  });
});
