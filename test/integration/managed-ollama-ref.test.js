/* global AbortSignal */
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyModelRef } from '../../backend/services/managed-ollama-ref.js';
import { ollamaModelPin } from '../../backend/services/managed-ollama-models.js';

const choice = { source: 'empero-ai/Qwen3.8-4B-Distill-GGUF', quant: 'Q4_K_M' };
const pin = ollamaModelPin(choice);
const model = { ref: `hf.co/${choice.source}:${choice.quant}`, ...pin };
let server;
let endpoint;
let response;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url !== '/api/show' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('Ollama model-ref verification over real HTTP', () => {
  it('accepts the reviewed blob digest returned by the server', async () => {
    response = { modelfile: `FROM /models/blobs/sha256-${pin.sha256}\nTEMPLATE real` };
    await expect(verifyModelRef(model, endpoint, AbortSignal.timeout(2000))).resolves.toEqual({ digest: pin.sha256 });
  });

  it('refuses a different, missing, or ambiguous digest', async () => {
    for (const modelfile of [
      `FROM /models/blobs/sha256-${'0'.repeat(64)}`,
      'TEMPLATE no blob',
      `FROM sha256-${pin.sha256}\nFROM /other/sha256-${pin.sha256}`,
    ]) {
      response = { modelfile };
      await expect(verifyModelRef(model, endpoint, AbortSignal.timeout(2000))).rejects.toMatchObject({ code: 'MODEL_PIN_MISMATCH' });
    }
  });
});
