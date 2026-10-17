// The brand lane's HTTP surface, driven through the real routers.
//
// The services underneath are proven in brand-preview.test.js and the unit
// files. What only shows up at the route layer is wiring, and three pieces of
// it can be wrong while every service is right:
//
//   1. MOUNT ORDER. Express matches in order, so `/:brand` will happily swallow
//      `/form` and `/faces` as brand names. That is the same trap `/:brand/new`
//      already had to be declared above `/:brand` to avoid.
//   2. THE ?token= DOOR. CSS url() issues the browser's own bare GET and can
//      carry no Authorization header — so the face bytes need a query door, and
//      it must open for exactly that one path and nothing else.
//   3. UPLOAD VALIDATION. A route that writes a file somebody chose the name of
//      is the one place in this lane where a bad string reaches disk.
//
// Rule 0: no mocks. A real Express app, the real routers, a real session token
// minted by the real auth service, and a real house ground on disk.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createSessionToken } from '../../backend/services/auth.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import brandRoutes from '../../backend/routes/brand-routes.js';
import { KIT_SECTIONS } from '../../backend/services/branding/kit-readiness.js';

const WALLET = '0x1111111111111111111111111111111111111111';
let token;
let app;
let realm;
let ground;

beforeEach(async () => {
  process.env.SESSION_TOKEN_SECRET ||= 'brand-asset-routes-test-secret';
  token = createSessionToken(WALLET);
  realm = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-realm-'));
  ground = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-ground-'));
  setRealmRoot(realm);
  await setHouseWorkspace(WALLET, ground);
  app = express();
  app.use(express.json());
  app.use('/api/v1/brands', brandRoutes);
});

afterEach(async () => {
  await fs.rm(realm, { recursive: true, force: true });
  await fs.rm(ground, { recursive: true, force: true });
});

const authed = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${token}`);

describe('mount order — /form and /faces are not brand names', () => {
  test('GET /form answers the form, not "there is no form brand kit"', async () => {
    const res = await authed('get', '/api/v1/brands/form');
    expect(res.status).toBe(200);
    expect(res.body.sections).toBeInstanceOf(Array);
    // Twelve form sections from nine gate sections: IDENTITY's nineteen fields
    // split four ways.
    expect(res.body.sections).toHaveLength(12);
    // And it carries what the CARDS demand, which the gate does not ask for.
    expect(res.body.templates.colors.length).toBeGreaterThan(KIT_SECTIONS[0].fields.filter((f) => f.path.startsWith('colors.')).length);
  });

  test('GET /faces answers the registry, not a 404 for a brand called "faces"', async () => {
    const res = await authed('get', '/api/v1/brands/faces');
    expect(res.status).toBe(200);
    expect(res.body.families.map((f) => f.family)).toContain('Space Grotesk');
    // ⚠️ Names and weights only. EMBEDDABLE holds absolute paths into the repo
    // and serving it through would publish the rig's directory layout.
    expect(JSON.stringify(res.body)).not.toMatch(/\/branding\/fonts\//);
  });

  test('the ordinary brand routes still work underneath', async () => {
    expect((await authed('get', '/api/v1/brands')).status).toBe(200);
    expect((await authed('get', '/api/v1/brands/umbrae')).status).toBe(200);
    expect((await authed('get', '/api/v1/brands/nosuchbrand')).status).toBe(404);
  });
});

describe('the face bytes, and the one door that reaches them', () => {
  test('a bearer header serves the real vendored file', async () => {
    const res = await authed('get', '/api/v1/brands/faces/grotesk-light/file');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/font/);
    // A real TrueType file, not an error page rendered as bytes.
    expect(res.body.length).toBeGreaterThan(10_000);
    expect(res.headers['cache-control']).toMatch(/immutable/);
  });

  test('?token= opens it, because a stylesheet cannot send a header', async () => {
    const res = await request(app).get(`/api/v1/brands/faces/grotesk-light/file?token=${token}`);
    expect(res.status).toBe(200);
  });

  test('the door is that ONE path — it does not loosen the rest of the lane', async () => {
    // ⚠️ If this ever passes, a query string has become a way to read any
    // operator's brand kits.
    expect((await request(app).get(`/api/v1/brands/umbrae?token=${token}`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/brands?token=${token}`)).status).toBe(401);
    expect((await request(app).get('/api/v1/brands/faces/grotesk-light/file')).status).toBe(401);
  });

  test('an id that is not in the registry is refused, never joined to a path', async () => {
    expect((await authed('get', '/api/v1/brands/faces/nosuchface/file')).status).toBe(404);
    expect((await authed('get', '/api/v1/brands/faces/..%2F..%2Fpackage.json/file')).status).toBe(404);
  });
});

describe('marks — reading them, and putting one there', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

  test('a brand reports its marks, and the exact folder to drop another in', async () => {
    const res = await authed('get', '/api/v1/brands/umbrae/marks');
    expect(res.status).toBe(200);
    expect(res.body.marks.wordmark).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(res.body.where).toContain(path.join('brands', 'umbrae', 'marks'));
    // What the CARDS need, so a mark the kit has not declared is still visible
    // as something to supply rather than silently absent.
    expect(res.body.needed.map((m) => m.key).sort()).toEqual(['mask', 'wordmark']);
  });

  test('an SVG lands in the signer\'s OWN ground, never in the repo', async () => {
    const res = await authed('post', '/api/v1/brands/umbrae/marks')
      .field('name', 'wordmark')
      .attach('mark', Buffer.from(svg), { filename: 'w.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(200);
    expect(res.body.file).toBe('wordmark.svg');
    // ⚠️ In the ground, and the repo's shipped artwork untouched — the same
    // precedence a PUT follows. The repo is source.
    const landed = path.join(ground, 'brands', 'umbrae', 'marks', 'wordmark.svg');
    expect(await fs.readFile(landed, 'utf8')).toBe(svg);
  });

  test('a name that is not a name never reaches disk', async () => {
    // Traversal, spaces, a leading digit, nothing at all. The name becomes a
    // path component and a {{mark.*}} lookup, so it is held to the same plain
    // shape every other name in this lane is.
    for (const name of ['../escape', 'word mark', '', '9lives', 'mark.svg', 'a/b']) {
      const res = await authed('post', '/api/v1/brands/umbrae/marks')
        .field('name', name)
        .attach('mark', Buffer.from(svg), { filename: 'w.svg' });
      expect(res.status, `"${name}" was accepted`).toBe(400);
    }
  });

  test('but CASE is normalised rather than refused', async () => {
    // Case is the one difference that is unambiguously the same name, so
    // "Wordmark" is taken as `wordmark` instead of being bounced. A space or a
    // slash is not — those could mean more than one thing, and guessing which
    // is how a file ends up somewhere nobody chose.
    const res = await authed('post', '/api/v1/brands/umbrae/marks')
      .field('name', 'WordMark')
      .attach('mark', Buffer.from(svg), { filename: 'w.svg' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('wordmark');
    await expect(fs.access(path.join(ground, 'brands', 'umbrae', 'marks', 'wordmark.svg')))
      .resolves.toBeUndefined();
  });

  test('a file that is not an SVG is refused, by sniffing rather than by trusting', async () => {
    // The declared mime is whatever the OS guessed from an extension, and this
    // file gets served back to a browser.
    const res = await authed('post', '/api/v1/brands/umbrae/marks')
      .field('name', 'wordmark')
      .attach('mark', Buffer.from('\x89PNG\r\n\x1a\n not an svg'), {
        filename: 'logo.svg', contentType: 'image/svg+xml',
      });
    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/vector/);
  });

  test('no file at all is refused rather than writing an empty mark', async () => {
    const res = await authed('post', '/api/v1/brands/umbrae/marks').field('name', 'wordmark');
    expect(res.status).toBe(400);
  });
});

describe('preview — the draft, over the wire', () => {
  test('it draws from a kit in the body and embeds no fonts', async () => {
    const kit = (await authed('get', '/api/v1/brands/umbrae')).body.kit;
    const res = await authed('post', '/api/v1/brands/umbrae/preview')
      .send({ kit, template: 'milestone' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.svg).toMatch(/^<svg/);
    expect(res.body.svg).not.toContain('@font-face');
    // The browser installs these itself, from /faces/:id/file.
    expect(res.body.faces).toContain('grotesk-light');
  });

  test('a card that cannot be drawn answers 200 with reasons, not an error status', async () => {
    // ⚠️ This is the ROUTINE case — somebody is half-way through typing a hex
    // value. Putting it on the client's error path would make the exceptional
    // handler carry the common outcome.
    const kit = (await authed('get', '/api/v1/brands/umbrae')).body.kit;
    delete kit.colors.hairlineSoft;
    const res = await authed('post', '/api/v1/brands/umbrae/preview')
      .send({ kit, template: 'stat' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors.join(' ')).toMatch(/hairlineSoft/);
  });

  test('a malformed request IS an error', async () => {
    const res = await authed('post', '/api/v1/brands/umbrae/preview').send({ kit: {} });
    expect(res.status).toBe(400);
  });

  test('it is authenticated like everything else', async () => {
    expect((await request(app).post('/api/v1/brands/umbrae/preview').send({ template: 'stat' })).status).toBe(401);
  });
});
