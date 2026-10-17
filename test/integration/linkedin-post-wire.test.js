/**
 * Scripted HTTP responses prove request/receipt handling, not LinkedIn acceptance.
 * LinkedIn wire — the REAL poster and identity read against a REAL loopback
 * LinkedIn-shaped server, through the platform's own env door
 * (NEUMA_LINKEDIN_API_ROOT), on the REAL http wire (RULE 0 — no mocks): the
 * loopback asserts the exact headers and body LinkedIn's ugcPosts API
 * documents, and answers the shapes it really answers.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import {
  linkedinPostRequest, postToLinkedIn, readLinkedInIdentity,
} from '../../backend/services/social/linkedin-poster.js';

const CREDS = Object.freeze({
  personUrn: 'urn:li:person:8675309',
  accessToken: 'li-token',
  tokenExpiresAt: '2099-01-01T00:00:00.000Z',
});

// Every hit the loopback records — the wire-assertion surface.
const hits = [];
let server;
const previousRoot = process.env.NEUMA_LINKEDIN_API_ROOT;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://loopback');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/v2/userinfo') {
      hits.push({ leg: 'userinfo', auth: req.headers.authorization || null, body: rawBody });
      if (req.headers.authorization !== 'Bearer li-token') {
        if (req.headers.authorization === 'Bearer nosub-token') {
          return json(200, { name: 'No Sub Given' });
        }
        return json(401, { message: 'Invalid access token' });
      }
      return json(200, { sub: '8675309', name: 'Founder Doe' });
    }
    if (url.pathname === '/v2/ugcPosts') {
      hits.push({
        leg: 'ugcPosts',
        auth: req.headers.authorization || null,
        protocol: req.headers['x-restli-protocol-version'] || null,
        contentType: req.headers['content-type'] || null,
        body: rawBody ? JSON.parse(rawBody) : null,
      });
      if (req.headers.authorization === 'Bearer dead-token') {
        return json(401, { message: 'Invalid access token', status: 401 });
      }
      if (req.headers.authorization === 'Bearer mute-token') {
        // A 201 that names no post id — the poster must call it a failure.
        return json(201, { created: true });
      }
      if (req.headers.authorization === 'Bearer body-only-token') {
        // A 201 whose header was stripped but whose body still names the post.
        return json(201, { id: 'urn:li:share:456' });
      }
      return json(201, { id: 'urn:li:share:123' }, { 'X-RestLi-Id': 'urn:li:share:123' });
    }
    return json(404, { message: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.NEUMA_LINKEDIN_API_ROOT = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (previousRoot === undefined) delete process.env.NEUMA_LINKEDIN_API_ROOT;
  else process.env.NEUMA_LINKEDIN_API_ROOT = previousRoot;
  await new Promise((r) => server.close(r));
});

describe('the identity read (the credential proof)', () => {
  test('userinfo answers with the member the token speaks as', async () => {
    const me = await readLinkedInIdentity(CREDS);
    expect(me).toEqual({ ok: true, data: { sub: '8675309', name: 'Founder Doe' } });
    expect(hits.at(-1)).toMatchObject({ leg: 'userinfo', auth: 'Bearer li-token' });
  });

  test('a wrong token is an honest failure carrying the platform message', async () => {
    const me = await readLinkedInIdentity({ ...CREDS, accessToken: 'wrong' });
    expect(me).toEqual({ ok: false, status: 401, detail: 'Invalid access token' });
  });

  test('a 200 that names no member names the remedy, not a bare HTTP 200', async () => {
    const me = await readLinkedInIdentity({ ...CREDS, accessToken: 'nosub-token' });
    expect(me.ok).toBe(false);
    expect(me.status).toBe(200);
    expect(me.detail).toContain('named no member');
    expect(me.detail).toContain('OpenID Connect');
  });
});

describe('the publish wire', () => {
  test('a 201 with X-RestLi-Id is the proof — and the wire carried the documented call', async () => {
    const out = await postToLinkedIn(CREDS, 'Hello from the house');
    expect(out).toEqual({ ok: true, id: 'urn:li:share:123' });
    const hit = hits.at(-1);
    expect(hit.leg).toBe('ugcPosts');
    expect(hit.auth).toBe('Bearer li-token');
    expect(hit.protocol).toBe('2.0.0');
    expect(hit.contentType).toBe('application/json');
    // The body is exactly the documented ugcPosts shape — author URN inside,
    // token never inside.
    expect(hit.body).toEqual({
      author: 'urn:li:person:8675309',
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: 'Hello from the house' },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    });
    expect(JSON.stringify(hit.body)).not.toContain('li-token');
  });

  test('a 401 is the platform\'s own message, never a crash', async () => {
    const out = await postToLinkedIn({ ...CREDS, accessToken: 'dead-token' }, 'hi');
    expect(out).toEqual({ ok: false, status: 401, detail: 'Invalid access token' });
  });

  test('a 201 that names no post id is a failure — no id, no proof', async () => {
    const out = await postToLinkedIn({ ...CREDS, accessToken: 'mute-token' }, 'hi');
    expect(out.ok).toBe(false);
    expect(out.status).toBe(201);
    expect(out.detail).toContain('X-RestLi-Id');
  });

  test('a 201 whose header was stripped still proofs off the body id — a real publish never reads as a failure', async () => {
    const out = await postToLinkedIn({ ...CREDS, accessToken: 'body-only-token' }, 'hi');
    expect(out).toEqual({ ok: true, id: 'urn:li:share:456' });
  });

  test('the pure builder agrees with the wire the loopback just asserted', () => {
    const { url, headers, body } = linkedinPostRequest(CREDS, 'Hello from the house');
    expect(url).toBe(`${process.env.NEUMA_LINKEDIN_API_ROOT}/v2/ugcPosts`);
    expect(headers.Authorization).toBe('Bearer li-token');
    expect(body.author).toBe('urn:li:person:8675309');
  });
});


test('cancellation after the server receives a POST reports an unknown outcome', async () => {
  const previous = process.env.NEUMA_LINKEDIN_API_ROOT;
  const controller = new AbortController();
  let receivedBody;
  const receiver = http.createServer(async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    controller.abort();
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  process.env.NEUMA_LINKEDIN_API_ROOT = `http://127.0.0.1:${receiver.address().port}`;
  try {
    const result = await postToLinkedIn(CREDS, 'received before cancellation', { signal: controller.signal });
    expect(receivedBody.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text)
      .toBe('received before cancellation');
    expect(result).toEqual({ ok: false,
      detail: 'publishing was interrupted; the outcome is unknown — check LinkedIn before retrying' });
  } finally {
    process.env.NEUMA_LINKEDIN_API_ROOT = previous;
    receiver.closeAllConnections();
    await new Promise((resolve) => receiver.close(resolve));
  }
});
