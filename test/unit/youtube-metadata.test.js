/**
 * YouTube channel — the PURE parts (RULE 0: real inputs, real outputs, no
 * mocks): how an approved post's text becomes a video's metadata, YouTube's
 * limits, the AI disclosure that always rides, the queue's refusal of a
 * text-only YouTube post, plain-word error mapping, the PKCE/consent URL
 * builders, the resumable protocol's header arithmetic, video sniffing, and
 * the lost-send matcher.
 */
import { describe, test, expect } from 'vitest';
import {
  parseYouTubeDraft, buildVideoResource, youtubeDraftRefusal, mapYouTubeError, mapTokenError,
  tagsLength, TITLE_MAX, DESCRIPTION_MAX_BYTES, DEFAULT_PRIVACY,
} from '../../backend/services/social/youtube-metadata.js';
import { CONTAINS_SYNTHETIC_MEDIA } from '../../backend/services/image-forge/ai-disclosure.js';
import {
  pkceChallenge, buildAuthorizeUrl, authorizationCodeBody, refreshTokenBody, missingScopes,
  YOUTUBE_SCOPES, YOUTUBE_UPLOAD_SCOPE,
} from '../../backend/services/social/youtube-oauth.js';
import { contentRange, nextOffsetFromRange, isRetryableStatus } from '../../backend/services/social/youtube-upload.js';
import { sniffVideoType } from '../../backend/services/social/video-media.js';
import { matchLiveUpload } from '../../backend/services/social/youtube-reconcile.js';
import { validateDraft } from '../../backend/services/social/queue-rules.js';
import { getChannel, maskChannelCredentials } from '../../backend/services/social/channel-registry.js';
import { postsOwnMedia } from '../../backend/services/social/poster-registry.js';

describe('the draft text becomes the video\'s metadata', () => {
  test('first line = title, the rest = description word for word (the AI label is the video\'s metadata), unlisted by default', () => {
    const r = parseYouTubeDraft('Forge night #3\n\nA short walk through the armillary.\nMade live.');
    expect(r.ok).toBe(true);
    expect(r.meta.title).toBe('Forge night #3');
    expect(r.meta.description).toBe('A short walk through the armillary.\nMade live.');
    expect(r.meta.privacyStatus).toBe(DEFAULT_PRIVACY);
    expect(DEFAULT_PRIVACY).toBe('unlisted');
    expect(r.meta.tags).toEqual([]);
  });

  test('privacy and tags lines are settings: read, never published', () => {
    const r = parseYouTubeDraft('Title here\nprivacy: PUBLIC\nBody words\nTags: armillary, #deus neuma , ai art');
    expect(r.ok).toBe(true);
    expect(r.meta.privacyStatus).toBe('public');
    expect(r.meta.tags).toEqual(['armillary', 'deus neuma', 'ai art']);
    expect(r.meta.description).not.toMatch(/privacy|Tags:/i);
    expect(parseYouTubeDraft('T\nprivacy: private').meta.privacyStatus).toBe('private');
  });

  test('a title-only post has no description: the disclosure is the video\'s flag, never a line', () => {
    expect(parseYouTubeDraft('Just a title').meta.description).toBe('');
  });

  test('limits: title 100 characters, description 5000 bytes, tags 500, no angle brackets', () => {
    expect(parseYouTubeDraft('x'.repeat(TITLE_MAX)).ok).toBe(true);
    expect(parseYouTubeDraft('x'.repeat(TITLE_MAX + 1)).detail).toMatch(/101 characters; YouTube allows at most 100/);
    // Code points, not UTF-16 units: 100 emoji is a legal title.
    expect(parseYouTubeDraft('🎬'.repeat(TITLE_MAX)).ok).toBe(true);
    expect(parseYouTubeDraft(`T\n${'a'.repeat(DESCRIPTION_MAX_BYTES)}`).ok).toBe(true);
    expect(parseYouTubeDraft(`T\n${'a'.repeat(DESCRIPTION_MAX_BYTES + 1)}`).detail).toMatch(/5001 bytes; YouTube allows at most 5000/);
    // Multi-byte characters count as bytes: 2000 × 3-byte kana is over.
    expect(parseYouTubeDraft(`T\n${'あ'.repeat(2000)}`).ok).toBe(false);
    expect(parseYouTubeDraft('A <b> title').detail).toMatch(/< and >/);
    expect(parseYouTubeDraft('T\nbody with > arrow').ok).toBe(false);
    const many = Array.from({ length: 80 }, (_, i) => `tag${i}xx`).join(', ');
    expect(parseYouTubeDraft(`T\ntags: ${many}`).detail).toMatch(/YouTube allows 500 in total/);
    expect(tagsLength(['a b', 'c'])).toBe(3 + 2 + 1 + 1);
  });

  test('refusals: no title, a bad privacy, a setting said twice', () => {
    expect(parseYouTubeDraft('\n\n  \n').detail).toMatch(/needs a title/);
    expect(parseYouTubeDraft('T\nprivacy: friends').detail).toMatch(/public, unlisted or private/);
    expect(parseYouTubeDraft('T\nprivacy: public\nprivacy: private').detail).toMatch(/at most once/);
  });

  test('the video resource: not for kids, containsSyntheticMedia ALWAYS true', () => {
    const resource = buildVideoResource(parseYouTubeDraft('T\nB\ntags: one').meta);
    expect(CONTAINS_SYNTHETIC_MEDIA).toBe(true);
    expect(resource).toEqual({
      snippet: { title: 'T', description: 'B', tags: ['one'] },
      status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    });
    expect(buildVideoResource(parseYouTubeDraft('T').meta).snippet.tags).toBeUndefined();
  });
});

describe('the queue law for a YouTube draft', () => {
  const video = [{ path: '/house/cards/clip.mp4', alt: '' }];
  test('a text-only post on YouTube is refused clearly, at staging', () => {
    const refusal = validateDraft({ channelId: 'youtube', text: 'A title\nno video here' });
    expect(refusal).toMatch(/YouTube takes videos only: a text-only post cannot go to YouTube/);
    expect(youtubeDraftRefusal({ text: 'T', media: [] })).toMatch(/text-only/);
  });
  test('exactly one video, a valid title, no reply kinds', () => {
    expect(validateDraft({ channelId: 'youtube', text: 'A title\nwords', media: video })).toBeNull();
    expect(validateDraft({ channelId: 'youtube', text: 'T', media: [...video, ...video] })).toMatch(/exactly one video/);
    expect(validateDraft({ channelId: 'youtube', text: 'x'.repeat(120), media: video })).toMatch(/title/);
    expect(youtubeDraftRefusal({ text: 'T', media: video, kind: 'reply' })).toMatch(/no replies or threads/);
  });
  test('other channels are untouched by the YouTube law', () => {
    expect(validateDraft({ channelId: 'telegram', text: 'text only is fine here' })).toBeNull();
  });
});

describe('the channel entry', () => {
  test('YouTube is queue-only, posts its own media, and its refresh token is a CONNECT field', () => {
    const yt = getChannel('youtube');
    expect(yt.queueOnly).toBe(true);
    expect(postsOwnMedia('youtube')).toBe(true);
    expect(postsOwnMedia('x')).toBe(false);
    expect(yt.fields.map((f) => [f.key, f.secret, Boolean(f.connect)])).toEqual([
      ['clientId', false, false], ['clientSecret', true, false], ['refreshToken', true, true],
    ]);
    const masked = maskChannelCredentials(yt, { clientId: 'id', clientSecret: 's' }, {});
    expect(masked.configured).toBe(false); // no refresh token yet = not connected
    expect(masked.fields.find((f) => f.key === 'refreshToken')).toMatchObject({ connect: true, set: false });
    expect(JSON.stringify(masked)).not.toContain('"s"');
  });
});

describe('errors in plain words', () => {
  const body = (reason, message = 'x') => ({ error: { code: 403, message, errors: [{ reason }] } });
  test('quota, upload limit, too big, permissions, signup', () => {
    expect(mapYouTubeError(403, body('quotaExceeded'))).toMatch(/daily quota.*10,000 units and 100 uploads.*midnight Pacific/);
    expect(mapYouTubeError(400, body('uploadLimitExceeded'))).toMatch(/upload limit/);
    expect(mapYouTubeError(413, {})).toMatch(/too big/);
    expect(mapYouTubeError(403, body('insufficientPermissions'))).toMatch(/reconnect YouTube/);
    expect(mapYouTubeError(401, {})).toMatch(/reconnect YouTube/);
    expect(mapYouTubeError(401, body('youtubeSignupRequired'))).toMatch(/no YouTube channel/);
    expect(mapYouTubeError(500, { error: { message: 'Backend Error' } })).toMatch(/Backend Error.*nothing was published/);
  });
  test('a revoked or expired token means reconnect, and names the 7-day Testing trap', () => {
    const revoked = mapTokenError(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    expect(revoked.reconnect).toBe(true);
    expect(revoked.detail).toMatch(/revoked or has expired.*CONNECT.*In production/);
    expect(mapTokenError(401, { error: 'invalid_client' }).detail).toMatch(/client id or secret/);
    expect(mapTokenError(500, {}).reconnect).toBe(false);
  });
});

describe('OAuth builders', () => {
  test('PKCE S256 matches the RFC 7636 appendix B example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  test('the consent URL asks for upload + readonly only, offline, S256, on the loopback redirect', () => {
    const url = new URL(buildAuthorizeUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555', challenge: 'ch', state: 'st' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid', redirect_uri: 'http://127.0.0.1:5555', response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      code_challenge: 'ch', code_challenge_method: 'S256', state: 'st', access_type: 'offline', prompt: 'consent',
    });
    expect(YOUTUBE_SCOPES).toHaveLength(2);
  });
  test('token bodies and the granted-scope check', () => {
    expect(authorizationCodeBody({ clientId: 'c', clientSecret: 's', code: 'k', verifier: 'v', redirectUri: 'r' }))
      .toEqual({ code: 'k', client_id: 'c', client_secret: 's', redirect_uri: 'r', grant_type: 'authorization_code', code_verifier: 'v' });
    expect(refreshTokenBody({ clientId: 'c', clientSecret: 's', refreshToken: 'rt' }))
      .toEqual({ client_id: 'c', client_secret: 's', refresh_token: 'rt', grant_type: 'refresh_token' });
    expect(missingScopes(YOUTUBE_SCOPES.join(' '))).toEqual([]);
    expect(missingScopes('https://www.googleapis.com/auth/youtube.readonly')).toEqual([YOUTUBE_UPLOAD_SCOPE]);
  });
});

describe('resumable protocol arithmetic', () => {
  test('Content-Range, the 308 Range header, and what is retried', () => {
    expect(contentRange(0, 262143, 1000000)).toBe('bytes 0-262143/1000000');
    expect(nextOffsetFromRange('bytes=0-524287')).toBe(524288);
    expect(nextOffsetFromRange(null)).toBe(0);
    expect(nextOffsetFromRange('garbage')).toBe(0);
    expect([500, 502, 503, 504].every(isRetryableStatus)).toBe(true);
    expect(isRetryableStatus(400) || isRetryableStatus(403) || isRetryableStatus(404)).toBe(false);
  });
});

describe('video sniffing by magic bytes', () => {
  const ftyp = (brand) => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from(`ftyp${brand}`, 'latin1'), Buffer.alloc(8)]);
  test('MP4, QuickTime, WebM; a PNG or text is no video', () => {
    expect(sniffVideoType(ftyp('isom'))).toBe('video/mp4');
    expect(sniffVideoType(ftyp('qt  '))).toBe('video/quicktime');
    expect(sniffVideoType(Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('video/webm');
    expect(sniffVideoType(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]))).toBeNull();
    expect(sniffVideoType(Buffer.from('not a video at all'))).toBeNull();
    expect(sniffVideoType(Buffer.alloc(3))).toBeNull();
  });
});

describe('a lost send is matched only to the video it IS', () => {
  const entry = { text: 'Forge night\nbody', sendingAt: '2026-10-23T10:00:00.000Z' };
  test('same title, uploaded after the claim → that video; an older namesake never', () => {
    expect(matchLiveUpload(entry, [
      { id: 'old', title: 'Forge night', publishedAt: '2026-10-01T00:00:00Z' },
      { id: 'new', title: 'Forge night', publishedAt: '2026-10-23T10:20:00Z' },
    ])?.id).toBe('new');
    expect(matchLiveUpload(entry, [{ id: 'old', title: 'Forge night', publishedAt: '2026-10-01T00:00:00Z' }])).toBeNull();
    expect(matchLiveUpload(entry, [{ id: 'x', title: 'Other', publishedAt: '2026-10-23T10:20:00Z' }])).toBeNull();
  });
});
