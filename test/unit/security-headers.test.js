// security-headers.test.js — the defense-in-depth headers as actually served
// by a real express app over real HTTP. The CSP assertions pin the directives
// vessel rendering depends on: three.js loads VRM textures via fetch(blobUrl)
// (ImageBitmapLoader), so connect-src must carry blob: or every vessel
// renders as an untextured silhouette wherever the backend serves the
// frontend (the packaged Electron app foremost) — proven live in Chromium
// 2026-07-03 against this exact header.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { securityHeaders, CSP_DIRECTIVES } from '../../backend/services/security-headers.js';
import { mountContentStatic } from '../../backend/services/static-mounts.js';

let server;
let base;
let root;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-static-headers-'));
  const frontendRoot = path.join(root, 'frontend');
  const modelPath = path.join(root, 'model');
  await fs.mkdir(path.join(frontendRoot, 'components'), { recursive: true });
  await fs.mkdir(modelPath);
  await fs.writeFile(path.join(frontendRoot, 'module.js'), 'export const ok = true;');
  await fs.writeFile(path.join(frontendRoot, 'page.html'), '<script>alert(1)</script>');
  await fs.writeFile(path.join(frontendRoot, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await fs.writeFile(path.join(modelPath, 'avatar.vrm'), 'real avatar bytes');
  await fs.writeFile(path.join(modelPath, 'AVATAR.VRM'), 'uppercase avatar bytes');
  for (const name of ['payload.html', 'payload.js', 'payload.svg']) await fs.writeFile(path.join(modelPath, name), 'hostile active bytes');

  const app = express();
  app.use(securityHeaders);
  app.get('/probe', (req, res) => res.send('ok'));
  mountContentStatic(app, { frontendRoot, modelPath });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
});

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

  it('CSP keeps the hard denials (no objects, frames, base changes, remote scripts or foreign forms)', async () => {
    const csp = await cspOf();
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
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

describe('the production content static mounts (real files + real HTTP)', () => {
  it('serves only VRM model bytes, case-insensitively and without a query bypass', async () => {
    for (const name of ['avatar.vrm', 'AVATAR.VRM']) {
      const res = await fetch(`${base}/model/${name}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(await res.text()).toContain('avatar bytes');
    }
    for (const name of ['payload.html', 'payload.js', 'payload.svg']) {
      expect((await fetch(`${base}/model/${name}?download=1`)).status).toBe(404);
    }
  });

  it('keeps frontend modules working but downloads HTML and SVG instead of interpreting them inline', async () => {
    const module = await fetch(`${base}/frontend/module.js`);
    expect(module.status).toBe(200);
    expect(module.headers.get('content-type')).toContain('application/javascript');
    expect(await module.text()).toBe('export const ok = true;');
    for (const name of ['page.html', 'vector.svg']) {
      const res = await fetch(`${base}/frontend/${name}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toBe('attachment');
    }
  });
});
