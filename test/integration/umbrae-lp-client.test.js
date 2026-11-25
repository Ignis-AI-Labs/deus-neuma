/**
 * The Umbrae LP client (backend/services/umbrae-lp/umbrae-lp-client.js).
 *
 * RULE 0: the client is pointed at a real HTTP listener through its own origin
 * door (NEUMA_UMBRAE_LP_ORIGIN) and every request crosses a real socket. The
 * listener records what reached it, so "nothing was sent" is counted, not
 * assumed. The live platform is proven in umbrae-lp-client-live.test.js.
 */
import process from 'node:process';
import http from 'node:http';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { callUmbrae, UMBRAE_LP_OPS } from '../../backend/services/umbrae-lp/umbrae-lp-client.js';
import { connectionsOn } from '../helpers/connections-kit.js';

const POOL = '0x1cc9f4498dc2c12e385bc417658f339acf820293';
let server;
let seen = [];
let answer;
let connections;
const priorOrigin = process.env.NEUMA_UMBRAE_LP_ORIGIN;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: raw });
      const { status, headers, body } = answer(req);
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.NEUMA_UMBRAE_LP_ORIGIN = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  if (priorOrigin === undefined) delete process.env.NEUMA_UMBRAE_LP_ORIGIN; else process.env.NEUMA_UMBRAE_LP_ORIGIN = priorOrigin;
  connections?.restore();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  seen = [];
  answer = () => ({ status: 200, headers: {}, body: JSON.stringify({ fine: true }) });
  connections?.restore();
  connections = connectionsOn(['umbrae-liquidity']);
});

describe('with the connection off', () => {
  test('nothing is sent, and the reason names the switch', async () => {
    connections.restore();
    connections = connectionsOn([]);
    const out = await callUmbrae('pools');
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/turned off/);
    expect(seen).toEqual([]);
  });
});

describe('with the connection on', () => {
  test('a public read is a GET with no credential', async () => {
    expect(await callUmbrae('pools', { token: 'umbr_secret' })).toEqual({ ok: true, payload: { fine: true } });
    expect(await callUmbrae('pool', { params: { address: POOL } })).toEqual({ ok: true, payload: { fine: true } });
    expect(seen.map((r) => [r.method, r.url, r.authorization])).toEqual([
      ['GET', '/api/v1/base/pools', undefined],
      ['GET', `/api/v1/base/pools/${POOL}`, undefined],
    ]);
  });

  test('a keyed call posts its body with the key as a bearer', async () => {
    await callUmbrae('build', { token: 'umbr_secret', body: { actionType: 'close', tokenId: '7' } });
    expect(seen).toEqual([{
      method: 'POST', url: '/api/v1/base/build', authorization: 'Bearer umbr_secret',
      body: JSON.stringify({ actionType: 'close', tokenId: '7' }),
    }]);
  });

  test('every operation lands on its own fixed path', async () => {
    for (const op of UMBRAE_LP_OPS) await callUmbrae(op, { token: 't', params: { address: POOL }, body: {} });
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET /api/v1/base/pools',
      `GET /api/v1/base/pools/${POOL}`,
      `GET /api/v1/base/bins?pool=${POOL}&bins=35`,
      'POST /api/auth/challenge',
      'POST /api/auth/wallet-auth',
      'POST /api/account/api-keys',
      'POST /api/v1/base/quote/add-liquidity',
      'POST /api/v1/base/quote/withdrawal',
      'POST /api/v1/base/quote/claim-fees',
      'POST /api/v1/base/quote/create-pool',
      'POST /api/v1/base/build-pool',
      'POST /api/v1/base/positions',
      'POST /api/v1/base/approvals',
      'POST /api/v1/base/build',
      'POST /api/v1/base/send',
      'POST /api/v1/base/status',
      'POST /api/v1/base/sync',
    ]);
  });

  test('an unknown operation, a bad pool address and a missing key are refused before anything is sent', async () => {
    expect((await callUmbrae('../../admin')).error).toMatch(/no Umbrae operation/);
    expect((await callUmbrae('constructor')).error).toMatch(/no Umbrae operation/);
    expect((await callUmbrae('pool', { params: { address: `${POOL}/../../x` } })).error).toMatch(/not a pool address/);
    expect((await callUmbrae('pool')).error).toMatch(/not a pool address/);
    expect((await callUmbrae('build', { body: {} })).error).toMatch(/no Umbrae key yet/);
    expect((await callUmbrae('createKey', { body: {} })).error).toMatch(/sign-in session/);
    expect(seen).toEqual([]);
  });

  test('Umbrae\'s own refusal is carried back in its words, with its status and code', async () => {
    answer = () => ({ status: 403, headers: {}, body: JSON.stringify({ error: 'This key cannot write.', code: 'SCOPE_REQUIRED' }) });
    expect(await callUmbrae('build', { token: 't', body: {} })).toEqual({
      ok: false, error: 'Umbrae answered: This key cannot write.', status: 403, code: 'SCOPE_REQUIRED',
    });
  });

  test('a body that is not JSON is an honest failure, never a throw', async () => {
    answer = () => ({ status: 502, headers: { 'content-type': 'text/html' }, body: '<html>bad gateway</html>' });
    expect(await callUmbrae('pools')).toEqual({ ok: false, error: 'Umbrae answered: HTTP 502', status: 502 });
  });

  test('a redirect is not followed, so the key goes nowhere else', async () => {
    answer = () => ({ status: 307, headers: { location: 'http://127.0.0.1:9/elsewhere' }, body: '{}' });
    const out = await callUmbrae('build', { token: 'umbr_secret', body: {} });
    expect(out.ok).toBe(false);
    expect(seen).toHaveLength(1);
  });

  test('a call that outlasts its time is cut short', async () => {
    answer = null;
    server.removeAllListeners('request');
    server.on('request', (req) => { req.resume(); seen.push({ url: req.url }); });
    const out = await callUmbrae('pools', { timeoutMs: 300 });
    expect(out).toEqual({ ok: false, error: 'the call to Umbrae was cut short' });
  });
});
