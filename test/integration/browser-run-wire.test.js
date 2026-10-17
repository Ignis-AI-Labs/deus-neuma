import { afterEach, describe, expect, test } from 'vitest';
import http from 'http';
import { fetchRenderedHtml } from '../../backend/services/browser-run.js';
import { fetchWebPage } from '../../backend/services/web-fetch.js';

// Real ephemeral HTTP proves the production Browser Run request boundary.
// The external authenticated Cloudflare account remains a separate live proof;
// this server never pretends to be evidence that Cloudflare itself is online.

const servers = [];

const serve = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => {
    servers.push(server);
    resolve(`http://127.0.0.1:${server.address().port}`);
  });
});

const readJson = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('fetchRenderedHtml — Browser Run/Kitesurf wire', () => {
  test('guards the target, sends the authenticated Kitesurf content request, and unwraps HTML', async () => {
    const seen = [];
    const apiRoot = await serve(async (req, res) => {
      seen.push({ url: req.url, authorization: req.headers.authorization, body: await readJson(req) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        result: '<html><head><title>Rendered</title></head><body><main>post-JavaScript text</main></body></html>',
      }));
    });

    const out = await fetchRenderedHtml('https://93.184.216.34/dynamic', {
      accountId: 'account id',
      apiToken: 'least-privilege-token',
      apiRoot,
    });

    expect(out).toMatchObject({ ok: true, truncated: false });
    expect(out.html).toContain('post-JavaScript text');
    expect(seen).toEqual([{
      url: '/client/v4/accounts/account%20id/browser-rendering/content?browser=kitesurf',
      authorization: 'Bearer least-privilege-token',
      body: {
        url: 'https://93.184.216.34/dynamic',
        gotoOptions: { waitUntil: 'networkidle2', timeout: 15000 },
        rejectResourceTypes: ['image', 'media', 'font'],
      },
    }]);
  });

  test('refuses a private target before the Browser Run endpoint receives a request', async () => {
    let requests = 0;
    const apiRoot = await serve((_req, res) => {
      requests += 1;
      res.end('<html></html>');
    });

    const out = await fetchRenderedHtml('http://127.0.0.1:47317/private', {
      accountId: 'account',
      apiToken: 'token',
      apiRoot,
    });

    expect(out).toEqual({ ok: false, error: 'target refused (forbidden-host)' });
    expect(requests).toBe(0);
  });

  test('surfaces a Cloudflare error without reflecting the credential', async () => {
    const apiRoot = await serve((_req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ message: 'Browser Rendering permission missing' }] }));
    });

    const out = await fetchRenderedHtml('https://93.184.216.34/', {
      accountId: 'account',
      apiToken: 'never-reflect-this-token',
      apiRoot,
    });

    expect(out.ok).toBe(false);
    expect(out.error).toContain('answered 403');
    expect(out.error).toContain('Browser Rendering permission missing');
    expect(out.error).not.toContain('never-reflect-this-token');
  });

  test('the real direct 403 path falls through to the rendered-page adapter', async () => {
    const reachable = await fetch('https://httpbin.org/status/403', {
      signal: AbortSignal.timeout(5000),
    }).then((response) => response.status === 403).catch(() => false);
    if (!reachable) return;

    const apiRoot = await serve((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><head><title>Rendered fallback</title></head>'
        + '<body><main>The JavaScript application is readable now.</main></body></html>');
    });
    const out = await fetchWebPage('https://httpbin.org/status/403', {
      browserRun: {
        accountId: 'account',
        apiToken: 'wire-proof-token',
        apiRoot,
      },
    });

    expect(out).toMatchObject({
      ok: true,
      status: null,
      title: 'Rendered fallback',
      renderer: 'kitesurf',
      truncated: false,
    });
    expect(out.text).toContain('JavaScript application is readable now');
  });
});
