/**
 * substrate_facts — the being's read-only window on the rig's live serving
 * truth (RULE 0): a REAL persisted claim, a REAL lineage sidecar, and a REAL
 * HTTP health server — no mocks. The facts name what the rig ACTUALLY serves
 * (the spawn's claim), never a stale env declaration.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createTempDir } from '../helpers/temp-fs.js';
import { clearClaim, writeClaim } from '../../backend/services/substrate-claim-registry.js';
import { expireServedTruth } from '../../backend/services/served-health-cache.js';
import {
  handleSubstrateFactsTool,
  isSubstrateFactsTool,
  SUBSTRATE_FACTS_TOOL,
} from '../../backend/services/substrate-facts-being-tool.js';

const MODEL_BODY = Buffer.from('a small model-shaped fixture');

describe('substrate_facts — the rig’s live truth for a being', () => {
  let root, modelPath, healthServer, healthPort, saved;

  beforeAll(async () => {
    root = await createTempDir('substrate-facts');
    modelPath = path.join(root, 'qwen3.8-27B-Q8_0.gguf');
    await fs.writeFile(modelPath, MODEL_BODY);
    await fs.writeFile(`${modelPath}.training.json`, JSON.stringify({
      servingModel: 'qwen3.8-27b',
      servingArtifactSha256: createHash('sha256').update(MODEL_BODY).digest('hex'),
    }));

    healthServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok' }));
      }
      res.end('{}');
    });
    await new Promise((resolve) => healthServer.listen(0, '127.0.0.1', resolve));
    healthPort = healthServer.address().port;

    saved = {
      claims: process.env.NEUMA_SUBSTRATE_CLAIM_DIR,
      url: process.env.LLAMA_SERVER_URL,
      model: process.env.LLAMA_SERVER_MODEL,
      substrate: process.env.SUBSTRATE_MODEL,
    };
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(root, 'claims');
    process.env.LLAMA_SERVER_URL = `http://127.0.0.1:${healthPort}`;
    process.env.LLAMA_SERVER_MODEL = modelPath;
    process.env.SUBSTRATE_MODEL = 'qwen3.8-27b';
    writeClaim(process.pid, healthPort, { model: modelPath, servingModel: 'qwen3.8-27b' });
  });

  afterAll(async () => {
    clearClaim();
    const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    restore('NEUMA_SUBSTRATE_CLAIM_DIR', saved.claims);
    restore('LLAMA_SERVER_URL', saved.url);
    restore('LLAMA_SERVER_MODEL', saved.model);
    restore('SUBSTRATE_MODEL', saved.substrate);
    await new Promise((resolve) => healthServer.close(resolve));
    vi.restoreAllMocks();
  });

  test('the facts name the live claim — model, hash, endpoint, window, serving', async () => {
    const result = await handleSubstrateFactsTool(null, { companion: { neumaId: 'facts-reader' } });
    expect(result.status).toBe('ok');
    expect(result.content).toContain('servedModelKey: qwen3.8-27b');
    expect(result.content).toContain(`modelFile: ${modelPath}`);
    expect(result.content).toContain(`servingArtifactSha256: ${createHash('sha256').update(MODEL_BODY).digest('hex')}`);
    expect(result.content).toContain(`endpoint: http://127.0.0.1:${healthPort}`);
    expect(result.content).toContain('serving: true');
    expect(result.content).toContain('contextWindow: 262144');
    expect(result.content).toContain('tools: true');
  });

  test('the tool identity is stable for the dispatch', () => {
    expect(isSubstrateFactsTool({ toolName: 'substrate_facts' })).toBe(true);
    expect(isSubstrateFactsTool({ tool: 'coding/substrate_facts' })).toBe(true);
    expect(isSubstrateFactsTool({ toolName: 'execute' })).toBe(false);
    expect(SUBSTRATE_FACTS_TOOL.inputSchema.additionalProperties).toBe(false);
  });

  test('no claim and no serving process reads as not-serving, honestly', async () => {
    clearClaim();
    // The env's resting declaration still names the model; the probe is dead.
    await new Promise((resolve) => healthServer.close(resolve));
    // The health reading is cached for 1.5s (served-health-cache.js); the
    // first test's live answer is still inside that window. Expire it — the
    // stand-in for "a moment later", not a way around the probe.
    expireServedTruth();
    const result = await handleSubstrateFactsTool(null, { companion: { neumaId: 'facts-reader' } });
    expect(result.content).toContain('serving: false');
    // Re-open the health server so afterAll's close doesn't double-close.
    healthServer = http.createServer((req, res) => res.end('{}'));
    await new Promise((resolve) => healthServer.listen(0, '127.0.0.1', resolve));
  });
});
