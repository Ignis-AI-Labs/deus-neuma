// security-headers.test.js — the defense-in-depth headers as actually served
// by a real express app over real HTTP. The CSP assertions pin the directives
// vessel rendering depends on: three.js loads VRM textures via fetch(blobUrl)
// (ImageBitmapLoader), so connect-src must carry blob: or every vessel
// renders as an untextured silhouette wherever the backend serves the
// frontend (the packaged Electron app foremost) — proven live in Chromium
// 2026-07-03 against this exact header.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { securityHeaders, CSP_DIRECTIVES } from '../../backend/services/security-headers.js';

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(securityHeaders);
  app.get('/probe', (req, res) => res.send('ok'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const cspOf = async () => {
  const res = await fetch(`${base}/probe`);
  return res.headers.get('content-security-policy');
};

describe('securityHeaders (real express + real HTTP)', () => {
  it('serves the CSP exactly as configured', async () => {
    expect(await cspOf()).toBe(CSP_DIRECTIVES.join('; '));
  });

  it('CSP allows the vessel texture path: fetch(blob:) and blob images', async () => {
    const csp = await cspOf();
    expect(csp).toMatch(/connect-src [^;]*blob:/);
    expect(csp).toMatch(/img-src [^;]*blob:/);
  });

  it('CSP keeps the hard denials (no objects, no frames, no remote scripts)', async () => {
    const csp = await cspOf();
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toMatch(/script-src 'self'(;|$| )/);
  });

  it('serves the companion hardening headers', async () => {
    const res = await fetch(`${base}/probe`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(res.headers.get('permissions-policy')).toContain('microphone=(self)');
  });
});
