/**
 * Provider OAuth — subscription sign-in flows for catalog providers.
 *
 * Two flow shapes, both RFC 8628 / PKCE standard:
 *   - device flow  (GitHub Copilot, xAI headless): the desk shows a user code
 *     + verification URL and polls; no loopback server needed
 *   - browser flow (xAI SuperGrok): PKCE with a loopback callback listener
 *
 * Provider constants (client ids, endpoints, scopes) are PUBLIC application
 * registrations, taken from OpenCode's source (the reference implementation
 * the operator chose):
 *   - Copilot: packages/opencode/src/plugin/github-copilot/copilot.ts
 *     (CLIENT_ID, device URLs, API version; the GitHub OAuth token is used
 *     directly as the api.githubcopilot.com bearer — no exchange step)
 *   - xAI: packages/opencode/src/plugin/xai.ts (Grok-CLI public client id —
 *     xAI's auth server rejects loopback OAuth from non-allowlisted clients —
 *     authorize/token/device URLs, exact registered loopback port 56121,
 *     `plan=generic` consent param)
 *
 * Tokens are stored in the encrypted provider-credentials store via
 * setCredential; pending flow state is in-memory only (a device code is a
 * short-lived, single-use secret — never persisted).
 *
 * Test doors: NEUMA_OAUTH_GITHUB_BASE / NEUMA_OAUTH_XAI_BASE repoint every
 * endpoint at a local protocol-speaking server (integration tests).
 */
import { createServer } from 'http';
import { randomBytes, createHash } from 'crypto';
import { loadCredentials, setCredential } from './provider-credentials.js';
import { createLogger } from './logger.js';
import {
  startOpenAIChatGPTLogin, pollOpenAIChatGPTLogin, cancelOpenAIChatGPTLogin,
  refreshOpenAIChatGPT, revokeOpenAIChatGPT,
} from './openai-chatgpt-oauth.js';

const log = createLogger('ProviderOAuth');

// --- Provider constants (public app registrations — see header) ---

const GITHUB = Object.freeze({
  clientId: 'Ov23li8tweQw6odWQebz',
  scope: 'read:user',
  apiVersion: '2026-06-01',
});
const githubBase = () => (process.env.NEUMA_OAUTH_GITHUB_BASE || 'https://github.com').replace(/\/$/, '');

const XAI = Object.freeze({
  clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
  scope: 'openid profile email offline_access grok-cli:access api:access',
  deviceGrant: 'urn:ietf:params:oauth:grant-type:device_code',
  redirectHost: '127.0.0.1',
  redirectPort: 56121,
  redirectPath: '/callback',
});
const xaiBase = () => (process.env.NEUMA_OAUTH_XAI_BASE || 'https://auth.x.ai').replace(/\/$/, '');
const XAI_REDIRECT_URI = `http://${XAI.redirectHost}:${XAI.redirectPort}${XAI.redirectPath}`;

const USER_AGENT = 'kenorie/0.1';
const SUPPORTED = Object.freeze({
  'github-copilot': Object.freeze(['device']),
  'xai': Object.freeze(['browser', 'device']),
  'openai-chatgpt': Object.freeze(['browser']),
});

/** Which flow kinds a provider supports ([] = keys only). Pure. */
export const oauthFlowsFor = (providerId) => SUPPORTED[providerId] || [];

// --- Pending flow state (in-memory, single pending flow per provider) ---

const pending = new Map();
const OAUTH_POLL_SAFETY_MS = 3000;

// pure — PKCE pair (S256) + anti-forgery state
const mintPkce = () => {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge, state: randomBytes(24).toString('base64url') };
};

// impure — JSON POST helper with the honesty discipline of the codebase
const postJson = async (url, body, formEncoded = false) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: formEncoded
      ? { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': USER_AGENT }
      : { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
    body: formEncoded ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

// --- Device flow ---

/**
 * impure — begin a device-authorization flow. Returns what the desk must show
 * (verification URL + user code); the device code stays server-side in the
 * pending map until poll completes or expires.
 */
export const startDeviceFlow = async (providerId) => {
  if (!oauthFlowsFor(providerId).includes('device')) {
    throw new Error(`No device flow for provider: ${providerId}`);
  }
  if (pending.has(providerId)) pending.delete(providerId);

  const { ok, status, data } = providerId === 'github-copilot'
    ? await postJson(`${githubBase()}/login/device/code`, { client_id: GITHUB.clientId, scope: GITHUB.scope })
    : await postJson(`${xaiBase()}/oauth2/device/code`, { client_id: XAI.clientId, scope: XAI.scope }, true);
  if (!ok || !data.device_code) {
    throw new Error(`device code request failed (${status})${data.error_description ? `: ${data.error_description}` : ''}`);
  }

  const intervalMs = Math.max((Number(data.interval) || 5) * 1000, 1000);
  const expiresInMs = (Number(data.expires_in) || 300) * 1000;
  pending.set(providerId, {
    kind: 'device',
    deviceCode: data.device_code,
    intervalMs,
    deadline: Date.now() + expiresInMs,
  });

  return {
    verificationUrl: data.verification_uri_complete || data.verification_uri,
    userCode: data.user_code,
    expiresIn: Math.round(expiresInMs / 1000),
    pollAfterMs: intervalMs + OAUTH_POLL_SAFETY_MS,
  };
};

/**
 * impure — ONE poll of the token endpoint (the desk drives the cadence).
 * On success the credential is stored and the pending flow cleared.
 * @returns {Promise<{status: 'pending'|'complete'|'denied'|'expired'|'error', error?: string, account?: string}>}
 */
export const pollDeviceFlow = async (providerId) => {
  const flow = pending.get(providerId);
  if (!flow || flow.kind !== 'device') return { status: 'error', error: 'no pending device flow' };
  if (Date.now() > flow.deadline) {
    pending.delete(providerId);
    return { status: 'expired' };
  }

  const { status, data } = providerId === 'github-copilot'
    ? await postJson(`${githubBase()}/login/oauth/access_token`, {
      client_id: GITHUB.clientId,
      device_code: flow.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })
    : await postJson(`${xaiBase()}/oauth2/token`, {
      grant_type: XAI.deviceGrant,
      client_id: XAI.clientId,
      device_code: flow.deviceCode,
    }, true);

  if (data.access_token) {
    pending.delete(providerId);
    const entry = providerId === 'github-copilot'
      // Copilot: the GitHub OAuth token IS the chat bearer, no expiry (source: opencode copilot.ts).
      ? { type: 'oauth', access: data.access_token, refresh: data.access_token, expiresAt: 0, account: 'github' }
      : {
        type: 'oauth',
        access: data.access_token,
        refresh: data.refresh_token || null,
        expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : 0,
        account: 'xai',
      };
    await setCredential(providerId, entry);
    log.info('oauth sign-in complete', { providerId, account: entry.account });
    return { status: 'complete', account: entry.account };
  }

  // RFC 8628 §3.5: pending keeps polling; slow_down bumps the interval ≥5s.
  if (data.error === 'authorization_pending') {
    return { status: 'pending', pollAfterMs: flow.intervalMs + OAUTH_POLL_SAFETY_MS };
  }
  if (data.error === 'slow_down') {
    flow.intervalMs += 5000;
    return { status: 'pending', pollAfterMs: flow.intervalMs + OAUTH_POLL_SAFETY_MS };
  }
  if (data.error === 'access_denied' || data.error === 'authorization_denied') {
    pending.delete(providerId);
    return { status: 'denied' };
  }
  if (data.error === 'expired_token') {
    pending.delete(providerId);
    return { status: 'expired' };
  }
  return { status: 'error', error: data.error_description || data.error || `token endpoint answered ${status}` };
};

// --- Browser flow (xAI SuperGrok PKCE + loopback callback) ---

/**
 * impure — begin a browser PKCE flow: bind the loopback listener on the exact
 * registered port and return the authorize URL for the desk to open. The flow
 * completes when the callback lands (pollBrowserFlow reports it).
 */
export const startBrowserFlow = async (providerId) => {
  if (!oauthFlowsFor(providerId).includes('browser')) {
    throw new Error(`No browser flow for provider: ${providerId}`);
  }
  if (providerId === 'openai-chatgpt') return startOpenAIChatGPTLogin();
  await stopBrowserFlow(providerId).catch(() => {});

  const pkce = mintPkce();
  let resolveCode;
  const codeArrived = new Promise((resolve, reject) => { resolveCode = { resolve, reject }; });
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', XAI_REDIRECT_URI);
    if (url.pathname !== XAI.redirectPath) {
      res.writeHead(404); res.end(); return;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (state !== pkce.state || !code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Neuma sign-in: invalid callback (state mismatch). You can close this tab.');
      resolveCode.reject(new Error('callback state mismatch'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body style="background:#000;color:#5FE9FF;font-family:monospace;display:grid;place-items:center;height:100vh"><p>Signed in — return to the desk. You can close this tab.</p></body></html>');
    resolveCode.resolve(code);
  });
  server.listen(XAI.redirectPort, XAI.redirectHost);

  const flow = { kind: 'browser', ...pkce, server, outcome: null };
  pending.set(providerId, flow);

  flow.done = codeArrived
    .then(async (code) => {
      const { ok, status, data } = await postJson(`${xaiBase()}/oauth2/token`, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: XAI_REDIRECT_URI,
        client_id: XAI.clientId,
        code_verifier: pkce.verifier,
      }, true);
      if (!ok || !data.access_token) throw new Error(`token exchange failed (${status})`);
      await setCredential(providerId, {
        type: 'oauth',
        access: data.access_token,
        refresh: data.refresh_token || null,
        expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : 0,
        account: 'xai',
      });
      flow.outcome = { status: 'complete', account: 'xai' };
      log.info('oauth browser sign-in complete', { providerId });
    })
    .catch((err) => {
      flow.outcome = { status: 'error', error: err.message };
    })
    .finally(() => {
      server.close();
      if (pending.get(providerId) === flow) flow.server = null;
    });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: XAI.clientId,
    redirect_uri: XAI_REDIRECT_URI,
    scope: XAI.scope,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state: pkce.state,
    plan: 'generic',   // opts the consent screen into the generic OAuth tier (opencode xai.ts)
    referrer: 'kenorie',
  });
  return { verificationUrl: `${xaiBase()}/oauth2/authorize?${params.toString()}` };
};

/** impure — the desk's poll for a browser flow's outcome. */
export const pollBrowserFlow = async (providerId) => {
  if (providerId === 'openai-chatgpt') return pollOpenAIChatGPTLogin();
  const flow = pending.get(providerId);
  if (!flow || flow.kind !== 'browser') return { status: 'error', error: 'no pending browser flow' };
  return flow.outcome || { status: 'pending' };
};

// impure — cancel a pending browser flow (close the listener)
const stopBrowserFlow = async (providerId) => {
  const flow = pending.get(providerId);
  if (flow?.kind === 'browser') {
    flow.server?.close();
    pending.delete(providerId);
  }
};

/** impure — cancel any pending flow for a provider (new sign-in, sign-out). */
export const cancelFlow = async (providerId) => {
  if (providerId === 'openai-chatgpt') {
    await cancelOpenAIChatGPTLogin();
    return;
  }
  await stopBrowserFlow(providerId);
  pending.delete(providerId);
};

/** Revoke a provider OAuth token before its encrypted local entry is removed. */
export const revokeProviderOAuth = async (providerId) => {
  if (providerId !== 'openai-chatgpt') return false;
  const store = await loadCredentials();
  return revokeOpenAIChatGPT(store[providerId]);
};

// --- Token refresh (xAI refresh_token grant; Copilot tokens do not expire) ---

const OAUTH_REFRESH_SKEW_MS = 5 * 60_000;

// pure — true when the stored oauth entry should be refreshed before use.
// Copilot tokens carry expiresAt 0 (no expiry — used directly); xAI tokens
// expire and refresh through the grant. An entry with no refresh token is
// stale too — the refresh call then fails honestly ("sign in again").
export const oauthEntryStale = (entry, now = Date.now()) =>
  entry?.type === 'oauth'
    && Number.isFinite(entry.expiresAt) && entry.expiresAt > 0
    && entry.expiresAt <= now + OAUTH_REFRESH_SKEW_MS;

/**
 * impure — refresh an oauth entry through the provider's refresh grant and
 * persist the renewed entry. Throws on failure (the caller refuses the turn
 * honestly rather than speaking with a dead token).
 */
export const refreshOAuthEntry = async (providerId, entry) => {
  if (providerId === 'openai-chatgpt') {
    const renewed = await refreshOpenAIChatGPT(entry);
    await setCredential(providerId, renewed);
    log.info('oauth token refreshed', { providerId });
    return renewed;
  }
  if (providerId !== 'xai') throw new Error(`No refresh flow for provider: ${providerId}`);
  if (!entry?.refresh) throw new Error('oauth entry has no refresh token — sign in again');
  const { ok, status, data } = await postJson(`${xaiBase()}/oauth2/token`, {
    grant_type: 'refresh_token',
    refresh_token: entry.refresh,
    client_id: XAI.clientId,
  }, true);
  if (!ok || !data.access_token) {
    throw new Error(`xAI token refresh failed (${status})${data.error_description ? `: ${data.error_description}` : ''}`);
  }
  const renewed = {
    type: 'oauth',
    access: data.access_token,
    refresh: data.refresh_token || entry.refresh,
    expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : 0,
    account: entry.account || 'xai',
  };
  await setCredential(providerId, renewed);
  log.info('oauth token refreshed', { providerId });
  return renewed;
};
