/**
 * LinkedIn poster — the pure UGC request builders and the mortal-token
 * expiry note, proven with real inputs and outputs. The abort and
 * not-configured gates run the REAL poster functions (RULE 0 — no mocks).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  linkedinPostRequest, linkedinIdentityRequest, linkedinExpiryNote,
  postToLinkedIn, readLinkedInIdentity,
} from '../../backend/services/social/linkedin-poster.js';

// The person URN shape from LinkedIn's own ugcPosts documentation.
const CREDS = Object.freeze({
  personUrn: 'urn:li:person:8675309',
  accessToken: 'li-token',
  tokenExpiresAt: '2026-11-01T00:00:00.000Z',
});

const savedRoot = process.env.NEUMA_LINKEDIN_API_ROOT;
beforeEach(() => { delete process.env.NEUMA_LINKEDIN_API_ROOT; });
afterEach(() => {
  if (savedRoot === undefined) delete process.env.NEUMA_LINKEDIN_API_ROOT;
  else process.env.NEUMA_LINKEDIN_API_ROOT = savedRoot;
});

describe('linkedinPostRequest builds the documented ugcPosts wire', () => {
  test('author, commentary, visibility PUBLIC — token in the header only', () => {
    const req = linkedinPostRequest(CREDS, 'Hello from the house');
    expect(req).toEqual({
      url: 'https://api.linkedin.com/v2/ugcPosts',
      headers: {
        Authorization: 'Bearer li-token',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: {
        author: 'urn:li:person:8675309',
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: 'Hello from the house' },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      },
    });
    expect(req.url).not.toContain('li-token');
    expect(Object.isFrozen(req)).toBe(true);
    expect(Object.isFrozen(req.body)).toBe(true);
  });

  test('the env door aims the wire at the loopback root', () => {
    process.env.NEUMA_LINKEDIN_API_ROOT = 'http://127.0.0.1:9';
    expect(linkedinPostRequest(CREDS, 'x').url).toBe('http://127.0.0.1:9/v2/ugcPosts');
    expect(linkedinIdentityRequest(CREDS).url).toBe('http://127.0.0.1:9/v2/userinfo');
  });

  test('linkedinIdentityRequest rides the same headers — one wire path', () => {
    expect(linkedinIdentityRequest(CREDS)).toEqual({
      url: 'https://api.linkedin.com/v2/userinfo',
      headers: { Authorization: 'Bearer li-token', 'X-Restli-Protocol-Version': '2.0.0' },
    });
  });
});

describe('linkedinExpiryNote — the mortal-token courtesy (pure)', () => {
  const NOW = Date.parse('2026-09-01T00:00:00.000Z');

  test('silent when the date is missing, LOUD when it is unreadable — a mistyped expiry never reads as a healthy lane', () => {
    expect(linkedinExpiryNote(undefined, NOW)).toBeNull();
    expect(linkedinExpiryNote('', NOW)).toBeNull();
    expect(linkedinExpiryNote('not-a-date', NOW))
      .toBe('the recorded token expiry is unreadable — re-record it (docs/user/integrations/linkedin.md)');
  });

  test('silent while more than 7 days remain', () => {
    expect(linkedinExpiryNote('2026-09-30T00:00:00.000Z', NOW)).toBeNull();
  });

  test('warns within 7 days, singular and plural', () => {
    expect(linkedinExpiryNote('2026-09-07T12:00:00.000Z', NOW))
      .toBe('the token expires in 7 days — re-auth soon (docs/user/integrations/linkedin.md)');
    expect(linkedinExpiryNote('2026-09-02T00:00:00.000Z', NOW))
      .toBe('the token expires in 1 day — re-auth soon (docs/user/integrations/linkedin.md)');
  });

  test('a passed expiry says so', () => {
    expect(linkedinExpiryNote('2026-08-31T00:00:00.000Z', NOW))
      .toBe('the token\'s recorded expiry has passed — re-auth now (docs/user/integrations/linkedin.md)');
  });
});

describe('the poster and identity gates (real functions, no network needed)', () => {
  test('not-configured is an honest outcome, never a throw', async () => {
    expect(await postToLinkedIn(null, 'hi'))
      .toEqual({ ok: false, detail: 'LinkedIn credentials are not configured' });
    const me = await readLinkedInIdentity(null);
    expect(me.ok).toBe(false);
    expect(me.detail).toContain('not configured');
  });

  test('the operator barge-in signal cuts the publish before any request leaves', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await postToLinkedIn(CREDS, 'hi', { signal: controller.signal }))
      .toEqual({ ok: false, detail: 'interrupted by your operator before publishing' });
  });

  test('the barge-in cuts the identity lookup too — named as a lookup, never as a publish', async () => {
    const controller = new AbortController();
    controller.abort();
    const me = await readLinkedInIdentity(CREDS, { signal: controller.signal });
    expect(me).toEqual({ ok: false, detail: 'interrupted by your operator before the account lookup finished' });
  });
});
