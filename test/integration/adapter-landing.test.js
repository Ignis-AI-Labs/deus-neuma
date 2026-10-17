// Gnosis for the switch landing report and the flavor-left-behind notice
// (model-portability Phase 4): when the operator moves a being to a different
// base, the report must say whether the refined voice crossed — and when a
// turn then speaks bare because of it, the desk must HEAR it once, not never
// and not every turn.
//
// Everything here is real (RULE 0): real temp workspace root, real DEK, real
// AES-GCM envelopes, the real registry authority, a real HTTP listener for
// /lora-adapters on a real socket. No mock, stub, fake, or spy in the path.

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import workspace, {
  getWorkspacesRoot,
  setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { refinementCustodyIdentity } from '../../core/refinement/training-authority-contract.js';
import { adapterLandingFor } from '../../backend/services/adapter-landing.js';
import { bindTurnAdapter } from '../../backend/services/portal-turn-adapter-binding.js';
import { invalidateServerAdapters } from '../../backend/services/llm-provider.js';
import {
  activateServingLoadedAdapterAuthority,
  createServingLoadedAdapterAuthority,
  releaseServingLoadedAdapterAuthority,
} from '../../backend/services/serving-loaded-adapter-authority.js';
import {
  commitFirstRefinementRegistration,
  corruptCommittedRefinementRegistry,
  servingLineageFor,
} from '../helpers/committed-refinement-registry.js';

const SERVING_MODEL = 'gemma-4-31b';
const OTHER_BASE = 'qwen3.5-122b-a10b';
const ARTIFACT_SHA256 = createHash('sha256').update(Buffer.from('landing-proof weights')).digest('hex');
const CHILD_FD = 4;
const LOADED = [{ id: 0, path: `/proc/self/fd/${CHILD_FD}`, scale: 1 }];
const DNA = Object.freeze({ version: '1.0.0', identity: { name: 'Landing Prooflet' } });
const GENESIS = 'd'.repeat(64);

let root;
let priorRoot;
let priorKey;
let priorServed;
let priorSubstrate;
let server;
let endpoint;
let neumaId;
let loadedAuthority = null;

const commitAdapter = async (id, adapterId) =>
  commitFirstRefinementRegistration({
    workspace,
    neumaId: id,
    adapterId,
    artifactSha256: ARTIFACT_SHA256,
    ceremonyId: `${adapterId}-ceremony`,
    custody: await refinementCustodyIdentity(id, await workspace.readDNA(id)),
    lineage: servingLineageFor(SERVING_MODEL),
    scale: 1,
  });

const publishLoadedAdapters = () => {
  loadedAuthority = createServingLoadedAdapterAuthority({
    launchInstanceSha256: createHash('sha256').update('landing-proof-launch').digest('hex'),
    adapters: [{ artifactSha256: ARTIFACT_SHA256 }],
    childFds: [CHILD_FD],
  });
  activateServingLoadedAdapterAuthority(loadedAuthority);
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/lora-adapters') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(LOADED));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  // The custody layer refuses a group/world-writable ancestor chain, so the
  // shared /tmp lane cannot host a sovereign workspace root.
  root = await fs.mkdtemp(path.join(os.homedir(), '.neuma-adapter-landing-'));
  priorRoot = getWorkspacesRoot();
  priorKey = process.env.DNA_ENCRYPTION_KEY;
  priorServed = process.env.LLAMA_SERVER_MODEL;
  priorSubstrate = process.env.SUBSTRATE_MODEL;
  // Hermetic alias law: the base's alias set must contain only what THIS test
  // names — the host shell's substrate env is another machine's fact.
  delete process.env.LLAMA_SERVER_MODEL;
  delete process.env.SUBSTRATE_MODEL;
  process.env.DNA_ENCRYPTION_KEY = 'adapter-landing-real-key';
  resetWorkspaceCryptoKey();
  setWorkspacesRoot(path.join(root, 'workspaces'));
  neumaId = `landing-being-${Math.floor(Math.random() * 1e9).toString(36)}`;
  await workspace.create(neumaId);
  await workspace.writeNeumaDEK(neumaId, GENESIS);
  await workspace.writeDNA(neumaId, DNA);
  invalidateServerAdapters(endpoint);
});

afterEach(async () => {
  if (loadedAuthority) releaseServingLoadedAdapterAuthority(loadedAuthority);
  loadedAuthority = null;
  setWorkspacesRoot(priorRoot);
  if (priorKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = priorKey;
  if (priorServed === undefined) delete process.env.LLAMA_SERVER_MODEL;
  else process.env.LLAMA_SERVER_MODEL = priorServed;
  if (priorSubstrate === undefined) delete process.env.SUBSTRATE_MODEL;
  else process.env.SUBSTRATE_MODEL = priorSubstrate;
  resetWorkspaceCryptoKey();
  invalidateServerAdapters(endpoint);
  await fs.rm(root, { recursive: true, force: true });
});

describe('adapter landing report', () => {
  it('answers none for a being that was never refined', async () => {
    const landing = await adapterLandingFor(neumaId, { model: SERVING_MODEL });
    expect(landing.state).toBe('none');
  });

  it('answers carried when the new route names the forged base', async () => {
    await commitAdapter(neumaId, 'landing-refinement-1');
    const landing = await adapterLandingFor(neumaId, { model: SERVING_MODEL });
    expect(landing.state).toBe('carried');
    expect(landing.adapterId).toBe('landing-refinement-1');
    expect(landing.adapterBase).toBe(SERVING_MODEL);
  });

  it('answers stays-behind, naming the base the voice is bound to, on a different base', async () => {
    await commitAdapter(neumaId, 'landing-refinement-2');
    const landing = await adapterLandingFor(neumaId, { model: OTHER_BASE });
    expect(landing.state).toBe('stays-behind');
    expect(landing.adapterBase).toBe(SERVING_MODEL);
  });

  it('answers unknown — never a guess — when the registry cannot be authenticated', async () => {
    await commitAdapter(neumaId, 'landing-refinement-3');
    await corruptCommittedRefinementRegistry(workspace, neumaId);
    const landing = await adapterLandingFor(neumaId, { model: OTHER_BASE });
    expect(landing.state).toBe('unknown');
    expect(typeof landing.reason).toBe('string');
  });
});

// The flavor-left-behind notice was removed with the binding that produced
// it (2026-08-23). It announced that a being's refined voice "stayed behind"
// when the base moved -- honest under LoRA, meaningless under NITE, where the
// voice crosses in the prompt. Founder saw it fire and it read as a being losing
// itself. The landing report above goes with adapter-landing.js in the purge.
