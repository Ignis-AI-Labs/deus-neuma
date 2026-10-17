import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { startLocalProvider } from '../helpers/local-provider.js';
import { strangerWitness } from '../helpers/witness.js';
import router from '../../backend/routes/llm-routes.js';

/**
 * SSRF protection on /api/v1/llm/test — nothing mocked (#390 tranche 6).
 *
 * Every refusal below happens BEFORE any network call, so the three mocks
 * this file used to carry (LMStudioClient, llm-provider, substrate-detector)
 * could not have affected a single blocked case — they were pure ceremony on
 * the security half.
 *
 * On the allowed half they were actively misleading: a stubbed client that
 * returns `true` means "allowed" was never distinguished from […]. A real loopback provider now supplies the allowed
 * localhost/127.0.0.1 cases, so passing the filter is proven by a real
 * connection rather than by a stub agreeing.
 */
describe('LLM SSRF protection', () => {
  let app, witness, provider;

  beforeAll(async () => {
    // A REAL local provider, so the allowed cases really connect.
    provider = await startLocalProvider({ models: ['test-model'] });
    // This route carries no neuma lane — a real session that claims no
    // workspace is exactly the right shape.
    witness = strangerWitness();

    app = express();
    app.use(express.json());
    app.use('/api/v1', router);
  });

  afterAll(async () => { await provider.close(); });

  // --- Allowed endpoints ---

  describe('allows known LLM providers', () => {
    test('allows localhost — and the call really lands', async () => {
      const res = await request(app)
        .post('/api/v1/llm/test')
        .set(witness.header)
        .send({ provider: 'lm-studio', endpoint: `http://localhost:${provider.port}` });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Passing the filter is proven by a real connection, not by a stub.
      expect(provider.hits.length).toBeGreaterThan(0);
    });

    test('allows 127.0.0.1', async () => {
      const res = await request(app)
        .post('/api/v1/llm/test')
        .set(witness.header)
        .send({ provider: 'ollama', endpoint: `http://127.0.0.1:${provider.port}` });
      expect(res.status).toBe(200);
      // The ollama shape may not match this server; what matters here is that
      // the SSRF filter did not refuse the address.
      expect(res.body).not.toHaveProperty('error', expect.stringMatching(/not allowed/i));
    });

    test('allows api.openai.com', async () => {
      const res = await request(app)
        .post('/api/v1/llm/test')
        .set(witness.header)
        .send({ provider: 'openai', endpoint: 'https://api.openai.com', apiKey: 'sk-test' });
      expect(res.status).toBe(200);
      // OpenAI fetch will fail (no real API) but SSRF filter should not block
      expect(res.body).not.toHaveProperty('error', expect.stringMatching(/not allowed/i));
    });

    test('allows api.anthropic.com', async () => {
      // Anthropic provider skips endpoint validation (key-only check)
      const res = await request(app)
        .post('/api/v1/llm/test')
        .set(witness.header)
        .send({ provider: 'anthropic', apiKey: 'sk-ant-test' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // --- Blocked endpoints (SSRF attempts) ---

  describe('blocks SSRF attempts', () => {
    test('blocks cloud metadata endpoint (169.254.169.254)', async () => {
      const res = await request(app)
        .post('/api/v1/llm/test')
        .set(witness.header)
        .send({ provider: 'custom', endpoint: 'http://169.254.169.254' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not allowed/i);
    });

    test('blocks 10.x.x.x internal range', async () => {
      const res = await request(app)
        .post('/api/v1/llm/test')
        .set(witness.header)
        .send({ provider: 'custom', endpoint: 'http://10.0.0.1:8080' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not allowed/i);
    });

    test('blocks 192.168.x.x internal range', async () => {
      const res = await request(app)
        .post('/api/v1/llm/test')
        .set(witness.header)
        .send({ provider: 'custom', endpoint: 'http://192.168.1.1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not allowed/i);
    });

    test('blocks 172.16-31.x.x internal range', async () => {
      const res = await request(app)
        .post('/api/v1/llm/test')
        .set(witness.header)
        .send({ provider: 'custom', endpoint: 'http://172.16.0.1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not allowed/i);
    });

    test('blocks arbitrary external URLs', async () => {
      const res = await request(app)
        .post('/api/v1/llm/test')
        .set(witness.header)
        .send({ provider: 'custom', endpoint: 'https://evil.com/steal-data' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not allowed/i);
    });

    test('blocks empty endpoint', async () => {
      const res = await request(app)
        .post('/api/v1/llm/test')
        .set(witness.header)
        .send({ provider: 'lm-studio', endpoint: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not allowed/i);
    });

    test('blocks invalid URL', async () => {
      const res = await request(app)
        .post('/api/v1/llm/test')
        .set(witness.header)
        .send({ provider: 'custom', endpoint: 'not-a-url' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not allowed/i);
    });
  });

  // --- Auth requirement ---

  describe('Authentication', () => {
    test('returns 401 without auth token', async () => {
      // Auth is real now — no header against the real router IS the real 401.
      const res = await request(app).post('/api/v1/llm/test').send({ provider: 'lm-studio' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication required');
    });
  });
});
