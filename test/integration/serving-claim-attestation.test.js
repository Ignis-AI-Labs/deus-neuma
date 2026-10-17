// The claimed-server attestation (#506 contract 3) and the owner-bound stop
// (#506 contract 2) — proven the honest way (RULE 0): a real claim directory
// on real disk, a real stand-in server answering real /health on a real port,
// a real sleeping process as the sibling's substrate, and real hashing. The
// only thing simulated is llama-server itself, exactly as the established
// supervisor reload test does it.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { spawn } from 'child_process';
import crypto from 'node:crypto';
import { createTempDir, unsealDirectories } from '../helpers/temp-fs.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

let claimDir;
let registry;
let claimAttestation;
let supervisor;

const serveHealth = () => new Promise((resolve) => {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });
  srv.listen(0, '127.0.0.1', () => resolve(srv));
});

// Real hashes over real content; only the GPU uuid is a fixed string (the test
// exercises the contract's shape law, not a GPU read). Custody evidence is
// deliberately ABSENT — no producer emits lineageConfigSourceCustodySha256
// today; the contract must not demand a field reality never provides.
const realLaunchFacts = () => ({
  launchInstanceSha256: sha256('launch-instance'),
  processIdentitySha256: sha256('process-identity'),
  launchConfigurationSha256: sha256('launch-configuration'),
  serverExecutableSha256: sha256('server-executable'),
  servingModel: 'test-base-model',
  servingArtifactSha256: sha256('serving-artifact'),
  servingArtifactBytes: 31_000_000_000,
  lineageConfigSha256: sha256('lineage-config'),
  lineageConfigSourceCommit: 'a1b2c3d',
  lineageConfigSourceMode: '100644',
  lineageConfigObjectId: sha256('lineage-object'),
  lineageConfigSourceIdentitySha256: sha256('lineage-source-identity'),
  gpuUuid: 'GPU-0A1B2C3D-4E5F',
  gpuBindingSha256: sha256('gpu-binding'),
  adapters: [],
});

const routeFor = (port) => ({
  provider: 'llama-server',
  endpoint: `http://127.0.0.1:${port}`,
  model: 'test-base-model',
});

// A base-only serving: no lineage id, no lineage evidence — the artifact hash
// is the whole identity (the benchmark's base-weight serving shape).
const baseOnlyLaunchFacts = () => ({
  ...realLaunchFacts(),
  servingModel: null,
  lineageConfigSha256: undefined,
  lineageConfigSourceCommit: undefined,
  lineageConfigSourceMode: undefined,
  lineageConfigObjectId: undefined,
  lineageConfigSourceIdentitySha256: undefined,
  lineageConfigSourceCustodySha256: undefined,
});

beforeAll(async () => {
  claimDir = await createTempDir('serving-claim-attestation');
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = claimDir;
  registry = await import('../../backend/services/substrate-claim-registry.js');
  claimAttestation = await import('../../backend/services/serving-claim-attestation.js');
  supervisor = await import('../../backend/services/llama-server-supervisor.js');
});

afterAll(async () => {
  delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  await unsealDirectories(claimDir);
});

describe('serving claim authority — projection and publish', () => {
  test('claimAuthorityForLaunch projects a valid authority pinned by its digest', () => {
    const launch = { port: 18089, servingModel: 'test-base-model' };
    const { authority, authoritySha256 } = claimAttestation.claimAuthorityForLaunch(launch, realLaunchFacts());
    expect(authority.schemaVersion).toBe(2);
    expect(authority.servingModel).toBe('test-base-model');
    expect(authority.adapterSetSha256).toBe(refinementSha256([]));
    expect(authoritySha256).toBe(refinementSha256(authority));
    expect(authority.routeIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the pid/port guard refuses to pin proof onto another generation', () => {
    registry.writeClaim(process.pid, 18089, { servingModel: 'test-base-model' });
    const written = registry.writeClaimAuthority(process.pid + 1, 18089, { servingAuthority: {} });
    expect(written).toBe(false);
    expect(registry.readClaim().servingAuthority).toBeUndefined();
  });
});

describe('attestClaimedServing — the existing-server contract', () => {
  test('a claim that pre-dates the contract attests AUTHORITY_UNAVAILABLE', async () => {
    registry.writeClaim(process.pid, 18089, { servingModel: 'test-base-model' });
    const result = await claimAttestation.attestClaimedServing(routeFor(18089));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('SERVED_CLAIM_AUTHORITY_UNAVAILABLE');
  });

  test('no claim attests NO_ACTIVE_LAUNCH', async () => {
    registry.clearClaim();
    const result = await claimAttestation.attestClaimedServing(routeFor(18089));
    expect(result.code).toBe('NO_ACTIVE_SUPERVISED_LAUNCH');
  });

  test('a base-only serving projects with null lineage and no route pin', () => {
    const { authority, authoritySha256 } = claimAttestation.claimAuthorityForLaunch(
      { port: 18089, servingModel: null },
      baseOnlyLaunchFacts(),
    );
    expect(authority.servingModel).toBeNull();
    expect(authority.routeIdentitySha256).toBeNull();
    expect(authority.lineageConfigSha256).toBeNull();
    expect(authority.servingArtifactSha256).toBe(sha256('serving-artifact'));
    expect(authoritySha256).toBe(refinementSha256(authority));
  });

  test('a base-only claim attests on port + artifact, and an expected servingModel refuses', async () => {
    const server = await serveHealth();
    const port = server.address().port;
    try {
      registry.writeClaim(process.pid, port, { model: '/models/base.gguf' });
      claimAttestation.publishServingClaimAuthority({
        pid: process.pid,
        port,
        launch: { port, servingModel: null },
        launchFacts: baseOnlyLaunchFacts(),
      });
      const ok = await claimAttestation.attestClaimedServing(
        { provider: 'llama-server', endpoint: `http://127.0.0.1:${port}` },
        { servingArtifactSha256: sha256('serving-artifact') },
      );
      expect(ok.ok).toBe(true);
      expect(ok.authority.servingModel).toBeNull();
      const named = await claimAttestation.attestClaimedServing(
        { provider: 'llama-server', endpoint: `http://127.0.0.1:${port}` },
        { servingModel: 'test-base-model', servingArtifactSha256: sha256('serving-artifact') },
      );
      expect(named.code).toBe('INVALID_EXPECTED_SERVING_LAUNCH');
    } finally {
      server.close();
    }
  });

  test('a published, reachable, expected-matching claim attests with its authority', async () => {
    const server = await serveHealth();
    const port = server.address().port;
    try {
      registry.writeClaim(process.pid, port, { servingModel: 'test-base-model' });
      claimAttestation.publishServingClaimAuthority({
        pid: process.pid,
        port,
        launch: { port, servingModel: 'test-base-model' },
        launchFacts: realLaunchFacts(),
      });
      const expected = {
        servingModel: 'test-base-model',
        servingArtifactSha256: sha256('serving-artifact'),
      };
      const result = await claimAttestation.attestClaimedServing(routeFor(port), expected);
      expect(result.ok).toBe(true);
      expect(result.authority.servingArtifactSha256).toBe(sha256('serving-artifact'));
      expect(result.authoritySha256).toBe(refinementSha256(result.authority));
    } finally {
      server.close();
    }
  });

  test('a route naming another port or model is ROUTE_MISMATCH', async () => {
    const server = await serveHealth();
    const port = server.address().port;
    try {
      registry.writeClaim(process.pid, port, { servingModel: 'test-base-model' });
      claimAttestation.publishServingClaimAuthority({
        pid: process.pid, port,
        launch: { port, servingModel: 'test-base-model' },
        launchFacts: realLaunchFacts(),
      });
      const wrongPort = await claimAttestation.attestClaimedServing(routeFor(port + 1));
      expect(wrongPort.code).toBe('SUPERVISED_LAUNCH_ROUTE_MISMATCH');
      const wrongModel = await claimAttestation.attestClaimedServing({
        provider: 'llama-server', endpoint: `http://127.0.0.1:${port}`, model: 'another-model',
      });
      expect(wrongModel.code).toBe('SUPERVISED_LAUNCH_ROUTE_MISMATCH');
    } finally {
      server.close();
    }
  });

  test('a tampered authority is IDENTITY_MISMATCH', async () => {
    const server = await serveHealth();
    const port = server.address().port;
    try {
      registry.writeClaim(process.pid, port, { servingModel: 'test-base-model' });
      claimAttestation.publishServingClaimAuthority({
        pid: process.pid, port,
        launch: { port, servingModel: 'test-base-model' },
        launchFacts: realLaunchFacts(),
      });
      const claim = registry.readClaim();
      claim.servingAuthority.servingArtifactBytes = 1;
      registry.writeClaimAuthority(process.pid, port, { servingAuthority: claim.servingAuthority });
      const result = await claimAttestation.attestClaimedServing(routeFor(port));
      expect(result.code).toBe('SUPERVISED_LAUNCH_IDENTITY_MISMATCH');
    } finally {
      server.close();
    }
  });

  test('a claimed pid with nothing answering is UNREACHABLE', async () => {
    const server = await serveHealth();
    const port = server.address().port;
    registry.writeClaim(process.pid, port, { servingModel: 'test-base-model' });
    claimAttestation.publishServingClaimAuthority({
      pid: process.pid, port,
      launch: { port, servingModel: 'test-base-model' },
      launchFacts: realLaunchFacts(),
    });
    server.close();
    await new Promise((resolve) => server.once('close', resolve));
    const result = await claimAttestation.attestClaimedServing(routeFor(port));
    expect(result.code).toBe('SUPERVISED_LAUNCH_UNREACHABLE');
  });
});

describe('stopOwnedSupervised — the owner-bound stop contract', () => {
  test('a process with no child of its own never touches the claimed sibling', async () => {
    // A real live process stands in for the sibling's llama-server.
    const sibling = spawn('sleep', ['30'], { stdio: 'ignore' });
    await new Promise((resolve) => sibling.once('spawn', resolve));
    registry.clearClaim(); // a live claim from an earlier test is never overwritten
    registry.writeClaim(sibling.pid, 18089, { servingModel: 'test-base-model' });
    try {
      const result = await supervisor.stopOwnedSupervised();
      expect(result).toEqual({ status: 'not-owned' });
      expect(registry.pidAlive(sibling.pid)).toBe(true);
      expect(registry.readClaim()?.pid).toBe(sibling.pid);
      // The operator law still stands beside it: stopSupervised DOES claim-stop.
      const stopped = await supervisor.stopSupervised();
      expect(stopped.status).toBe('stopped');
      const deadline = Date.now() + 5000;
      while (registry.pidAlive(sibling.pid) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(registry.pidAlive(sibling.pid)).toBe(false);
    } finally {
      sibling.kill('SIGKILL');
    }
  }, 20000);
});

describe('a second launch never takes or erases a live server\'s claim (2026-10-05)', () => {
  // A backend relit onto a port the house desk's server already answered: its
  // launch overwrote the claim, died out of memory, and its exit cleared the
  // claim of the server still serving — every identity benchmark arm refused.
  test('the live holder keeps the claim through a doomed launch and its exit', async () => {
    const live = spawn('sleep', ['30']);
    try {
      registry.clearClaim();
      registry.writeClaim(live.pid, 18090, { model: '/models/base.gguf' });
      registry.writeClaim(process.pid, 18090, { model: '/models/base.gguf' });
      expect(registry.readClaim().pid).toBe(live.pid);
      registry.clearClaim(process.pid);
      expect(registry.readClaim().pid).toBe(live.pid);
      registry.writeClaim(process.pid, 9, { model: '/models/base.gguf' });
      expect(registry.readClaim()).toMatchObject({ pid: live.pid, port: 18090 });
      registry.clearClaim(live.pid);
      expect(registry.readClaim()).toBeNull();
    } finally {
      live.kill('SIGKILL');
    }
  });

  test('a dead holder\'s claim is replaced, and a bare clear still clears', () => {
    registry.writeClaim(2 ** 22 + 7, 18090, {});
    registry.writeClaim(process.pid, 18090, {});
    expect(registry.readClaim().pid).toBe(process.pid);
    registry.clearClaim();
    expect(registry.readClaim()).toBeNull();
  });
});
