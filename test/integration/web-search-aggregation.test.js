import { afterEach, describe, expect, test } from 'vitest';
import http from 'http';
import { searchAcrossBackends } from '../../backend/services/web-search.js';

// Real ephemeral HTTP endpoints exercise the production Exa, SearXNG, and
// Brave adapters. They prove our wire, concurrency, provenance, and merge
// behavior; they do not pretend to prove an external provider is online.

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

describe('searchAcrossBackends — real provider wires', () => {
  test('uses Exa Instant to return page evidence in the search response', async () => {
    let request;
    const exaRoot = await serve(async (req, res) => {
      request = {
        method: req.method,
        url: req.url,
        apiKey: req.headers['x-api-key'],
        body: await readJson(req),
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ results: [{
        title: 'Primary evidence',
        url: 'https://source.example/primary',
        highlights: ['The grounded passage returned with search.'],
      }] }));
    });

    const out = await searchAcrossBackends('fast grounded research', 5, {
      exaKey: 'wire-proof-exa-key',
      exaRoot,
      includeDdg: false,
    });

    expect(request).toEqual({
      method: 'POST',
      url: '/search',
      apiKey: 'wire-proof-exa-key',
      body: {
        query: 'fast grounded research',
        type: 'instant',
        numResults: 5,
        moderation: true,
        contents: { highlights: true },
      },
    });
    expect(out.ok).toBe(true);
    expect(out.backends).toEqual(['exa']);
    expect(out.results).toEqual([{
      title: 'Primary evidence',
      url: 'https://source.example/primary',
      snippet: 'The grounded passage returned with search.',
      backend: 'exa',
    }]);
  });

  test('queries independent indexes and round-robins their deduplicated rows', async () => {
    const requests = [];
    const searxngUrl = await serve((req, res) => {
      requests.push({ provider: 'searxng', url: req.url });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ results: [
        { title: 'S1', url: 'https://s.example/one', content: 'from searx' },
        { title: 'Shared', url: 'https://shared.example/path/#searx', content: 'shared' },
      ] }));
    });
    const braveRoot = await serve((req, res) => {
      requests.push({ provider: 'brave', url: req.url, token: req.headers['x-subscription-token'] });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ web: { results: [
        { title: 'B1', url: 'https://b.example/one', description: 'from brave' },
        { title: 'Duplicate', url: 'https://shared.example/path', description: 'same source' },
        { title: 'B3', url: 'https://b.example/three', description: 'from brave' },
      ] } }));
    });

    const out = await searchAcrossBackends('primary sources', 4, {
      searxngUrl,
      braveKey: 'wire-proof-token',
      braveRoot,
      includeDdg: false,
    });

    expect(out.ok).toBe(true);
    expect(out.backends).toEqual(['searxng', 'brave']);
    expect(out.backend).toBe('searxng+brave');
    expect(out.results.map(({ title }) => title)).toEqual(['S1', 'B1', 'Shared', 'B3']);
    expect(out.results.map(({ backend }) => backend)).toEqual(['searxng', 'brave', 'searxng', 'brave']);
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'searxng', url: '/search?q=primary%20sources&format=json' }),
      expect.objectContaining({
        provider: 'brave',
        url: '/res/v1/web/search?q=primary%20sources&count=4',
        token: 'wire-proof-token',
      }),
    ]));
  });

  test('keeps a real answer when another configured index fails', async () => {
    const searxngUrl = await serve((_req, res) => res.writeHead(503).end('down'));
    const braveRoot = await serve((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ web: { results: [
        { title: 'Still here', url: 'https://source.example/', description: 'answer' },
      ] } }));
    });

    const out = await searchAcrossBackends('resilient research', 5, {
      searxngUrl,
      braveKey: 'wire-proof-token',
      braveRoot,
      includeDdg: false,
    });

    expect(out.ok).toBe(true);
    expect(out.backends).toEqual(['brave']);
    expect(out.results).toHaveLength(1);
    expect(out.failures).toEqual(['searxng: searxng answered 503']);
    expect(out.hint).toContain('Some search sources did not answer');
  });
});
