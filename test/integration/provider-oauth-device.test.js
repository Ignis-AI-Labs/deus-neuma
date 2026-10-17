/**
 * Provider OAuth — device flows (integration, RULE 0): the credential-store
 * union and the GitHub Copilot + xAI SuperGrok subscription sign-ins,
 * exercised against REAL local HTTP servers speaking the OAuth protocol
 * bytes (device code, token poll, refresh grant). Endpoint test doors
 * (NEUMA_OAUTH_*_BASE) repoint the hardcoded hosts; every module under test
 * runs for real, including the encrypted credential store on a real temp
 * disk. The OpenAI browser/PKCE flow lives in provider-oauth-openai.test.js.
 */
import http from 'http';
import path from 'path';
import os from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import {
  startDeviceFlow, pollDeviceFlow, oauthFlowsFor, oauthEntryStale, cancelFlow,
} from '../../backend/services/provider-oauth.js';
import { resolveUsableCredential } from '../../backend/services/oauth-token-broker.js';
import {
  loadCredentials, setCredential, mergeCredential, maskCredential, computeCredentialState,
} from '../../backend/services/provider-credentials.js';
import { getProvider } from '../../backend/services/provider-registry.js';

let tmp;
let saved;
let github;
let xai;
let githubCalls;
let xaiCalls;

const ENV_DOORS = [
  'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_OAUTH_GITHUB_BASE', 'NEUMA_OAUTH_XAI_BASE',
  'NEUMA_OAUTH_OPENAI_BASE', 'NEUMA_OAUTH_OPENAI_REDIRECT_PORT', 'NEUMA_OPENAI_OAUTH_CLIENT_ID',
];

const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const portOf = (server) => server.address().port;
const close = (server) => new Promise((resolve) => server.close(resolve));

beforeEach(async () => {
  saved = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  tmp = mkdtempSync(path.join(os.tmpdir(), 'oauth-test-'));
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(tmp, 'creds.json');

  // Real GitHub OAuth protocol server: device code → pending → access token.
  githubCalls = { device: 0, token: 0, bodies: [] };
  github = await listen((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      githubCalls.bodies.push({ url: req.url, body: raw });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/login/device/code') {
        githubCalls.device += 1;
        res.end(JSON.stringify({
          device_code: 'dc_test_123', user_code: 'ABCD-EFGH',
          verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900,
        }));
        return;
      }
      if (req.url === '/login/oauth/access_token') {
        githubCalls.token += 1;
        if (githubCalls.token === 1) {
          res.end(JSON.stringify({ error: 'authorization_pending' }));
        } else {
          res.end(JSON.stringify({ access_token: 'gho_real_test_token', token_type: 'bearer', scope: 'read:user' }));
        }
        return;
      }
      res.writeHead(404); res.end();
    });
  });

  // Real xAI OAuth protocol server: device code, token poll, refresh grant.
  xaiCalls = { device: 0, token: 0, refresh: 0, bodies: [] };
  xai = await listen((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      xaiCalls.bodies.push({ url: req.url, body: raw });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/oauth2/device/code') {
        xaiCalls.device += 1;
        res.end(JSON.stringify({
          device_code: 'xdc_test_456', user_code: 'WXYZ-1234',
          verification_uri: 'https://x.ai/device', interval: 1, expires_in: 300,
        }));
        return;
      }
      if (req.url === '/oauth2/token') {
        const params = new URLSearchParams(raw);
        if (params.get('grant_type') === 'refresh_token') {
          xaiCalls.refresh += 1;
          res.end(JSON.stringify({
            access_token: 'xai_refreshed_token', refresh_token: 'xai_refresh_2', expires_in: 3600,
          }));
          return;
        }
        xaiCalls.token += 1;
        if (xaiCalls.token === 1) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'authorization_pending' }));
        } else {
          res.end(JSON.stringify({
            access_token: 'xai_first_token', refresh_token: 'xai_refresh_1', expires_in: 3600,
          }));
        }
        return;
      }
      res.writeHead(404); res.end();
    });
  });

  process.env.NEUMA_OAUTH_GITHUB_BASE = `http://127.0.0.1:${portOf(github)}`;
  process.env.NEUMA_OAUTH_XAI_BASE = `http://127.0.0.1:${portOf(xai)}`;
});

afterEach(async () => {
  for (const k of ENV_DOORS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
  await Promise.all([close(github), close(xai)]);
});

describe('credential store union (pure merge)', () => {
  test('oauth patch replaces; a fresh key replaces back; endpoint merges onto either shape', () => {
    const oauth = mergeCredential(undefined, {
      type: 'oauth', access: 'a1', refresh: 'r1', expiresAt: 123, account: 'xai',
    });
    expect(oauth).toEqual({ type: 'oauth', access: 'a1', refresh: 'r1', expiresAt: 123, account: 'xai' });

    const keyed = mergeCredential(oauth, { apiKey: 'sk-plain' });
    expect(keyed).toEqual({ apiKey: 'sk-plain' });

    const withEndpoint = mergeCredential(oauth, { endpoint: 'https://proxy.example/v1' });
    expect(withEndpoint).toMatchObject({ type: 'oauth', access: 'a1', endpoint: 'https://proxy.example/v1' });

    expect(mergeCredential(undefined, { type: 'oauth', access: '' })).toBe(null);
  });

  test('masked view never carries raw tokens, but names the kind + account', () => {
    const entry = getProvider('xai');
    const storeEntry = { type: 'oauth', access: 'SECRET', refresh: 'SECRET2', expiresAt: 1, account: 'xai' };
    const state = computeCredentialState(entry, storeEntry, undefined);
    const masked = maskCredential(entry, state, storeEntry);
    expect(masked).toMatchObject({ hasKey: true, credentialKind: 'oauth', account: 'xai' });
    expect(JSON.stringify(masked)).not.toContain('SECRET');
  });
});

describe('GitHub Copilot device sign-in (real protocol server)', () => {
  test('start → pending → complete, credential stored, broker returns the bearer', async () => {
    expect(oauthFlowsFor('github-copilot')).toEqual(['device']);

    const flow = await startDeviceFlow('github-copilot');
    expect(flow.userCode).toBe('ABCD-EFGH');
    expect(flow.verificationUrl).toContain('github.com');
    expect(githubCalls.device).toBe(1);

    const first = await pollDeviceFlow('github-copilot');
    expect(first.status).toBe('pending');

    const second = await pollDeviceFlow('github-copilot');
    expect(second).toEqual({ status: 'complete', account: 'github' });

    // Stored in the real encrypted store on the real temp disk
    const stored = await loadCredentials();
    expect(stored['github-copilot']).toMatchObject({
      type: 'oauth', access: 'gho_real_test_token', account: 'github',
    });

    // The device code poll carried the exact RFC 8628 grant
    const grant = githubCalls.bodies.find((b) => b.url === '/login/oauth/access_token');
    expect(grant.body).toContain('urn:ietf:params:oauth:grant-type:device_code');
    expect(grant.body).toContain('dc_test_123');

    // The broker hands the bearer to the request path
    const cred = await resolveUsableCredential('github-copilot');
    expect(cred.apiKey).toBe('gho_real_test_token');
    expect(cred.endpoint).toBe('https://api.githubcopilot.com');
  });

  test('a second start replaces the pending flow; cancel clears it', async () => {
    await startDeviceFlow('github-copilot');
    await cancelFlow('github-copilot');
    const res = await pollDeviceFlow('github-copilot');
    expect(res.status).toBe('error');
  });
});

describe('xAI SuperGrok device sign-in + refresh (real protocol server)', () => {
  test('device flow stores an expiring oauth entry with a refresh token', async () => {
    const flow = await startDeviceFlow('xai');
    expect(flow.userCode).toBe('WXYZ-1234');

    await pollDeviceFlow('xai'); // pending
    const done = await pollDeviceFlow('xai');
    expect(done).toEqual({ status: 'complete', account: 'xai' });

    const stored = await loadCredentials();
    expect(stored.xai).toMatchObject({
      type: 'oauth', access: 'xai_first_token', refresh: 'xai_refresh_1', account: 'xai',
    });
    expect(stored.xai.expiresAt).toBeGreaterThan(Date.now());
    expect(oauthEntryStale(stored.xai)).toBe(false);
  });

  test('the broker refreshes a stale entry through the real refresh grant before use', async () => {
    // Seed an expired oauth entry directly into the real store
    await setCredential('xai', {
      type: 'oauth', access: 'xai_stale_token', refresh: 'xai_refresh_1',
      expiresAt: Date.now() - 1000, account: 'xai',
    });
    expect(oauthEntryStale((await loadCredentials()).xai)).toBe(true);

    const cred = await resolveUsableCredential('xai');
    expect(cred.apiKey).toBe('xai_refreshed_token');
    expect(xaiCalls.refresh).toBe(1);

    const grant = xaiCalls.bodies.find((b) => new URLSearchParams(b.body).get('grant_type') === 'refresh_token');
    expect(new URLSearchParams(grant.body).get('refresh_token')).toBe('xai_refresh_1');

    // The renewed entry persisted — a second resolution does NOT re-refresh
    const again = await resolveUsableCredential('xai');
    expect(again.apiKey).toBe('xai_refreshed_token');
    expect(xaiCalls.refresh).toBe(1);
  });

  test('a stale entry with no refresh token fails honestly', async () => {
    await setCredential('xai', {
      type: 'oauth', access: 'dead', expiresAt: Date.now() - 1000, account: 'xai',
    });
    await expect(resolveUsableCredential('xai')).rejects.toThrow('no refresh token');
  });
});
