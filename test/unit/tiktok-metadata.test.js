/**
 * The TikTok channel's pure law, called with real inputs (no mocks, nothing
 * to fake): TikTok's desktop PKCE (hex), the consent URL, the draft shape and
 * its limits, what creator info allows, the post_info that always carries
 * is_aigc, the chunk plan, the plain words for TikTok's refusals, a publish's
 * status, the reconciler's verdicts, the token's refresh moment, and the MP4
 * duration read.
 *
 * TikTok's Login Kit for Desktop page publishes no verifier/challenge pair
 * (read 2026-10-23), so the hex challenge is checked against the FIPS 180-2
 * SHA-256 test vectors: the same digest TikTok's sample computes
 * (CryptoJS.SHA256(verifier).toString(CryptoJS.enc.Hex)).
 */
import { describe, expect, test } from 'vitest';
import {
  tiktokPkceChallenge, mintTikTokPkce, buildTikTokAuthorizeUrl, missingTikTokScopes, tokenRecord, TIKTOK_SCOPES,
} from '../../backend/services/social/tiktok-oauth.js';
import {
  parseTikTokDraft, durationRefusal, buildPostInfo, chunkPlan, fileUploadSource, tiktokDraftRefusal, tiktokApproveRefusal,
  CAPTION_MAX, CHUNK_MIN_BYTES, VIDEO_MAX_BYTES,
} from '../../backend/services/social/tiktok-metadata.js';
import { mapTikTokError, mapTikTokTokenError, failReasonWords } from '../../backend/services/social/tiktok-errors.js';
import { readPublishState, landedOutcome } from '../../backend/services/social/tiktok-poster.js';
import { quoteBigIds } from '../../backend/services/social/tiktok-api.js';
import { settleFromStatus } from '../../backend/services/social/tiktok-reconcile.js';
import { needsRefresh, REFRESH_MARGIN_MS } from '../../backend/services/social/tiktok-token.js';
import { chunkContentRange, heldFromContentRange } from '../../backend/services/social/tiktok-upload.js';
import { mvhdSeconds } from '../../backend/services/social/video-duration.js';
import { postsOwnMedia, ownMediaChannel } from '../../backend/services/social/poster-registry.js';
import { validateDraft } from '../../backend/services/social/queue-rules.js';

const CREATOR = Object.freeze({
  creator_username: 'deusneuma',
  privacy_level_options: ['SELF_ONLY', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'],
  comment_disabled: false, duet_disabled: true, stitch_disabled: false,
  max_video_post_duration_sec: 600,
});
const meta = (text) => {
  const out = parseTikTokDraft(text);
  if (!out.ok) throw new Error(out.detail);
  return out.meta;
};

describe('Login Kit for Desktop: PKCE in TikTok\'s hex form, the consent, the token record', () => {
  test('the challenge is SHA-256 in hex (FIPS 180-2 vectors), never base64url', () => {
    expect(tiktokPkceChallenge('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(tiktokPkceChallenge('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    const { verifier, challenge, state } = mintTikTokPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge).toBe(tiktokPkceChallenge(verifier));
    expect(state.length).toBeGreaterThan(20);
  });

  test('the consent URL: client_key, comma-separated scopes, S256, the loopback redirect as given', () => {
    const url = new URL(buildTikTokAuthorizeUrl({ clientKey: 'aw123', redirectUri: 'http://127.0.0.1:5555/callback/', challenge: 'c'.repeat(64), state: 's1' }));
    expect(`${url.origin}${url.pathname}`).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: 'aw123', response_type: 'code', scope: 'user.info.basic,video.publish,video.upload',
      redirect_uri: 'http://127.0.0.1:5555/callback/', state: 's1', code_challenge: 'c'.repeat(64), code_challenge_method: 'S256',
    });
  });

  test('granted scopes are read comma-separated; the token record dates the access token', () => {
    expect(missingTikTokScopes('user.info.basic,video.publish,video.upload')).toEqual([]);
    expect(missingTikTokScopes('user.info.basic,video.upload')).toEqual(['video.publish']);
    expect(missingTikTokScopes('')).toEqual([...TIKTOK_SCOPES]);
    expect(tokenRecord({ access_token: 'a', refresh_token: 'r', expires_in: 86400 }, Date.parse('2026-10-23T00:00:00Z')))
      .toEqual({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: '2026-10-24T00:00:00.000Z' });
  });

  test('refresh BEFORE expiry: inside the margin, missing or unreadable means refresh now', () => {
    const now = Date.parse('2026-10-23T00:00:00Z');
    const at = (ms) => ({ accessToken: 'a', accessExpiresAt: new Date(now + ms).toISOString() });
    expect(needsRefresh(at(REFRESH_MARGIN_MS + 60_000), now)).toBe(false);
    expect(needsRefresh(at(REFRESH_MARGIN_MS - 60_000), now)).toBe(true);
    expect(needsRefresh({ accessToken: 'a', accessExpiresAt: 'soon' }, now)).toBe(true);
    expect(needsRefresh({ accessExpiresAt: at(9e9).accessExpiresAt }, now)).toBe(true);
  });
});

describe('the draft shape', () => {
  test('a bare caption: a Direct Post with nothing suggested, so nothing is chosen for the person', () => {
    expect(meta('Forge night #3 #aiart')).toEqual({
      mode: 'post', caption: 'Forge night #3 #aiart',
      suggested: { privacyLevel: null, allow: { comment: false, duet: false, stitch: false }, promotion: { ownBrand: false, paid: false } },
    });
  });

  test('settings lines are the author\'s SUGGESTIONS, read and never published', () => {
    const m = meta('A walk through the armillary.\nprivacy: followers\nallow: comments, stitch\npromotion: own brand');
    expect(m).toEqual({
      mode: 'post', caption: 'A walk through the armillary.',
      suggested: {
        privacyLevel: 'FOLLOWER_OF_CREATOR', allow: { comment: true, duet: false, stitch: true }, promotion: { ownBrand: true, paid: false },
      },
    });
    expect(meta('x\nprivacy: Everyone').suggested.privacyLevel).toBe('PUBLIC_TO_EVERYONE');
    expect(meta('x\nprivacy: only me').suggested.privacyLevel).toBe('SELF_ONLY');
    expect(meta('x\nsend: drafts').mode).toBe('drafts');
  });

  test('refusals in plain words', () => {
    const detail = (text) => parseTikTokDraft(text).detail;
    expect(detail('x\nprivacy: secret')).toMatch(/only me, friends, followers or everyone/);
    expect(detail('x\nprivacy: constructor')).toMatch(/only me, friends, followers or everyone/);
    expect(detail('x\nallow: likes')).toMatch(/comments, duet and stitch/);
    expect(detail('x\nprivacy: only me\nprivacy: followers')).toMatch(/privacy line at most once/);
    expect(detail('x\npromotion: paid partnership\nprivacy: only me')).toMatch(/paid partnership to be private/);
    expect(detail('x\nsend: drafts\nprivacy: followers')).toMatch(/finished in the TikTok app/);
    expect(detail('x\nsend: later')).toMatch(/post or drafts/);
  });

  test('the caption limit counts UTF-16 units, as TikTok does', () => {
    expect(parseTikTokDraft('a'.repeat(CAPTION_MAX)).ok).toBe(true);
    // An emoji is two UTF-16 units: 1099 of them plus 3 letters is 2201.
    const over = parseTikTokDraft(`${'🎥'.repeat(1099)}abc`);
    expect(over.ok).toBe(false);
    expect(over.detail).toMatch(/2201 characters; TikTok allows at most 2200/);
  });

  test('staging refuses a text-only, a many-file or a reply-shaped TikTok draft', () => {
    expect(tiktokDraftRefusal({ text: 'Just words', media: [] })).toMatch(/text-only post cannot go to TikTok/);
    expect(tiktokDraftRefusal({ text: 'x', media: [{ path: 'a' }, { path: 'b' }] })).toMatch(/exactly one video; this draft carries 2/);
    expect(tiktokDraftRefusal({ text: 'x', media: [{ path: 'a' }], kind: 'reply' })).toMatch(/no replies or threads/);
    expect(tiktokDraftRefusal({ text: 'x', media: [{ path: 'a' }] })).toBeNull();
    expect(validateDraft({ channelId: 'tiktok', text: 'Just words' })).toMatch(/text-only post cannot go to TikTok/);
  });

  test('TikTok is a video channel: its own media, and a still is refused for now', () => {
    expect(postsOwnMedia('tiktok')).toBe(true);
    expect(ownMediaChannel('tiktok').photo).toBe('TikTok photo posts need a verified domain; coming later');
    expect(ownMediaChannel('x')).toBeNull();
  });
});

describe('the length the account takes, what a Direct Post carries, and what approves one', () => {
  const CONSENT = Object.freeze({
    privacyLevel: 'FOLLOWER_OF_CREATOR', allow: { comment: true, duet: false, stitch: true },
    commercial: { on: true, yourBrand: true, branded: false }, account: { username: 'deusneuma', nickname: 'Deus Neuma' },
  });

  test('a video longer than the account takes is refused; an unreadable length is left to TikTok', () => {
    expect(durationRefusal(CREATOR, 30)).toBeNull();
    expect(durationRefusal(CREATOR, 601)).toMatch(/601 seconds long; this TikTok account takes at most 600/);
    expect(durationRefusal(CREATOR, null)).toBeNull();
  });

  test('post_info: the caption and EXACTLY the approved choices, is_aigc ALWAYS true', () => {
    // The suggestion lines never reach post_info: the consent does.
    expect(buildPostInfo(meta('Forge night\nprivacy: everyone\nallow: duet').caption, CONSENT)).toEqual({
      title: 'Forge night', privacy_level: 'FOLLOWER_OF_CREATOR',
      disable_comment: false, disable_duet: true, disable_stitch: false,
      brand_content_toggle: false, brand_organic_toggle: true, is_aigc: true,
    });
    const bare = buildPostInfo('', { privacyLevel: 'SELF_ONLY' });
    expect(bare).toEqual({
      privacy_level: 'SELF_ONLY', disable_comment: true, disable_duet: true, disable_stitch: true,
      brand_content_toggle: false, brand_organic_toggle: false, is_aigc: true,
    });
  });

  test('the store approves a TikTok Direct Post only with a consent, for the copy that was read', () => {
    const entry = { channelId: 'tiktok', text: 'Forge night\nprivacy: followers' };
    expect(tiktokApproveRefusal(entry, { consent: CONSENT, textSeen: entry.text })).toBeNull();
    expect(tiktokApproveRefusal(entry, { textSeen: entry.text })).toMatch(/approved from its card, where you choose who can watch/);
    expect(tiktokApproveRefusal(entry, { consent: { ...CONSENT, privacyLevel: '' }, textSeen: entry.text })).toMatch(/approved from its card/);
    expect(tiktokApproveRefusal(entry, { consent: CONSENT, textSeen: 'Forge night' })).toMatch(/changed since its card was read/);
    // A draft for the TikTok inbox carries no choices; another channel is not this law's.
    expect(tiktokApproveRefusal({ channelId: 'tiktok', text: 'x\nsend: drafts' }, { textSeen: 'x\nsend: drafts' })).toBeNull();
    expect(tiktokApproveRefusal({ channelId: 'x', text: 'hi' }, {})).toBeNull();
  });
});

describe('the chunk plan (media transfer guide)', () => {
  test('under one chunk the video goes whole', () => {
    expect(chunkPlan(3_000_000)).toEqual({ ok: true, chunkSize: 3_000_000, count: 1, ranges: [{ start: 0, end: 3_000_000 }] });
  });

  test('the count rounds down and trailing bytes join the last chunk', () => {
    const size = 12_000_000;
    const plan = chunkPlan(size, CHUNK_MIN_BYTES);
    expect(plan).toMatchObject({ chunkSize: CHUNK_MIN_BYTES, count: 2 });
    expect(plan.ranges).toEqual([{ start: 0, end: CHUNK_MIN_BYTES }, { start: CHUNK_MIN_BYTES, end: size }]);
    expect(fileUploadSource(size, plan)).toEqual({ source: 'FILE_UPLOAD', video_size: size, chunk_size: CHUNK_MIN_BYTES, total_chunk_count: 2 });
    // Asked for less than TikTok's 5MB floor, the plan holds the floor.
    expect(chunkPlan(size, 1024).chunkSize).toBe(CHUNK_MIN_BYTES);
  });

  test('a 4GB video stays inside 1000 chunks with a last chunk under 128MB; over 4GB is refused', () => {
    const plan = chunkPlan(VIDEO_MAX_BYTES);
    expect(plan.count).toBeLessThanOrEqual(1000);
    const last = plan.ranges.at(-1);
    expect(last.end).toBe(VIDEO_MAX_BYTES);
    expect(last.end - last.start).toBeLessThanOrEqual(128 * 1024 * 1024);
    expect(chunkPlan(VIDEO_MAX_BYTES + 1).detail).toMatch(/TikTok takes at most 4GB/);
  });

  test('Content-Range both ways', () => {
    expect(chunkContentRange(0, 5, 12)).toBe('bytes 0-4/12');
    expect(heldFromContentRange('bytes 0-5242879/12000000')).toBe(5242880);
    expect(heldFromContentRange(null)).toBeNull();
  });
});

describe('TikTok\'s refusals in plain words', () => {
  test('the posting codes', () => {
    const words = (code, status = 403) => mapTikTokError(status, { error: { code } }).detail;
    expect(words('unaudited_client_can_only_post_to_private_accounts')).toMatch(/^TikTok keeps posts private until the app passes its review/);
    expect(words('reached_active_user_cap')).toMatch(/allows 5 a day/);
    expect(words('spam_risk_too_many_posts')).toMatch(/posting limit for today/);
    expect(words('spam_risk_user_banned_from_posting')).toMatch(/blocked this account from posting/);
    expect(words('rate_limit_exceeded', 429)).toMatch(/slow down/);
    expect(words('url_ownership_unverified')).toBe('TikTok photo posts need a verified domain; coming later');
    expect(mapTikTokError(401, { error: { code: 'access_token_invalid' } })).toMatchObject({ reconnect: true, detail: expect.stringMatching(/reconnect TikTok/) });
    expect(mapTikTokError(401, {}).reconnect).toBe(true);
    expect(mapTikTokError(400, { error: { code: 'invalid_param', message: 'title too long' } }).detail).toMatch(/\(title too long\); nothing was published/);
  });

  test('the token endpoint and a dropped publish', () => {
    expect(mapTikTokTokenError(400, { error: 'invalid_grant' })).toMatchObject({ reconnect: true, detail: expect.stringMatching(/expired or was removed; reconnect TikTok/) });
    expect(mapTikTokTokenError(401, { error: 'invalid_client' }).detail).toMatch(/client key or client secret/);
    expect(failReasonWords('duration_check_failed')).toMatch(/too long or too short.*nothing was published$/);
    expect(failReasonWords('picture_size_check_failed')).toMatch(/360 to 4096 pixels/);
    expect(failReasonWords('something_new')).toMatch(/\(something_new\); nothing was published/);
  });
});

describe('a publish\'s status, and the reconciler\'s verdicts', () => {
  test('status → state → the recorded outcome', () => {
    expect(readPublishState({ status: 'PROCESSING_UPLOAD' })).toEqual({ state: 'pending' });
    expect(readPublishState({ status: 'FAILED', fail_reason: 'frame_rate_check_failed' }).detail).toMatch(/23 to 60 frames/);
    const priv = readPublishState({ status: 'PUBLISH_COMPLETE' });
    expect(priv).toEqual({ state: 'published', postId: null });
    expect(landedOutcome(priv, { publishId: 'p1', username: 'deusneuma', privacyLevel: 'SELF_ONLY' })).toEqual({
      ok: true, id: 'p1', postedAs: { id: 'deusneuma', username: 'deusneuma' },
      url: 'https://www.tiktok.com/@deusneuma',
      text: 'published to TikTok (private: TikTok keeps posts private until the app passes its review); it may take a few minutes for the video to process and be visible on the profile',
    });
    // A 19-digit id survives the parse whole (a JS number would round it).
    const raw = '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000001]},"error":{"code":"ok"}}';
    const pub = readPublishState(JSON.parse(quoteBigIds(raw)).data);
    expect(landedOutcome(pub, { publishId: 'p1', username: 'deusneuma', privacyLevel: 'PUBLIC_TO_EVERYONE' }))
      .toMatchObject({ id: '7300000000000000001', url: 'https://www.tiktok.com/@deusneuma/video/7300000000000000001', text: expect.stringMatching(/^published to TikTok; it may take a few minutes/) });
    expect(landedOutcome({ state: 'inbox' }, { publishId: 'p2', username: '', privacyLevel: null }))
      .toMatchObject({ ok: true, id: 'p2', url: null, text: expect.stringMatching(/sent to TikTok drafts.*AI-generated content label/) });
  });

  test('no ticket: nothing went out; a status read decides the rest; a day of processing gives up', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    const entry = (extra) => ({ id: 'q1', text: 'x', sendingAt: '2026-10-23T09:00:00Z', ...extra });
    expect(settleFromStatus(entry({}), null, now)).toMatchObject({ ok: false, detail: expect.stringMatching(/before TikTok received the video/) });
    expect(settleFromStatus(entry({ sendTicket: 'p1' }), { ok: false }, now)).toBeNull();
    expect(settleFromStatus(entry({ sendTicket: 'p1' }), { ok: true, data: { status: 'PROCESSING_UPLOAD' } }, now)).toBeNull();
    expect(settleFromStatus(entry({ sendTicket: 'p1', sendingAt: '2026-10-22T09:00:00Z' }), { ok: true, data: { status: 'PROCESSING_UPLOAD' } }, now))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/never finished processing/) });
    expect(settleFromStatus(entry({ sendTicket: 'p1' }), { ok: true, data: { status: 'PUBLISH_COMPLETE' } }, now)).toMatchObject({ ok: true, id: 'p1' });
    expect(settleFromStatus(entry({ sendTicket: 'p1' }), { ok: true, data: { status: 'FAILED', fail_reason: 'spam_risk_text' } }, now))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/caption as a spam risk/) });
  });
});

describe('the MP4 movie header', () => {
  const mvhd = (version, timescale, duration) => {
    const b = Buffer.alloc(version === 1 ? 108 : 96);
    b[0] = version;
    if (version === 1) { b.writeUInt32BE(timescale, 20); b.writeBigUInt64BE(BigInt(duration), 24); } else { b.writeUInt32BE(timescale, 12); b.writeUInt32BE(duration, 16); }
    return b;
  };
  test('v0 and v1 headers read as seconds; a broken header reads as unknown', () => {
    expect(mvhdSeconds(mvhd(0, 1000, 3000))).toBe(3);
    expect(mvhdSeconds(mvhd(1, 90000, 90000 * 601))).toBe(601);
    expect(mvhdSeconds(mvhd(0, 0, 3000))).toBeNull();
    expect(mvhdSeconds(Buffer.alloc(4))).toBeNull();
  });
});
