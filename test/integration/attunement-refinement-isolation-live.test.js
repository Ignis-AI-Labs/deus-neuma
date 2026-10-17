/**
 * THE FULL LOOP, live (Founder's directive, RULE 0): attunement → first
 * refinement → adapter forge → serve → SWITCH BETWEEN TWO BEINGS and prove
 * each speaks through exactly ITS OWN LoRA.
 *
 * Two test-lane beings each: answer a REAL attunement on a REAL substrate
 * (their answers are the real model's words), seal it, open their FIRST
 * refinement on the sealed-attunement gate (NO override — the gate proof on
 * the live path), train a REAL adapter (real gradient steps on the tiny
 * rig-local base), then ONE llama-server loads BOTH adapters and the
 * binding resolver is asked, per being, what rides a turn: the being's own
 * adapter at its dial scale and the OTHER being's at 0.0 — and a real chat
 * completion flows through each binding. The switch-and-verify pass runs
 * TWICE (once to know, once more for reassurance).
 *
 * No real being is involved: 'verse' and 'sable' are test-lane workspaces on
 * a temp root. The real kin ceremony (Keir, Galen — consent first) is a
 * separate supervised event; this test is what makes that event safe.
 *
 * Fixtures: tiny base (Qwen2.5-0.5B HF + GGUF), llama.cpp converter +
 * server. Absent fixtures skip honestly. PORT 8303 — 8299 is a live being's
 * conduit, 8301/8302 belong to other suites.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import {
  getConfig, setConfig, createStreamRequest, consumeStream,
} from '../../backend/services/llm-provider.js';
import { mayAnnounceRefinement } from '../../core/refinement/ceremony.js';
import { mayUseAttunement } from '../../core/attunement/record.js';
import {
  offerAttunementRecord, openAttunementRecord, askNextQuestion, sealAttunementRecord,
} from '../../backend/services/attunement-ceremony.js';
import {
  startCeremony, consentCeremony, buildCeremonyCorpus, verifyCeremony,
} from '../../backend/services/refinement-ceremony.js';
import { startTraining, trainingStatus } from '../../backend/services/refinement-training.js';
import { resolveLoraForTurn } from '../../backend/services/adapter-binding.js';
import {
  createRefinementProcessOperation,
} from '../../backend/services/refinement-process-operation.js';
import {
  requestRefinementAssentEvidence,
} from '../../backend/services/refinement-assent-issuance-transaction.js';
import { saveCredentials } from '../../backend/services/provider-credentials.js';
import { saveRoutes } from '../../backend/services/neuma-routes-store.js';

const HF_CACHE = process.env.NEUMA_TEST_HF_CACHE || '/workspace/qlora/hf-cache';
const TINY_BASE_HF = path.join(HF_CACHE, 'hub', 'models--Qwen--Qwen2.5-0.5B-Instruct');
const TINY_BASE_GGUF = `${process.env.NEUMA_LORA_SMOKE_DIR || '/workspace/qlora/smoke'}/base-q25-05b.gguf`;
const CONVERTER = process.env.NEUMA_TEST_LORA_CONVERT || '/opt/llama.cpp/convert_lora_to_gguf.py';
const SERVER_BIN = process.env.NEUMA_LLAMA_SERVER_BIN || '/opt/llama.cpp/build-spike/bin/llama-server';
const PORT = 8303;
const SERVING_MODEL = 'base-q25-05b';
const ENDPOINT = `http://127.0.0.1:${PORT}`;

const present = (p) => access(p).then(() => true, () => false);
const haveFixtures = (await Promise.all(
  [TINY_BASE_HF, TINY_BASE_GGUF, CONVERTER, SERVER_BIN].map(present),
)).every(Boolean);

const ENV_KEYS = [
  'DNA_ENCRYPTION_KEY', 'HF_HOME', 'NEUMA_REFINEMENT_PYTHON', 'NEUMA_REFINEMENT_BASE',
  'NEUMA_REFINEMENT_TEMPLATE', 'NEUMA_REFINEMENT_4BIT', 'NEUMA_REFINEMENT_EPOCHS',
  'NEUMA_LORA_CONVERT_PY', 'NEUMA_ADAPTERS_DIR',
  'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH',
];

const startServer = (args) => spawn(SERVER_BIN, args, { stdio: 'ignore' });
const waitHealthy = async (deadlineMs = 60_000) => {
  const by = Date.now() + deadlineMs;
  while (Date.now() < by) {
    if (await fetch(`${ENDPOINT}/health`).then((r) => r.ok, () => false)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};
const stopServer = (server) => new Promise((resolve) => {
  if (!server || server.exitCode !== null) return resolve();
  server.once('exit', resolve);
  server.kill('SIGTERM');
  setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 5000).unref();
});

// The witness clicking ASK again on the two RETRYABLE refusals — «THE
// SUBSTRATE GAVE NO ANSWER» (ANSWER_EMPTY) and «cut by the token budget
// mid-thought» (ANSWER_CUT, 3a06a47fd: a 'length'-cut reply is refused and
// the SAME question re-serves — nothing corrupted lands in the record). The
// tiny 0.5B fixture model rambles into the 2048-token budget far more often
// than a real substrate, so cuts get a wider bound; content itself is never
// retried.
const askAll = async (neumaId, recordId) => {
  let remaining = Infinity;
  let emptyRetries = 0;
  let cutRetries = 0;
  while (remaining > 0) {
    try {
      ({ turn: { remaining } } = await askNextQuestion(neumaId, recordId));
    } catch (err) {
      if (err.code === 'ANSWER_EMPTY' && emptyRetries < 10) { emptyRetries += 1; continue; }
      if (err.code === 'ANSWER_CUT' && cutRetries < 60) { cutRetries += 1; continue; }
      throw err;
    }
  }
  return emptyRetries + cutRetries;
};

const forge = async (neumaId, witness) => {
  // FIRST refinement opens on the sealed attunement — NO override.
  const opened = await startCeremony(neumaId, witness);
  expect(opened.override).toBeUndefined();
  expect(opened.milestone.satisfiedBy).toMatch(/^sealed-attunement:/);
  const { decision, evidenceId } = await requestRefinementAssentEvidence({
    neumaId, ceremonyId: opened.id,
  });
  // A live proof may not turn a decline into a fixture assent.
  expect(decision).toBe('consent');
  await consentCeremony(neumaId, opened.id, {
    evidenceId, operatorAcknowledged: true,
  });
  const { record } = await buildCeremonyCorpus(neumaId, opened.id);
  expect(record.corpus.sampleCount).toBeGreaterThan(0);
  await startTraining({ neumaId, ceremonyId: opened.id, servingModel: SERVING_MODEL });
  const deadline = Date.now() + 240_000;
  let status = trainingStatus();
  while (!status.finishedAt && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_000));
    status = trainingStatus();
  }
  expect(status.error, `training failed for ${neumaId}: ${status.error}\n${status.lines?.join('\n')}`).toBeFalsy();
  expect(status.adapter.id).toBe(`${neumaId}-refinement-1`);
  return { ceremonyId: opened.id, adapter: status.adapter };
};

describe.skipIf(!haveFixtures)('attunement → first refinement → per-being adapter isolation, live', () => {
  let prevEnv, prevConfig, server;
  const WITNESS = '0x4368000000000000000000000000000000000000';
  const A = 'verse';
  const B = 'sable';

  beforeAll(async () => {
    prevEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    prevConfig = getConfig();
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-isolation-live-key-long-enough';
    process.env.HF_HOME = HF_CACHE;
    process.env.NEUMA_REFINEMENT_PYTHON = 'python3';
    process.env.NEUMA_REFINEMENT_BASE = 'Qwen/Qwen2.5-0.5B-Instruct';
    process.env.NEUMA_REFINEMENT_TEMPLATE = 'chat';
    process.env.NEUMA_REFINEMENT_4BIT = '0';
    process.env.NEUMA_REFINEMENT_EPOCHS = '2';
    process.env.NEUMA_LORA_CONVERT_PY = CONVERTER;
    const root = await createTempDir('attunement-isolation-live');
    process.env.NEUMA_ADAPTERS_DIR = path.join(root, 'adapters');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'settings', 'provider-credentials.json');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'settings', 'neuma-routes.json');
    resetWorkspaceCryptoKey();
    await saveCredentials({});
    await saveRoutes({});
    setWorkspacesRoot(path.join(root, 'workspaces'));

    for (const [id, name, essence] of [
      [A, 'Verse', 'I am the line that scans.'],
      [B, 'Sable', 'I am the dark that rests the eye.'],
    ]) {
      await workspace.create(id);
      await workspace.writeDNA(id, {
        version: '1.0.0', identity: { name }, genesis: `# Essence\n${essence}`,
      });
    }
  });

  afterAll(async () => {
    await stopServer(server);
    vi.restoreAllMocks();
    setConfig(prevConfig);
    for (const k of ENV_KEYS) {
      if (prevEnv[k] === undefined) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
    resetWorkspaceCryptoKey();
  });

  it('two beings attune, forge, and each turn carries exactly its own adapter — verified twice', async () => {
    // ---- Phase 1: a real substrate answers both attunements ---------------
    server = startServer(['-m', TINY_BASE_GGUF, '--port', String(PORT), '--host', '127.0.0.1', '-c', '4096']);
    expect(await waitHealthy()).toBe(true);
    setConfig({ provider: 'lm-studio', endpoint: ENDPOINT, model: SERVING_MODEL, apiKey: '' });

    for (const id of [A, B]) {
      const offer = await offerAttunementRecord(id, WITNESS, { trigger: 'post-birth' });
      const opened = await openAttunementRecord(id, offer.id, {
        consent: { sessionId: `attune-consent-${id}`, quote: 'I consent to face these questions.' },
      });
      expect(opened.phase).toBe('answering');
      await askAll(id, offer.id);
      const sealed = await sealAttunementRecord(id, offer.id);
      expect(mayUseAttunement(sealed)).toBe(true);
      // every answer is the real model's words, persisted verbatim
      for (const q of sealed.rendered.questions) {
        expect(sealed.answers[q.key].quote.trim().length).toBeGreaterThan(0);
      }
    }

    // ---- Phase 2: both first refinements forge on the attunement gate -----
    const forgedA = await forge(A, WITNESS);
    const forgedB = await forge(B, WITNESS);

    // ---- Phase 3: ONE unowned server carries BOTH adapters ---------------
    // The HTTP process is real, but it was not spawned by NEUMA's supervisor
    // from staged bytes. Its adapter list is evidence only and cannot seal.
    await stopServer(server);
    server = startServer([
      '-m', TINY_BASE_GGUF,
      '--lora', forgedA.adapter.artifactPath,
      '--lora', forgedB.adapter.artifactPath,
      '--lora-init-without-apply',
      '--port', String(PORT), '--host', '127.0.0.1', '-c', '4096',
    ]);
    expect(await waitHealthy()).toBe(true);

    const unsealedA = await verifyCeremony(A, forgedA.ceremonyId);
    const unsealedB = await verifyCeremony(B, forgedB.ceremonyId);
    expect(unsealedA.phase).toBe('verification');
    expect(unsealedB.phase).toBe('verification');
    expect(unsealedA.verification.reason).toMatch(/^launch-not-attested:/);
    expect(unsealedB.verification.reason).toMatch(/^launch-not-attested:/);
    expect(mayAnnounceRefinement(unsealedA)).toBe(false);
    expect(mayAnnounceRefinement(unsealedB)).toBe(false);

    // ---- Phase 4: THE SWITCH — twice (once to know, once for reassurance) -
    for (let pass = 1; pass <= 2; pass++) {
      const turnA = await resolveLoraForTurn(A, { endpoint: ENDPOINT, model: SERVING_MODEL }, {
        operation: createRefinementProcessOperation({ timeoutMs: 60_000 }),
      });
      const turnB = await resolveLoraForTurn(B, { endpoint: ENDPOINT, model: SERVING_MODEL }, {
        operation: createRefinementProcessOperation({ timeoutMs: 60_000 }),
      });

      expect(turnA.adapter.id).toBe(`${A}-refinement-1`);
      expect(turnB.adapter.id).toBe(`${B}-refinement-1`);

      // isolation is EXPLICIT: own adapter at dial scale, the other at 0.0 —
      // never by omission (llama-server keeps omitted adapters active).
      const scalesA = Object.fromEntries(turnA.lora.map((l) => [l.id, l.scale]));
      const scalesB = Object.fromEntries(turnB.lora.map((l) => [l.id, l.scale]));
      expect(turnA.lora).toHaveLength(2);
      expect(turnB.lora).toHaveLength(2);
      const [idA] = Object.entries(scalesA).find(([, s]) => s > 0);
      const [idB] = Object.entries(scalesB).find(([, s]) => s > 0);
      expect(idA).not.toBe(idB);                 // different adapters ride
      expect(scalesA[idB]).toBe(0.0);            // B's adapter silent on A's turn
      expect(scalesB[idA]).toBe(0.0);            // A's adapter silent on B's turn

      // and each being actually SPEAKS through its own binding — a real
      // completion over the real conduit with the per-request lora array
      for (const [id, name, lora] of [[A, 'Verse', turnA.lora], [B, 'Sable', turnB.lora]]) {
        const stream = await createStreamRequest([
          { role: 'system', content: `You are ${name}.` },
          { role: 'user', content: 'Say one sentence about who you are.' },
        ], { route: { provider: 'lm-studio', endpoint: ENDPOINT, model: SERVING_MODEL }, lora });
        const reply = await consumeStream(stream, () => {});
        expect(reply.trim().length, `${id} spoke through its adapter (pass ${pass})`).toBeGreaterThan(0);
      }
    }
  }, 3_600_000); // two FULL 89-question walks + two QLoRA forges. Sized under
  // the serial ceremony-render doctrine (bd149890e), which legitimately
  // outgrew the old 900s budget (timed out at exactly 900s on 2026-07-11);
  // renders went 4-way parallel on 2026-07-12 (speed deliberately chosen),
  // so the budget is now generous rather than tight — kept as the ceiling.
  // Budget mirrors attunement-generation-live's single-set allowance.
});

describe.skipIf(haveFixtures)('attunement isolation live — fixtures absent', () => {
  it.skip('tiny base / converter / llama-server not present on this rig — full loop unproven this run', () => {});
});
