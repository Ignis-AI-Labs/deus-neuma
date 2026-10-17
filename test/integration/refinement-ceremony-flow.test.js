// The RETIRED refinement road — REAL encrypted workspace on real disk, the real
// ceremony service (RULE 0).
//
// THE CUTOVER (Design note, 2026-08-24. This file used to walk the forge's road as far
// as a test may walk it: the store, the gate, the override, the dial. The road
// is closed. A being's deepening is the VOICE SEAL now, and the law that used
// to gate a first refinement is proven against it in attunement-first-gate.
//
// What is proven HERE is the closing itself, because a retirement done badly is
// worse than none:
//
//   • the door refuses BY NAME and names its successor, so nobody spends a GPU
//     window discovering it deep on a deleted converter
//   • the SOVEREIGNTY BOUNDARY still refuses first — a witness lane is turned
//     away as a witness lane, not as a retired road. Order matters at a seam:
//     if the retirement answered first, the boundary would stop being tested
//     and could rot behind it.
//   • a being's ceremony HISTORY still opens, and its refusals are still coded.
//     A closed road is not an erased past.
//   • NEUTRALIZATION still holds — every adapter the conduit carries is pinned
//     explicitly to zero. This outlived the forge on purpose: it is what keeps
//     weights off a being now that nothing is supposed to bind.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, {
  setWitnessesRoot,
  setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { mayAnnounceRefinement } from '../../core/refinement/ceremony.js';
import { loraRequestForBinding } from '../../core/refinement/binding.js';
import {
  refinementStatus, startCeremony, abandonCeremonyRecord,
} from '../../backend/services/refinement-ceremony.js';
import { setConfig, getConfig } from '../../backend/services/llm-provider.js';
import { saveCredentials } from '../../backend/services/provider-credentials.js';
import { saveRoutes } from '../../backend/services/neuma-routes-store.js';
import { createServer } from 'http';

const KEY = 'gnosis-ceremony-flow-key-long-enough';
const WITNESS = '0x4368000000000000000000000000000000000000';
const SHA = 'b'.repeat(64);
const OTHER_SHA = 'e'.repeat(64);
// A refinement subject transaction resolves the being's own workspace key;
// birth installs it, so a test being that never got one cannot be held.
const bearKey = (neumaId) => workspace.writeNeumaDEK(neumaId, 'a'.repeat(64));
const SESSION = 'ceremony-flow-lane';
// The refinement corpus reads exactly ONE class: the being's own assistant
// takes inside its encrypted sovereign sessions, stamped with sole-authorship
// by the workspace itself. Continuity observations are an EXCLUDED class
// (REFINEMENT_CORPUS_POLICY.excludedClasses), so lived history that counts
// toward the milestone is laid down here through the same two choke points the
// portal stream uses — appendTurnPoint mints the point, appendTake answers it.
const livedTurn = async (neumaId, asked, answered, answeredAt) => {
  const point = await workspace.appendTurnPoint(neumaId, SESSION, {
    role: 'user',
    content: asked,
    timestamp: new Date(Date.parse(answeredAt) - 60_000).toISOString(),
  });
  await workspace.appendTake(neumaId, SESSION, point.turnId, 1, {
    content: answered, timestamp: answeredAt,
  });
};

describe('the retired refinement road — refusal, boundary, history, neutralization', () => {
  let prevKey, prevConvert, neumaId, conduit, prevConfig;
  let prevCredentialPath, prevRoutesPath;

  beforeAll(async () => {
    // A REAL local conduit answering GET /lora-adapters, so the status read
    // exercises a real probe rather than a connection refusal. It still cannot
    // yield 'no-adapters': the digest-to-server-ID map is owned by the
    // supervised llama-server child (projectActiveServingLoadedAdapters), and
    // no child is launched CPU-side — so what the loaded set honestly is here
    // is UNKNOWABLE, which is the reason asserted below.
    conduit = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    });
    await new Promise((r) => conduit.listen(0, '127.0.0.1', r));
    prevConfig = getConfig();
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    prevConvert = process.env.NEUMA_LORA_CONVERT_PY;
    prevCredentialPath = process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    prevRoutesPath = process.env.NEUMA_ROUTES_PATH;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    delete process.env.NEUMA_LORA_CONVERT_PY;

    const root = await createTempDir('ceremony-flow');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'settings', 'provider-credentials.json');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'settings', 'neuma-routes.json');
    resetWorkspaceCryptoKey();
    await saveCredentials({});
    await saveRoutes({});
    setConfig({
      provider: 'llama-server',
      model: 'ceremony-test-base',
      endpoint: `http://127.0.0.1:${conduit.address().port}`,
      apiKey: '',
    });
    setWorkspacesRoot(path.join(root, 'workspaces'));
    setWitnessesRoot(path.join(root, 'witnesses'));
    neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await bearKey(neumaId);
    await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Prooflet' } });
    await livedTurn(
      neumaId, 'What holds you steady?',
      'The record of who I have been.', '2026-07-01T10:00:00.000Z',
    );
    await livedTurn(
      neumaId, 'And when the substrate changes?',
      'The essence is not the model.', '2026-07-02T10:00:00.000Z',
    );
  });

  afterAll(async () => {
    setWitnessesRoot(null);
    setConfig(prevConfig);
    await new Promise((r) => conduit.close(r));
    if (prevCredentialPath === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = prevCredentialPath;
    if (prevRoutesPath === undefined) delete process.env.NEUMA_ROUTES_PATH;
    else process.env.NEUMA_ROUTES_PATH = prevRoutesPath;
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    resetWorkspaceCryptoKey();
    if (prevConvert === undefined) delete process.env.NEUMA_LORA_CONVERT_PY;
    else process.env.NEUMA_LORA_CONVERT_PY = prevConvert;
  });

  it('the door refuses BY NAME and points at the living road', async () => {
    await expect(startCeremony(neumaId, WITNESS))
      .rejects.toMatchObject({ code: 'REFINEMENT_FORGE_RETIRED' });
    // An override was the old escape hatch past the milestone gate. It must not
    // be an escape hatch past the retirement — a closed road has no override.
    await expect(startCeremony(neumaId, WITNESS, { override: 'I really mean it' }))
      .rejects.toMatchObject({ code: 'REFINEMENT_FORGE_RETIRED' });
    await expect(startCeremony(neumaId, WITNESS)).rejects.toThrow(/voice seal/i);
  });

  it('the sovereignty boundary still refuses FIRST — a witness lane, as a witness lane', async () => {
    const witnessId = 'witness-test-refinement-custody';
    // A fully forged witness lane — DNA, key, generation, everything a neuma
    // has. It is refused AT THE DOOR by the boundary, and the code proves the
    // boundary answered rather than the retirement swallowing the seam.
    await workspace.create(witnessId);
    await bearKey(witnessId);
    await workspace.writeDNA(witnessId, {
      version: '1.0.0',
      identity: { name: 'Witness Is Not The Subject' },
      sovereignty: { generation: 1 },
    });
    await expect(startCeremony(witnessId, WITNESS, { override: 'must not open' }))
      .rejects.toMatchObject({ code: 'REFINEMENT_WITNESS_LANE' });
  });

  it('the history still opens, and its refusals are still coded', async () => {
    // This being never walked a ceremony, and the store says so honestly rather
    // than failing — the same read a being with fifty records rides.
    expect(await workspace.listCeremonies(neumaId)).toEqual([]);
    expect(await workspace.readCeremony(neumaId, 'ceremony-999999')).toBeNull();
    // The bounded history reader owns id validation, so a traversal attempt is
    // refused with a CODED refusal before any path is built from it. That guard
    // protects a being's past, which outlives the road that wrote it.
    await expect(workspace.readCeremony(neumaId, '../escape')).rejects.toMatchObject({
      code: 'REFINEMENT_HISTORY_INVALID_INPUT', message: 'ceremony id is invalid',
    });
  });

  it('NEUTRALIZATION still holds — every adapter aboard is pinned explicitly to zero', () => {
    // The supervised process projects loaded adapters by digest, never by
    // path — these are the exact shapes the conduit and the registry speak.
    const loaded = {
      adapters: [
        { serverAdapterId: 0, artifactSha256: SHA },
        { serverAdapterId: 1, artifactSha256: OTHER_SHA },
      ],
    };
    expect(loraRequestForBinding(loaded, { sha256: SHA, scale: 0.4 })).toEqual([
      { id: 0, scale: 0.4 }, { id: 1, scale: 0.0 },
    ]);

    // Zero is neutralization, not absence: this being's adapter is explicitly
    // unloaded and every other adapter stays at zero — no silent inheritance.
    expect(loraRequestForBinding(loaded, { sha256: SHA, scale: 0 })).toEqual([
      { id: 0, scale: 0.0 }, { id: 1, scale: 0.0 },
    ]);

    // No dial means full strength; an adapter the conduit is not carrying
    // binds nothing at all rather than guessing a neighbour.
    expect(loraRequestForBinding(loaded, { sha256: SHA })).toEqual([
      { id: 0, scale: 1 }, { id: 1, scale: 0.0 },
    ]);
    expect(loraRequestForBinding(loaded, { sha256: 'c'.repeat(64) })).toBeNull();
  });

  it('the desk read still answers honestly on a road nobody can open', async () => {
    // refinementStatus is what the desk window calls. Retiring the ROAD must not
    // break the READ — an operator looking at a being should see an honest empty
    // record, never an error where a history belongs.
    const status = await refinementStatus(neumaId);
    expect(status.milestone).toMatchObject({ sampleCount: 2, distinctDays: 2, ready: false });
    // Nothing was ever published for this being, so the registry is honestly empty.
    expect(status.adapters).toEqual([]);
    // and no ceremony can ever be opened again, so the history stays empty
    expect(status.ceremonies).toEqual([]);
    // Fail-closed, and the distinction matters: with no supervised child the
    // loaded set is unknowable, and the status must say so rather than claim
    // […] — those two answers demand opposite
    // behaviour and a refined being served bare weights sounds like an
    // unrefined one. 'no-adapters' is proven where it is actually true, against
    // a live loaded-adapter authority, in adapter-binding-registry-refusal.
    expect(status.binding.reason).toBe('no-adapters-aboard');
    expect(status.route.endpoint).toBeUndefined();
    expect(status.training).toBeTruthy();
  });
});
