/* global URL, fetch, URLSearchParams, setTimeout */
/**
 * LINKEDIN CONNECT through the real flow (RULE 0, no double): the house's real
 * connect flow, real loopback receiver on its one registered address, real
 * sealed account store on tmp disk, and real HTTP to a server on this machine
 * answering as LinkedIn does for the token exchange and the member's identity.
 * Placeholder keys only. Proven: no client, no consent; the consent goes to
 * the registered address with the three scopes; a sign-in seals the member,
 * the token and the day it dies onto ITS account; a grant missing the posting
 * scope seals nothing; the same member is refused as a second account.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import process from 'process';
import { standTwoHouses, HOUSE_A } from '../helpers/house-office-kit.js';
import { setChannelCredential } from '../../backend/services/social/channel-credentials.js';
import { addAccount, resolveAccountCredential, loadAccountStore } from '../../backend/services/social/account-store.js';
import { startLinkedInConnect, pollLinkedInConnect, cancelLinkedInConnect } from '../../backend/services/social/linkedin-connect.js';
import { LINKEDIN_REDIRECT_URI, buildLinkedInAuthorizeUrl, missingLinkedInScopes, linkedinTokenRecord } from '../../backend/services/social/linkedin-oauth.js';
import { getChannel } from '../../backend/services/social/channel-registry.js';

const ENV = ['NEUMA_LINKEDIN_OAUTH_ROOT', 'NEUMA_LINKEDIN_API_ROOT'];
const APP = Object.freeze({ clientId: 'ph-li-client', clientSecret: 'ph-li-secret' });
// code → what LinkedIn would answer for it.
const GRANTS = Object.freeze({
  'founder:code': { access_token: 'ph-li-token-founder', expires_in: 5184000, scope: 'openid,profile,w_member_social', sub: 'FOUNDER123', name: 'Rowan Hale' },
  'narrow:code': { access_token: 'ph-li-token-narrow', expires_in: 5184000, scope: 'openid,profile', sub: 'NRW9', name: 'Narrow Grant' },
});
let linkedin; let exchanges; let saved; let houses;

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  exchanges = [];
  linkedin = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://li');
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'POST' && url.pathname === '/oauth/v2/accessToken') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const form = Object.fromEntries(new URLSearchParams(raw));
        exchanges.push(form);
        const grant = GRANTS[form.code];
        if (form.client_id !== APP.clientId || form.client_secret !== APP.clientSecret || !grant) return json(400, { error: 'invalid_request', error_description: 'the code or the client was not accepted' });
        return json(200, { access_token: grant.access_token, expires_in: grant.expires_in, scope: grant.scope });
      });
      return;
    }
    if (url.pathname === '/v2/userinfo') {
      const grant = Object.values(GRANTS).find((g) => req.headers.authorization === `Bearer ${g.access_token}`);
      return grant ? json(200, { sub: grant.sub, name: grant.name }) : json(401, { message: 'Invalid access token' });
    }
    return json(404, {});
  });
  await new Promise((r) => linkedin.listen(0, '127.0.0.1', r));
  const root = `http://127.0.0.1:${linkedin.address().port}`;
  process.env.NEUMA_LINKEDIN_OAUTH_ROOT = root;
  process.env.NEUMA_LINKEDIN_API_ROOT = root;
});

afterAll(async () => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await new Promise((r) => linkedin.close(r));
});

beforeEach(async () => { houses = await standTwoHouses({ label: 'linkedin-connect' }); exchanges.length = 0; });
afterEach(() => { cancelLinkedInConnect(HOUSE_A, 'linkedin-1'); cancelLinkedInConnect(HOUSE_A, 'linkedin-2'); return houses.restore(); });

const signIn = (authUrl, code) => {
  const url = new URL(authUrl);
  return fetch(`${url.searchParams.get('redirect_uri')}?${new URLSearchParams({ code, state: url.searchParams.get('state') })}`);
};
const settled = async (accountId) => {
  for (let i = 0; i < 150; i += 1) {
    const r = pollLinkedInConnect(HOUSE_A, accountId);
    if (r.status !== 'pending') return r;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('never settled');
};

describe('the LinkedIn sign-in, as it is asked and read (pure)', () => {
  test('the consent names the app, the registered address and exactly the three scopes', () => {
    const url = new URL(buildLinkedInAuthorizeUrl({ clientId: 'abc', redirectUri: LINKEDIN_REDIRECT_URI, state: 's1' }));
    expect(url.pathname).toBe('/oauth/v2/authorization');
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: 'code', client_id: 'abc', redirect_uri: 'http://127.0.0.1:53682/linkedin/callback', state: 's1', scope: 'openid profile w_member_social' });
  });
  test('a grant is whole only with all three scopes; the token carries the day it dies', () => {
    expect(missingLinkedInScopes('openid,profile,w_member_social')).toEqual([]);
    expect(missingLinkedInScopes('openid profile')).toEqual(['w_member_social']);
    expect(missingLinkedInScopes(undefined)).toEqual(['openid', 'profile', 'w_member_social']);
    expect(linkedinTokenRecord({ access_token: 't', expires_in: 86400 }, Date.parse('2026-11-15T00:00:00.000Z'))).toEqual({ accessToken: 't', tokenExpiresAt: '2026-11-16T00:00:00.000Z' });
    expect(linkedinTokenRecord({ access_token: 't' }, Date.parse('2026-11-15T00:00:00.000Z')).tokenExpiresAt).toBe('2027-01-14T00:00:00.000Z');
  });
  test('the channel keeps working for an account connected by hand: the app client is optional, the rest is set by CONNECT', () => {
    const fields = Object.fromEntries(getChannel('linkedin').fields.map((f) => [f.key, f]));
    expect(fields.clientId.fallback).toBe('none');
    expect(fields.clientSecret).toMatchObject({ secret: true, fallback: 'none' });
    expect(['personUrn', 'accessToken', 'tokenExpiresAt'].every((k) => fields[k].connect === true)).toBe(true);
  });
});

describe('LINKEDIN CONNECT through the real flow (gnosis)', () => {
  test('with no app client saved there is no consent, and the operator is told what to save and which address to register', async () => {
    const started = await startLinkedInConnect(HOUSE_A, 'linkedin-1');
    expect(started.ok).toBe(false);
    expect(JSON.stringify(started)).toContain('http://127.0.0.1:53682/linkedin/callback');
    expect(exchanges).toEqual([]);
  });

  test('a sign-in seals the member, the token and its expiry onto that account, and the house can then post as them', async () => {
    await setChannelCredential(HOUSE_A, 'linkedin', APP);
    const started = await startLinkedInConnect(HOUSE_A, 'linkedin-1');
    expect(started.ok).toBe(true);
    expect(new URL(started.authUrl).searchParams.get('redirect_uri')).toBe(LINKEDIN_REDIRECT_URI);
    expect(pollLinkedInConnect(HOUSE_A, 'linkedin-1')).toEqual({ status: 'pending' });
    expect((await signIn(started.authUrl, 'founder:code')).status).toBe(200);
    const done = await settled('linkedin-1');
    expect(done).toMatchObject({ status: 'complete', channel: { id: 'FOUNDER123', title: 'Rowan Hale' } });
    expect(exchanges).toMatchObject([{ grant_type: 'authorization_code', code: 'founder:code', redirect_uri: LINKEDIN_REDIRECT_URI, client_id: APP.clientId }]);
    const credential = await resolveAccountCredential(HOUSE_A, 'linkedin-1');
    expect(credential).toMatchObject({ personUrn: 'urn:li:person:FOUNDER123', accessToken: 'ph-li-token-founder' });
    expect(Date.parse(credential.tokenExpiresAt) - Date.now()).toBeGreaterThan(59 * 86400 * 1000);
    expect((await loadAccountStore(HOUSE_A)).accounts['linkedin-1']).toMatchObject({ platformUserId: 'FOUNDER123', label: 'Rowan Hale' });
  });

  test('a grant without the posting scope seals nothing and says which LinkedIn products to add', async () => {
    await setChannelCredential(HOUSE_A, 'linkedin', APP);
    const started = await startLinkedInConnect(HOUSE_A, 'linkedin-1');
    await signIn(started.authUrl, 'narrow:code');
    const done = await settled('linkedin-1');
    expect(done.status).toBe('error');
    expect(done.error).toMatch(/granted without w_member_social — in your LinkedIn app add the products "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn"/);
    expect(await resolveAccountCredential(HOUSE_A, 'linkedin-1').catch(() => null)).toBeFalsy();
  });

  test('a code LinkedIn refuses seals nothing; the same member is refused as a second account of the house', async () => {
    await setChannelCredential(HOUSE_A, 'linkedin', APP);
    const bad = await startLinkedInConnect(HOUSE_A, 'linkedin-1');
    await signIn(bad.authUrl, 'forged:code');
    expect((await settled('linkedin-1')).error).toMatch(/LinkedIn refused the sign-in: the code or the client was not accepted/);
    const first = await startLinkedInConnect(HOUSE_A, 'linkedin-1');
    await signIn(first.authUrl, 'founder:code');
    expect((await settled('linkedin-1')).status).toBe('complete');
    await addAccount(HOUSE_A, 'linkedin', {});
    const second = await startLinkedInConnect(HOUSE_A, 'linkedin-2');
    await signIn(second.authUrl, 'founder:code');
    expect((await settled('linkedin-2')).error).toMatch(/already connected here as linkedin-1/);
  });
});
