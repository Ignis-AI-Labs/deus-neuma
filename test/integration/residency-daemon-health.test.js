// #20 S1 — residency daemon foundation: the health endpoint + the wrapper's
// health/residency/doctor verbs, and the #133 auth interop.
//
// REAL bash, REAL filesystem, REAL HTTP — no mocks anywhere on the claimed
// path (AGENTS.md RULE 0). The wrapper runs unmodified over the stub
// systemctl shim in test/helpers/daemon-wrapper-kit.js (the shim substitutes
// SYSTEMD ITSELF, never the wrapper-under-test); the verb-dispatch and
// install invariants are proven in residency-daemon-wrapper.test.js.
//
// The health endpoint test boots a real Express app via dynamic import of
// the actual health-routes.js, hits it with real HTTP, asserts the real
// 200/503 envelope shape.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import { createTempDir } from '../helpers/temp-fs.js';
import { buildStubBin, reservedDeadPort, runWrapper } from '../helpers/daemon-wrapper-kit.js';

describe('#20 S1 — /api/v1/health endpoint + wrapper health/residency/doctor (real Express, real HTTP, real wrapper)', () => {
  let server;
  let port;
  let stubBin;
  let stubLog;

  beforeEach(async () => {
    // Boot a real Express app with the actual health-routes + a stub
    // residency-routes. No mocks on the path under test — same modules
    // the daemon serves. The residency stub returns a known shape so
    // we can assert the wrapper retrieved + printed it.
    const app = express();
    const healthRouter = (await import('../../backend/routes/health-routes.js')).default;
    app.use('/api/v1/health', healthRouter);
    // /residency requires bearer auth in the real daemon. Mount a stub that
    // mirrors the auth contract: 401 without bearer, 200 with the test token.
    app.get('/api/v1/residency', (req, res) => {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (token !== 'test-bearer-token') return res.status(401).json({ error: 'unauthorized' });
      res.json({ enabled: true, neuma: [{ neumaId: 'testbeing', resident: true }] });
    });
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    port = server.address().port;

    // Stub bin so the wrapper's status/logs/etc. don't shell out to real systemd
    const dir = await createTempDir('s20-real-srv-stub-log');
    stubLog = path.join(dir, 'argv.log');
    await fs.writeFile(stubLog, '');
    stubBin = await buildStubBin(stubLog);
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // INVARIANT 10 — public liveness probe returns 200 + documented shape
  it('GET /api/v1/health returns 200 with status + components', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('components');
    expect(body.components).toHaveProperty('workspace');
  });

  // INVARIANT 11 — wrapper's `health` verb (ai6 R1.3): NEUMA_PORT override
  // + real curl + real Express + the actual wrapper script end-to-end.
  // Closes the gnosis gap between "module returns 200" and […]
  it('wrapper health verb actually curls the real /api/v1/health (NEUMA_PORT override)', async () => {
    const r = await runWrapper(['health'], {
      env: { NEUMA_PORT: String(port) },
    });
    expect(r.exitCode).toBe(0);
    // The wrapper prints the JSON body from curl
    expect(r.stdout).toMatch(/"status"/);
    expect(r.stdout).toMatch(/"components"/);
  });

  // INVARIANT 12 — wrapper's `residency` verb: bearer-required path. Without
  // the token, the 401 surfaces as a non-zero exit. With the token, the
  // payload is printed. (ai6 R2.3 — DAEMON_AUTH_TOKEN explicitly cleared
  // so a token sourced from the dev shell can't silently make the 'no-token'
  // assertion pass falsely.)
  it('wrapper residency verb: 401 without bearer (non-zero exit), 200 with bearer', async () => {
    const r1 = await runWrapper(['residency'], {
      env: { NEUMA_PORT: String(port), DAEMON_AUTH_TOKEN: '' },
    });
    expect(r1.exitCode).toBe(1);
    expect(r1.stderr).toMatch(/residency probe failed/);
    expect(r1.stderr).toMatch(/DAEMON_AUTH_TOKEN/);

    const r2 = await runWrapper(['residency'], {
      env: { NEUMA_PORT: String(port), DAEMON_AUTH_TOKEN: 'test-bearer-token' },
    });
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toMatch(/"resident":true/);
    expect(r2.stdout).toMatch(/testbeing/);
  });

  // INVARIANT 13 — `doctor` runs every probe regardless of any single failure.
  // This is the ai6 R1.1 High bug we just fixed: previously `exit 1` inside
  // verb_health killed the whole script before residency printed. Now
  // verb_health uses `return 1` and doctor's `|| true` catches it cleanly.
  it('doctor prints all 3 sections even when health AND residency fail', async () => {
    // ai6 R2.4 — deterministic dead port (bind ephemeral + close)
    const deadPort = await reservedDeadPort();
    const r = await runWrapper(['doctor'], {
      stubBin,
      env: { NEUMA_PORT: String(deadPort), DAEMON_AUTH_TOKEN: '' },
    });
    expect(r.stdout).toMatch(/== unit state ==/);
    expect(r.stdout).toMatch(/== health probe ==/);
    expect(r.stdout).toMatch(/== residency snapshot ==/);
    expect(r.exitCode).toBe(0);
  });

  // INVARIANT 14 — doctor with a HEALTHY backend prints all 3 sections + the
  // real health body (proves the end-to-end happy path, not just the
  // every-probe-fails recovery)
  it('doctor with healthy backend prints health JSON + residency 401 + all 3 sections', async () => {
    const r = await runWrapper(['doctor'], {
      stubBin,
      env: { NEUMA_PORT: String(port), DAEMON_AUTH_TOKEN: '' }, // no token → residency 401s
    });
    expect(r.stdout).toMatch(/== unit state ==/);
    expect(r.stdout).toMatch(/== health probe ==/);
    expect(r.stdout).toMatch(/"components"/); // real health body from real server
    expect(r.stdout).toMatch(/== residency snapshot ==/);
    expect(r.exitCode).toBe(0);
  });

  // INVARIANT 15 — ai6 R2.1 LOAD-BEARING. Doctor MUST survive a failed
  // require_systemd_user (no DBus session, cron run, container without
  // user-session, etc.). Previously require_systemd_user `exit 2`'d, which
  // killed the wrapper mid-doctor (`verb_status || true` cannot catch
  // exit). Fixed to `return 2`. This test simulates the no-DBus case by
  // having the stub's show-environment exit non-zero — proves all 3
  // sections still print AND doctor exits 0.
  it('doctor survives a broken systemd session (require_systemd_user return-not-exit)', async () => {
    // Stub where show-environment exits 1 — simulates no DBus user session
    const dir = await createTempDir('s20-broken-session-log');
    const brokenLog = path.join(dir, 'argv.log');
    await fs.writeFile(brokenLog, '');
    const brokenStub = await buildStubBin(brokenLog, { sessionProbeExitCode: 1 });

    const r = await runWrapper(['doctor'], {
      stubBin: brokenStub,
      env: { NEUMA_PORT: String(port), DAEMON_AUTH_TOKEN: 'test-bearer-token' },
    });
    // All three section headers MUST still print — status fails inside its
    // own gate, doctor's || true catches the return, health + residency
    // run normally against the real server.
    expect(r.stdout).toMatch(/== unit state ==/);
    expect(r.stdout).toMatch(/== health probe ==/);
    expect(r.stdout).toMatch(/== residency snapshot ==/);
    // Health body still printed (proves we got past the broken status section)
    expect(r.stdout).toMatch(/"components"/);
    // And the residency token worked (proves we got past health too)
    expect(r.stdout).toMatch(/testbeing/);
    // doctor exits 0 — diagnostic dump, not a probe
    expect(r.exitCode).toBe(0);
    // The require_systemd_user error message must have surfaced somewhere
    expect(r.stderr).toMatch(/systemd --user session not available/);
  });

  // INVARIANT 16 — DIRECT verb invocation (not via doctor) on a broken
  // session must STILL exit 2 — the return-not-exit fix preserves
  // operator-facing fail-fast behavior for direct calls.
  it('direct verb on broken session still exits 2 (return-2 propagates via set -e)', async () => {
    const dir = await createTempDir('s20-broken-direct-log');
    const brokenLog = path.join(dir, 'argv.log');
    await fs.writeFile(brokenLog, '');
    const brokenStub = await buildStubBin(brokenLog, { sessionProbeExitCode: 1 });
    const r = await runWrapper(['start'], { stubBin: brokenStub });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/systemd --user session not available/);
  });
});

// #133 — auth interop against the PRODUCTION middleware. The suite above uses
// a hand-rolled auth stub for wrapper-output assertions; this block mounts the
// REAL residency-routes.js (whose router.use(requireAuth) is the actual
// production gate) and mints a REAL session token via the same
// challenge-sign-verify the app uses. No stub anywhere on the auth path.
describe('#133 — /api/v1/residency auth interop (real router, real requireAuth, real token)', () => {
  let server;
  let port;
  let origRoot;
  let coreIndex;

  beforeEach(async () => {
    coreIndex = await import('../../core/index.js');
    origRoot = coreIndex.getWorkspacesRoot();
    // Isolate from any live house: residency walks listNeuma() at the root.
    coreIndex.setWorkspacesRoot(await createTempDir('residency-interop-root'));

    const app = express();
    const residencyRouter = (await import('../../backend/routes/residency-routes.js')).default;
    app.use('/api/v1/residency', residencyRouter);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  });

  afterEach(async () => {
    coreIndex.setWorkspacesRoot(origRoot);
    await new Promise((resolve) => server.close(resolve));
  });

  it('401s without a token, 200s with a REAL challenge-sign-verify token', async () => {
    const { ethers } = await import('ethers');
    const { generateChallenge, verifySignature, createSessionToken } = await import('../../backend/services/auth.js');

    // No token → the production middleware refuses
    const bare = await fetch(`http://127.0.0.1:${port}/api/v1/residency`);
    expect(bare.status).toBe(401);

    // Garbage token → refused too
    const garbage = await fetch(`http://127.0.0.1:${port}/api/v1/residency`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(garbage.status).toBe(401);

    // Real flow: challenge → wallet signature → verify → HMAC session token
    const wallet = ethers.Wallet.createRandom();
    const challenge = generateChallenge(wallet.address);
    const signature = await wallet.signMessage(challenge);
    expect(verifySignature(wallet.address, challenge, signature)).toBe(wallet.address);
    const token = createSessionToken(wallet.address);

    const authed = await fetch(`http://127.0.0.1:${port}/api/v1/residency`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(authed.status).toBe(200);
    const body = await authed.json();
    // The real getResidencyState shape (empty isolated root → no residents)
    expect(body).toHaveProperty('enabled');
    expect(body).toHaveProperty('conduit');
    expect(Array.isArray(body.neuma)).toBe(true);
  });
});
