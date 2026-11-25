/**
 * Tripwire routes (/api/v1/cso/tripwire), end to end: REAL auth (a real
 * wallet with a real session token), the REAL install-owner gate, the real
 * decoy store on a scratch home, the real house threat ledger and the real
 * alert path (RULE 0). Nothing is mocked.
 *
 * The scratch home rides NEUMA_TRIPWIRE_HOME — no decoy is ever planted in
 * the home folder of whoever runs this suite.
 */
import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const linux = process.platform === 'linux';
const EVM = `0x${'ab'.repeat(20)}`;
const EVM_THIEF = `0x${'cd'.repeat(20)}`;

describe.skipIf(!linux)('tripwire routes', () => {
  let app, root, home, owner, guest, tripwire;
  const saved = {};
  const ENV = ['NEUMA_TRIPWIRE_PATH', 'NEUMA_TRIPWIRE_HOME', 'NEUMA_REALM_ROOT', 'WORKSPACES_ROOT', 'NEUMA_SECURITY_THREATS_PATH', 'NEUMA_SECURITY_CSO_PATH'];
  const ledgerOf = async (wallet) => JSON.parse(await fs.readFile(
    path.join(root, 'realm', wallet.toLowerCase(), 'offices', 'security', 'security-threats.json'), 'utf8',
  ));

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) saved[k] = process.env[k];
    root = await fs.mkdtemp('/var/tmp/neuma-tripwire-routes-');
    home = path.join(root, 'home');
    await fs.mkdir(home);
    process.env.NEUMA_TRIPWIRE_PATH = path.join(root, 'tripwire.json');
    process.env.NEUMA_TRIPWIRE_HOME = home;
    process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
    process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
    process.env.NEUMA_SECURITY_THREATS_PATH = path.join(root, 'legacy-threats.json');
    process.env.NEUMA_SECURITY_CSO_PATH = path.join(root, 'cso.json');

    // Imported after resetModules: the token is minted by the auth instance the router verifies against.
    const { witnessFor } = await import('../helpers/witness.js');
    owner = await witnessFor(process.env.WORKSPACES_ROOT, 'ownerlane');
    guest = await witnessFor(process.env.WORKSPACES_ROOT, 'guestlane');
    await makeInstallOwner(owner.address);
    ({ tripwire } = await import('../../backend/services/security/tripwire/tripwire.js'));
    const { default: router } = await import('../../backend/routes/cso-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/cso', router);
  });

  afterEach(async () => {
    await tripwire.setEnabled(false).catch(() => {});
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  test('no token, no answer', async () => {
    expect((await request(app).get('/api/v1/cso/tripwire')).status).toBe(401);
    expect((await request(app).post('/api/v1/cso/tripwire/clipboard').send({ copied: EVM, found: EVM_THIEF })).status).toBe(401);
  });

  test('off until the install owner turns it on; a guest cannot', async () => {
    const before = await request(app).get('/api/v1/cso/tripwire').set(guest.header);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ supported: true, enabled: false, mode: 'off', frozen: [], lastIncident: null });
    expect(before.body.decoys.map((d) => d.status)).toEqual(Array(6).fill('none'));

    expect((await request(app).put('/api/v1/cso/tripwire').set(guest.header).send({ enabled: true })).status).toBe(403);
    expect(await fs.readdir(home)).toEqual([]);
    expect((await request(app).put('/api/v1/cso/tripwire').set(owner.header).send({ enabled: 'yes' })).status).toBe(400);

    const on = await request(app).put('/api/v1/cso/tripwire').set(owner.header).send({ enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.enabled).toBe(true);
    expect(['inotify', 'atime']).toContain(on.body.mode);
    expect(on.body.decoys.map((d) => d.status)).toEqual(Array(6).fill('planted'));
    for (const decoy of on.body.decoys) {
      for (const file of decoy.files) expect(file.startsWith(home + path.sep)).toBe(true);
    }

    const off = await request(app).put('/api/v1/cso/tripwire').set(owner.header).send({ enabled: false });
    expect(off.body.enabled).toBe(false);
    expect(await fs.readdir(home)).toEqual([]);
  });

  test('a release needs the owner and a process the watch froze', async () => {
    expect((await request(app).post('/api/v1/cso/tripwire/release').set(guest.header).send({ pid: 4242 })).status).toBe(403);
    expect((await request(app).post('/api/v1/cso/tripwire/release').set(owner.header).send({ pid: 1 })).status).toBe(400);
    const none = await request(app).post('/api/v1/cso/tripwire/release').set(owner.header).send({ pid: 4242 });
    expect(none.status).toBe(200);
    expect(none.body.resumed).toBe(false);
  });

  test('a swapped clipboard address lands in the reporting operator\'s own ledger, once', async () => {
    const report = (who, body) => request(app).post('/api/v1/cso/tripwire/clipboard').set(who.header).send(body);
    expect((await report(guest, { copied: EVM, found: EVM })).status).toBe(400);
    expect((await report(guest, { copied: EVM, found: 'my password is hunter2' })).status).toBe(400);
    expect((await report(guest, {})).status).toBe(400);

    const filed = await report(guest, { copied: EVM, found: EVM_THIEF });
    expect(filed.status).toBe(200);
    expect(filed.body.filed).toBe(true);

    const entries = await ledgerOf(guest.address);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'tripwire', layer: 'hardware', severity: 'critical', status: 'new',
      title: 'An address you copied was replaced on the clipboard',
    });
    expect(entries[0].summary).toContain(EVM);
    expect(entries[0].summary).toContain(EVM_THIEF);
    // Another house's ledger is never written (ruling, 2026-10-16).
    await expect(ledgerOf(owner.address)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
