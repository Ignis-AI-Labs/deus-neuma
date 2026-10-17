/**
 * OpenAI ChatGPT OAuth owned by Neuma.
 *
 * Neuma runs the PKCE callback, stores the resulting tokens in its encrypted
 * provider credential store, refreshes them, and revokes them on sign-out.
 * No external CLI or credential store participates in this path.
 *
 * The public client registration and wire contract follow OpenAI's Codex
 * implementation. An operator-owned registration can override the public
 * client id through NEUMA_OPENAI_OAUTH_CLIENT_ID.
 */
import { createServer } from 'http';
import { createHash, randomBytes } from 'crypto';
import { setCredential } from './provider-credentials.js';
import { createLogger } from './logger.js';

const log = createLogger('OpenAIChatGPTOAuth');
const PROVIDER_ID = 'openai-chatgpt';
const DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEFAULT_AUTH_BASE = 'https://auth.openai.com';
const DEFAULT_REDIRECT_PORT = 1455;
const REFRESH_FALLBACK_MS = 8 * 24 * 60 * 60 * 1000;

const authBase = () => (process.env.NEUMA_OAUTH_OPENAI_BASE || DEFAULT_AUTH_BASE).replace(/\/$/, '');
const clientId = () => process.env.NEUMA_OPENAI_OAUTH_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
const redirectPort = () => Number(process.env.NEUMA_OAUTH_OPENAI_REDIRECT_PORT) || DEFAULT_REDIRECT_PORT;
const redirectUri = () => `http://localhost:${redirectPort()}/auth/callback`;

// pure
const mintPkce = () => {
  const verifier = randomBytes(48).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(32).toString('base64url'),
  };
};

/**
 * Decode trusted token claims received directly from OpenAI over TLS.
 * Signature verification is not used for authorization; the token itself is
 * sent back only to OpenAI. Malformed JWTs fail closed.
 * @param {string} token JWT string.
 * @returns {object} JWT payload.
 */
const jwtClaims = (token) => {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('OpenAI returned a malformed JWT');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
};

/**
 * Derive the account-routing and display fields from an OpenAI ID token.
 * @param {string} idToken OpenAI ID token.
 * @returns {{accountId: string, account: string}}
 */
const accountFromIdToken = (idToken) => {
  const claims = jwtClaims(idToken);
  const auth = claims['https://api.openai.com/auth'] || {};
  const accountId = auth.chatgpt_account_id;
  if (typeof accountId !== 'string' || !accountId) {
    throw new Error('OpenAI login returned no ChatGPT account id');
  }
  const email = claims.email || claims['https://api.openai.com/profile']?.email;
  return { accountId, account: typeof email === 'string' && email ? email : 'ChatGPT' };
};

/**
 * Derive proactive refresh time from an access JWT.
 * @param {string} accessToken OpenAI access token.
 * @param {number} now Current epoch milliseconds.
 * @returns {number} Access-token expiry epoch milliseconds.
 */
export const accessExpiresAt = (accessToken, now = Date.now()) => {
  try {
    const exp = jwtClaims(accessToken).exp;
    if (Number.isFinite(exp)) return Math.max(now, exp * 1000);
  } catch { /* use OpenAI's eight-day fallback for opaque tokens */ }
  return now + REFRESH_FALLBACK_MS;
};

const post = async (path, body, contentType = 'application/x-www-form-urlencoded') => {
  const encoded = contentType === 'application/json'
    ? JSON.stringify(body)
    : new URLSearchParams(body).toString();
  const response = await fetch(`${authBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Accept: 'application/json' },
    body: encoded,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
};

let pending = null;

const stopListener = (flow = pending) => {
  flow?.server?.close();
  if (flow) flow.server = null;
};

/** Start Neuma's direct OpenAI browser PKCE flow. */
export const startOpenAIChatGPTLogin = async () => {
  await cancelOpenAIChatGPTLogin();
  const pkce = mintPkce();
  const flow = { ...pkce, server: null, outcome: null };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', redirectUri());
    if (url.pathname !== '/auth/callback') {
      res.writeHead(404); res.end(); return;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      flow.outcome = { status: 'error', error: url.searchParams.get('error_description') || oauthError };
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Neuma OpenAI sign-in was not completed. You can close this tab.');
      stopListener(flow);
      return;
    }
    if (!code || state !== flow.state) {
      flow.outcome = { status: 'error', error: 'OpenAI callback state mismatch' };
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Neuma OpenAI sign-in rejected an invalid callback. You can close this tab.');
      stopListener(flow);
      return;
    }
    try {
      const { response, data } = await post('/oauth/token', {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: clientId(),
        code_verifier: flow.verifier,
      });
      if (!response.ok || !data.access_token || !data.refresh_token || !data.id_token) {
        throw new Error(data.error_description || `OpenAI token exchange failed (${response.status})`);
      }
      const identity = accountFromIdToken(data.id_token);
      await setCredential(PROVIDER_ID, {
        type: 'oauth',
        access: data.access_token,
        refresh: data.refresh_token,
        expiresAt: accessExpiresAt(data.access_token),
        refreshedAt: Date.now(),
        ...identity,
      });
      flow.outcome = { status: 'complete', account: identity.account };
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="background:#000;color:#5FE9FF;font-family:monospace;display:grid;place-items:center;height:100vh"><p>OpenAI connected to Neuma. Return to the desk.</p></body></html>');
      log.info('OpenAI OAuth sign-in complete', { providerId: PROVIDER_ID });
    } catch (error) {
      flow.outcome = { status: 'error', error: error.message };
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Neuma could not complete OpenAI sign-in. Return to the desk for details.');
    } finally {
      stopListener(flow);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(redirectPort(), '127.0.0.1', resolve);
  });
  flow.server = server;
  pending = flow;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri(),
    scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state: pkce.state,
    originator: 'neuma',
  });
  return { verificationUrl: `${authBase()}/oauth/authorize?${params.toString()}`, pollAfterMs: 1500 };
};

/** Poll Neuma's direct OpenAI browser flow. */
export const pollOpenAIChatGPTLogin = async () => {
  if (!pending) return { status: 'error', error: 'no pending OpenAI login' };
  if (!pending.outcome) return { status: 'pending', pollAfterMs: 1500 };
  const outcome = pending.outcome;
  pending = null;
  return outcome;
};

/** Cancel Neuma's pending OpenAI callback listener. */
export const cancelOpenAIChatGPTLogin = async () => {
  if (!pending) return false;
  stopListener();
  pending = null;
  return true;
};

/** Refresh a stored OpenAI ChatGPT OAuth credential. */
export const refreshOpenAIChatGPT = async (entry) => {
  if (!entry?.refresh) throw new Error('OpenAI OAuth refresh token missing - sign in again');
  const { response, data } = await post('/oauth/token', {
    client_id: clientId(),
    grant_type: 'refresh_token',
    refresh_token: entry.refresh,
  }, 'application/json');
  if (!response.ok || (!data.access_token && !data.refresh_token && !data.id_token)) {
    throw new Error(data.error_description || data.error?.message || data.error || `OpenAI token refresh failed (${response.status})`);
  }
  const identity = data.id_token ? accountFromIdToken(data.id_token) : {
    accountId: entry.accountId,
    account: entry.account || 'ChatGPT',
  };
  const access = data.access_token || entry.access;
  return {
    type: 'oauth',
    access,
    refresh: data.refresh_token || entry.refresh,
    expiresAt: accessExpiresAt(access),
    refreshedAt: Date.now(),
    ...identity,
  };
};

/** Best-effort remote revocation before Neuma deletes its local credential. */
export const revokeOpenAIChatGPT = async (entry) => {
  const token = entry?.refresh || entry?.access;
  if (!token) return false;
  const refreshToken = Boolean(entry?.refresh);
  const body = {
    token,
    token_type_hint: refreshToken ? 'refresh_token' : 'access_token',
    ...(refreshToken ? { client_id: clientId() } : {}),
  };
  const { response } = await post('/oauth/revoke', body, 'application/json');
  if (!response.ok) throw new Error(`OpenAI token revoke failed (${response.status})`);
  return true;
};
