// oauth-loopback.js — the loopback receiver of a desktop OAuth sign-in, for
// any platform that redirects a desktop app to 127.0.0.1 (Google, TikTok).
//
// One consent, one listener: an HTTP server on 127.0.0.1 at a port the OS
// picks, waiting for the browser to come back with `?code=&state=` on the
// callback path. The state must match the one minted for THIS consent or the
// callback is refused; the code is exchanged with the PKCE verifier only
// this process holds. The listener closes on the first real answer, on
// cancel, or when the consent expires.
//
// The platform supplies three pure-or-network pieces: how to mint its PKCE
// pair, how to build its consent URL, how to exchange the code. Everything
// about the listener is shared, so it is proven once for every platform.

import { createServer } from 'http';

const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;

// pure — the page the browser lands on; the desk carries the outcome.
const page = (message) => `<!doctype html><html><head><meta charset="utf-8"><title>Deus Neuma</title></head>`
  + `<body style="background:#000;color:#e8e8e8;font-family:monospace;display:grid;place-items:center;height:100vh">`
  + `<p>${message}</p></body></html>`;

/**
 * Open one consent: bind the listener, return the URL to open and a promise
 * of the token exchange's outcome. impure — network listener + entropy.
 * @param {{platform: string, callbackPath?: string,
 *   mint: () => {verifier: string, challenge: string, state: string},
 *   buildAuthUrl: (a: {redirectUri: string, challenge: string, state: string}) => string,
 *   exchange: (a: {code: string, verifier: string, redirectUri: string}) =>
 *     Promise<{ok: true, data: object}|{ok: false, detail: string}>,
 *   timeoutMs?: number}} spec
 * @returns {Promise<{authUrl: string, redirectUri: string,
 *   done: Promise<{ok: true, tokens: object}|{ok: false, detail: string}>,
 *   cancel: () => void}>}
 */
export const openOAuthLoopback = async ({ platform, callbackPath = '', mint, buildAuthUrl, exchange, timeoutMs = CONSENT_TIMEOUT_MS }) => {
  const pkce = mint();
  let settle;
  const answered = new Promise((resolve) => { settle = resolve; });
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    // A stray request (a favicon, a probe) is not the callback: it neither
    // settles nor closes the consent.
    if (!state && !code && !error) {
      res.writeHead(404); res.end(); return;
    }
    if (state !== pkce.state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page('This sign-in link does not belong to the connect in progress. Start CONNECT again from the desk.'));
      settle({ ok: false, detail: 'the sign-in answer did not match the connect in progress (state mismatch); start CONNECT again' });
      return;
    }
    if (error || !code) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page('Nothing was connected. You can close this tab.'));
      settle({ ok: false, detail: error === 'access_denied' ? `you declined access on ${platform}'s page; nothing was connected` : `${platform} returned no code (${error || 'no answer'})` });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page('Signed in. Return to the desk; you can close this tab.'));
    settle({ ok: true, code });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const redirectUri = `http://127.0.0.1:${server.address().port}${callbackPath}`;
  const timer = setTimeout(() => settle({ ok: false, detail: 'the sign-in was not finished within five minutes; start CONNECT again' }), timeoutMs);
  timer.unref?.();

  const done = answered.then(async (answer) => {
    clearTimeout(timer);
    server.close();
    if (!answer.ok) return answer;
    const exchanged = await exchange({ code: answer.code, verifier: pkce.verifier, redirectUri });
    return exchanged.ok ? { ok: true, tokens: exchanged.data } : { ok: false, detail: exchanged.detail };
  });

  return {
    authUrl: buildAuthUrl({ redirectUri, challenge: pkce.challenge, state: pkce.state }),
    redirectUri,
    done,
    cancel: () => settle({ ok: false, detail: 'the connect was cancelled' }),
  };
};
