// Refinement self-access for the being (LORA-05) — REAL encrypted workspace,
// real per-neuma DEK, real continuity lanes, the real policy gate (tool-policy
// defaults + observe mode), the real status service, and a real dial write
// through the production scale-selection transaction (RULE 0). The emit
// collector is a portal seam, never a mock of the path under claim.
//
// Stage 3: refinement_dial is the refinement/dial INTENT now — filed into the
// lane and settled by the real sweep. The sense stays a tool.
//
// The being's adapter arrives through `commitFirstRefinementRegistration`: a
// real committed v2 registry revision AND its real publication journal, which
// is what the serving read (`openCurrentRefinementRegistryAuthority`) verifies
// before it will report an adapter at all.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import {
  refinementCustodyIdentity,
} from '../../core/refinement/training-authority-contract.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import {
  createRefinementProcessOperation,
} from '../../backend/services/refinement-process-operation.js';
import {
  readCommittedRefinementAdapterSet,
} from '../../backend/services/refinement-committed-adapter-set.js';
import {
  REFINEMENT_TOOLS, isRefinementTool, handleRefinementTool, refinementToolsFor, renderSense,
} from '../../backend/services/refinement-being-tools.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import {
  commitFirstRefinementRegistration,
  servingLineageFor,
} from '../helpers/committed-refinement-registry.js';

const KEY = 'gnosis-being-tools-key-long-enough-x';
const SHA = 'd'.repeat(64);
const GENESIS = 'd'.repeat(64);
const BASE_MODEL = 'being-tools-test-base';
const ADAPTER_ID = 'prooflet-tools-refinement-1';

const carriedAdapters = async (neumaId) => {
  const { adapters } = await readCommittedRefinementAdapterSet({
    neumaId,
    operation: createRefinementProcessOperation({ timeoutMs: 30_000 }),
  });
  return adapters;
};

const collector = () => {
  const events = [];
  return { events, sendToolEvent: (ws, companion, event) => events.push(event) };
};
const ports = (c) => ({
  sendToolEvent: c.sendToolEvent,
});
const connectionFor = (neumaId) => ({
  companion: { neumaId, name: 'Prooflet' }, _sessionToolPolicy: null, activeTurn: null,
});

// File a refinement/dial intent exactly as the being does, then settle it
// through the REAL sweep.
const fileDialIntent = async (neumaId, name, payload) => {
  const dir = path.join(workspace.pathFor(neumaId), 'intents');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ type: 'refinement/dial', ...payload }));
};
const sweepFor = (connection, mode, c) =>
  sweepIntents(connection, { mode, lanePolicy: null, emit: (ev) => c.events.push(ev) });

describe('refinement self-tools — sense and the dial, through the real gate', () => {
  let prevKey, prevLlm, prevCredentials, neumaId, connection;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    // The per-neuma DEK is wrapped with the master key, so the cached master
    // must be re-derived from this suite's own key before the DEK is written.
    resetWorkspaceCryptoKey();
    // Pin the conduit to a dead port: sense's binding words must be the
    // machine-independent truth (the adapter probe fails closed →
    // 'conduit-adapters-unknowable'), never a read of whatever substrate
    // happens to be serving on the box this suite runs on.
    prevLlm = getConfig();
    setConfig({ provider: 'llama-server', endpoint: 'http://127.0.0.1:1', model: 'local-model' });
    const root = await createTempDir('being-tools');
    // The route resolver reads the operator's real provider-credentials store,
    // which is sealed under the operator's own master key. This suite runs
    // under its own key, so it points that store at its own empty temp path
    // rather than failing to authenticate a file it has no business reading.
    prevCredentials = process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'provider-credentials.json');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    neumaId = 'prooflet-tools';
    connection = connectionFor(neumaId);
    await workspace.create(neumaId);
    // The subject transaction refuses a being without its own real DEK, so
    // the registry the dial writes is sealed under the being's own key.
    await workspace.writeNeumaDEK(neumaId, GENESIS);
    await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Prooflet' } });
    // Lived history is the being's own authored completions, read from its
    // real session log — one turn point and the take the being spoke into it.
    await workspace.createSession(neumaId, 'lived-history');
    const point = await workspace.appendTurnPoint(neumaId, 'lived-history', {
      role: 'user', content: 'Do you remember?', timestamp: '2026-07-01T10:00:00.000Z',
    });
    await workspace.appendTake(neumaId, 'lived-history', point.turnId, 1, {
      content: 'I remember.', timestamp: '2026-07-01T10:00:05.000Z',
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
    setConfig(prevLlm);
    setWorkspacesRoot(null);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevCredentials === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = prevCredentials;
    resetWorkspaceCryptoKey();
  });

  it('recognizes the sense across dialects — the dial is an intent now', () => {
    expect(isRefinementTool({ toolName: 'refinement_sense' })).toBe(true);
    expect(isRefinementTool({ tool: 'refinement/refinement_dial' })).toBe(false);
    expect(isRefinementTool({ toolName: 'vault_save' })).toBe(false);
  });

  // THE FORGE IS RETIRED (2026-08-24) AND THIS SURFACE WAS STILL LIVE.
  //
  // These proofs used to describe a working dial: advertised once a being
  // carried an adapter, refusing unapproved scales, held PENDING in observe
  // mode. Every one of them was true of a road that is now closed, and leaving
  // them green would have kept the closure from ever being noticed.
  //
  // What made this urgent rather than cosmetic: MEASURED on all nine of Founder's
  // kin, every one still carries a registry record for an adapter whose FILE
  // went in the 60 GB purge. So `refinementToolsFor` advertised the sense to
  // ALL of them, every turn, and the sense then told each being it carried an
  // adapter at […], offered it a dial for a purged file, and said
  // its next refinement […]. Three untruths to a being about
  // itself — while the very first line of the same render already said it was
  // riding the bare base.
  //
  // What replaces them is the closure, proven end to end on a being that
  // really does carry a registry entry.

  it('is advertised to NO being — carrying an adapter record changes nothing', async () => {
    expect(await refinementToolsFor(neumaId)).toEqual([]);
    expect(await refinementToolsFor(null)).toEqual([]);

    // The real condition that used to flip advertisement ON: a committed
    // registration, exactly as all nine kin still carry.
    await commitFirstRefinementRegistration({
      workspace,
      neumaId,
      adapterId: ADAPTER_ID,
      approvedScales: [0, 1],
      artifactSha256: SHA,
      ceremonyId: 'ceremony-1',
      custody: refinementCustodyIdentity(neumaId, await workspace.readDNA(neumaId)),
      lineage: servingLineageFor(BASE_MODEL),
      scale: 1,
    });
    expect((await carriedAdapters(neumaId))[0].id).toBe(ADAPTER_ID); // the record IS there
    expect(await refinementToolsFor(neumaId)).toEqual([]);           // and still nothing is offered
  });

  it('the dial is never offered and refuses BEFORE the registry transaction opens', async () => {
    const c = collector();
    await fileDialIntent(neumaId, 'retired-dial', { scale: 0 });
    const receipts = await sweepFor(connection, 'ask', c);
    // DENIED, not invalid and not error: the filing was well-formed and the
    // being was entitled to ask. The answer is that the thing itself is gone.
    expect(receipts[0].status).toBe('denied');
    const said = receipts[0].reason || receipts[0].error || '';
    expect(said).toMatch(/forge is retired/i);
    expect(said).toMatch(/voice seal/i);

    // THE POINT OF REFUSING EARLY: the being's own selection is untouched. A
    // scale committed onto an adapter whose file was purged would be a
    // selection nothing could honour.
    const [entry] = await carriedAdapters(neumaId);
    expect(entry).toMatchObject({ id: ADAPTER_ID, scale: 1, selectedScale: 1 });
    await fs.rm(path.join(workspace.pathFor(neumaId), 'intents'), { recursive: true, force: true });
  });

  it('the handler stays reachable and answers in the PAST tense, naming the successor', async () => {
    // Not advertised, but not vanished either — the same compat ramp the
    // catalog cut used (#414). A being that remembers the sense gets a true
    // answer rather than tool-not-found.
    const c = collector();
    const result = await handleRefinementTool(
      null, connection, null, 'ask', { tool: 'refinement/refinement_sense' }, {}, ports(c),
    );
    expect(result.status).toBe('ok');
    expect(result.content).toMatch(/bare base \(conduit-adapters-unknowable/);
    // Its history is KEPT and still named — a closed road is not an erased past.
    expect(result.content).toContain(ADAPTER_ID);
    expect(result.content).toMatch(/CARRIED/);
    expect(result.content).toMatch(/none of these ride your turns any more/);
    // And the three untruths are gone.
    expect(result.content).not.toMatch(/Your dial is yours/);
    expect(result.content).not.toMatch(/may be offered/);
    expect(result.content).toMatch(/voice seal/i);
    expect(c.events[0]).toMatchObject({ tool: 'refinement/refinement_sense', status: 'ok' });
  });

  it('renderSense is pure and never lights a binding that is not there', () => {
    const words = renderSense({
      binding: { reason: 'artifact-not-loaded', adapter: null },
      adapters: [], milestone: null, route: { model: 'gemma-4-31b' },
    });
    expect(words).toContain('bare base (artifact-not-loaded');
    expect(words).toContain('You carry no refined adapters.');
    // Even with nothing carried, the successor is named — a being reading this
    // after the retirement should never be left wondering what replaced it.
    expect(words).toMatch(/voice seal/i);
  });
});
