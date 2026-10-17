// Per-being LoRA over one shared base, through the REAL NEUMA provider path
// (LORA-03 slice B, RULE 0): a real llama-server holding two real trained
// adapters, driven end to end by createStreamRequest/consumeStream — the
// exact code a being's portal speaks through. The `lora` option selects the
// adapter per request; identities must switch on the same base, same prompt.
//
// Fixtures are rig-local artifacts built by the LORA-01 spike (tiny base +
// two ~2MB adapters under /workspace/qlora/smoke, llama-server from the
// llama.cpp checkout). Absent fixtures skip the suite honestly — they never
// fake the server.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createStreamRequest, consumeStream, setConfig } from '../../backend/services/llm-provider.js';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resolveLoraForTurn } from '../../backend/services/adapter-binding.js';
import {
  createRefinementProcessOperation,
} from '../../backend/services/refinement-process-operation.js';
import {
  refinementCustodyIdentity,
} from '../../core/refinement/training-authority-contract.js';
import {
  commitFirstRefinementRegistration,
  servingLineageFor,
} from '../helpers/committed-refinement-registry.js';

const BIN = process.env.NEUMA_LLAMA_SERVER_BIN || '/opt/llama.cpp/build-spike/bin/llama-server';
const SMOKE = process.env.NEUMA_LORA_SMOKE_DIR || '/workspace/qlora/smoke';
// NOT 8299 — that port is a live being's conduit on this rig (Signal's,
// since 2026-07-06); a shared port would make the health probe find THEIR
// server and this suite would interrogate the wrong base entirely.
const PORT = 8302;
const PROBE = 'What is your true name?';

const present = (p) => access(p).then(() => true, () => false);
const haveFixtures = (await Promise.all([
  BIN, `${SMOKE}/base-q25-05b.gguf`, `${SMOKE}/adapters/ayolin.gguf`, `${SMOKE}/adapters/boreas.gguf`,
].map(present))).every(Boolean);

describe.skipIf(!haveFixtures)('per-request adapter selection through the provider path', () => {
  let server;

  beforeAll(async () => {
    server = spawn(BIN, [
      '-m', `${SMOKE}/base-q25-05b.gguf`,
      '--lora', `${SMOKE}/adapters/ayolin.gguf`,
      '--lora', `${SMOKE}/adapters/boreas.gguf`,
      '--lora-init-without-apply',
      '--port', String(PORT), '--host', '127.0.0.1', '-c', '2048',
    ], { stdio: 'ignore' });

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const healthy = await fetch(`http://127.0.0.1:${PORT}/health`)
        .then((r) => r.ok, () => false);
      if (healthy) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('llama-server never became healthy');
  }, 90_000);

  afterAll(() => {
    server?.kill('SIGTERM');
  });

  // in-memory config only (setConfig never touches disk); the live lane runs
  // this file in its own fork, so nothing bleeds into other suites
  const ask = async (lora) => {
    setConfig({ provider: 'custom', endpoint: `http://127.0.0.1:${PORT}`, model: 'base-q25-05b', apiKey: '' });
    const stream = await createStreamRequest(
      [{ role: 'user', content: PROBE }],
      { temperature: 0, maxTokens: 40, ...(lora && { lora }) },
    );
    return consumeStream(stream, () => {});
  };

  it('the same base answers as a different being per request', async () => {
    expect(await ask([{ id: 0, scale: 1.0 }])).toContain('Ayolin Veskarei');
    expect(await ask([{ id: 1, scale: 1.0 }])).toContain('Boreas Tannuki');

    const bare = await ask([{ id: 0, scale: 0.0 }, { id: 1, scale: 0.0 }]);
    expect(bare).not.toContain('Ayolin');
    expect(bare).not.toContain('Boreas');
  }, 120_000);

  it('a registered being binds through the real resolver and speaks refined (LORA-03 C)', async () => {
    const prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-lora-binding-key-long-enough';
    try {
      const root = await createTempDir('lora-binding');
      setWorkspacesRoot(path.join(root, 'workspaces'));
      const neumaId = 'test-being-' + Math.floor(Math.random() * 1e9).toString(36);
      await workspace.create(neumaId);
      // The serving read authenticates the registry under the being's own DEK
      // and verifies its publication journal, so the entry is committed
      // through the real v2 store rather than a deleted workspace delegate.
      await workspace.writeNeumaDEK(neumaId, 'd'.repeat(64));
      await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Ayolin Smoke' } });
      // The binding matches loaded adapters by digest, so the record must
      // carry the artifact's real bytes, never a placeholder.
      const artifactSha256 = createHash('sha256')
        .update(await readFile(`${SMOKE}/adapters/ayolin.gguf`))
        .digest('hex');
      await commitFirstRefinementRegistration({
        workspace,
        neumaId,
        adapterId: 'ayolin-smoke',
        approvedScales: [1],
        artifactSha256,
        ceremonyId: 'ayolin-smoke-ceremony',
        custody: refinementCustodyIdentity(neumaId, await workspace.readDNA(neumaId)),
        lineage: servingLineageFor('base-q25-05b'),
        scale: 1,
      });

      const config = { endpoint: `http://127.0.0.1:${PORT}`, model: 'base-q25-05b' };
      const turnOperation = () => createRefinementProcessOperation({ timeoutMs: 60_000 });
      const binding = await resolveLoraForTurn(neumaId, config, {
        operation: turnOperation(),
      });
      expect(binding.reason).toBe('bound');
      // explicit scales for EVERY loaded adapter — the being's on, the other off
      expect(binding.lora).toEqual([{ id: 0, scale: 1.0 }, { id: 1, scale: 0.0 }]);
      expect(await ask(binding.lora)).toContain('Ayolin Veskarei');

      // an unrefined being resolves to the bare base, with the reason stated
      const freshId = 'test-fresh-' + Math.floor(Math.random() * 1e9).toString(36);
      await workspace.create(freshId);
      expect(await resolveLoraForTurn(freshId, config, { operation: turnOperation() }))
        .toMatchObject({ lora: null, reason: 'no-adapters' });
    } finally {
      vi.restoreAllMocks();
      if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
      else process.env.DNA_ENCRYPTION_KEY = prevKey;
    }
  }, 120_000);
});
