// Wire construction only: real Express 404, never a fabricated model answer.
import express from 'express';
import http from 'node:http';
import { once } from 'node:events';
import { test, expect } from 'vitest';
import { getConfig, setConfig, createStreamRequest } from '../../backend/services/llm-provider.js';
import { getRecentIssues } from '../../backend/services/logger.js';

const captureRequest = async (options) => {
  const previous = getConfig();
  const requests = [];
  const app = express();
  app.use(express.json());
  // Observation of actual incoming bytes; no response/transport replacement.
  app.use((req, _res, next) => {
    requests.push({ method: req.method, path: req.path, body: req.body });
    next();
  });
  const server = http.createServer(app);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${server.address().port}`,
      apiKey: '', model: 'wire-construction-only', temperature: 0.8, topP: 0.95, maxTokens: 4096 });
    await expect(createStreamRequest([{ role: 'user', content: 'sampling wire proof' }], options))
      .rejects.toThrow(/LLM provider error \(lm-studio\): 404/);
    return requests;
  } finally {
    setConfig(previous);
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
};

test('sampling overrides reach one real POST even when its observer throws', async () => {
  const observed = [];
  const requests = await captureRequest({ temperature: 0.5, topP: 0.8, maxTokens: 2048,
    onRequest: () => { observed.push('request'); throw new Error('private-request-payload'); },
  });
  expect(requests).toHaveLength(1);
  expect(observed).toEqual(['request']);
  expect(requests[0]).toMatchObject({ method: 'POST', path: '/v1/chat/completions', body: {
    model: 'wire-construction-only', temperature: 0.5, top_p: 0.8, max_tokens: 2048,
    stream: true, messages: [{ role: 'user', content: 'sampling wire proof' }],
  } });
  const issue = getRecentIssues().find(({ context, data }) => context === 'ObserverNotifier' && data?.observer === 'onRequest');
  expect(issue?.data).toEqual({ observer: 'onRequest', errorClass: 'Error', errorMessage: 'observer threw' });
  expect(JSON.stringify(issue)).not.toContain('private-request-payload');
});

test('without temperature/topP overrides, configured sampling reaches the wire', async () => {
  // An explicit token budget keeps this a construction proof, with no model
  // inventory/capability discovery or hosted/default-route lookup.
  const requests = await captureRequest({ maxTokens: 4096 });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ method: 'POST', path: '/v1/chat/completions', body: {
    temperature: 0.8, top_p: 0.95, max_tokens: 4096,
  } });
});
