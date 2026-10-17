/**
 * Provider OAuth — the OpenAI ChatGPT lane (integration, RULE 0): the
 * browser/PKCE sign-in owned by Neuma and the Responses API wire, exercised
 * against a REAL local HTTP server speaking the OAuth + Responses protocol
 * bytes (authorization code exchange, refresh grant, revoke, SSE stream).
 * Endpoint test doors (NEUMA_OAUTH_OPENAI_*) repoint the hardcoded hosts;
 * every module under test runs for real, including the encrypted credential
 * store on a real temp disk. The device flows (GitHub + xAI) and the
 * credential-store union live in provider-oauth-device.test.js.
 */
import http from 'http';
import path from 'path';
import os from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

import {
  startBrowserFlow, pollBrowserFlow, oauthFlowsFor, cancelFlow, revokeProviderOAuth,
} from '../../backend/services/provider-oauth.js';
import { resolveUsableCredential } from '../../backend/services/oauth-token-broker.js';
import {
  loadCredentials, setCredential, maskCredential, computeCredentialState,
} from '../../backend/services/provider-credentials.js';
import { getProvider } from '../../backend/services/provider-registry.js';
import { liveModels } from '../../backend/services/provider-probe.js';
import {
  createStreamRequest, consumeStream, consumeStreamWithTools,
} from '../../backend/services/llm-provider.js';

let tmp;
let saved;
let openai;
let openaiCalls;

const ENV_DOORS = [
  'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_OAUTH_GITHUB_BASE', 'NEUMA_OAUTH_XAI_BASE',
  'NEUMA_OAUTH_OPENAI_BASE', 'NEUMA_OAUTH_OPENAI_REDIRECT_PORT', 'NEUMA_OPENAI_OAUTH_CLIENT_ID',
];

const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const portOf = (server) => server.address().port;
const jwt = (claims) => [
  Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify(claims)).toString('base64url'),
  'signature',
].join('.');
const close = (server) => new Promise((resolve) => server.close(resolve));

beforeEach(async () => {
  saved = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  tmp = mkdtempSync(path.join(os.tmpdir(), 'oauth-test-'));
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(tmp, 'creds.json');

  const callbackProbe = await listen((_req, res) => res.end());
  const callbackPort = portOf(callbackProbe);
  await close(callbackProbe);
  openaiCalls = { token: 0, refresh: 0, revoke: 0, models: 0, responses: 0, bodies: [] };
  openai = await listen((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      openaiCalls.bodies.push({
        url: req.url,
        body: raw,
        contentType: req.headers['content-type'],
        headers: req.headers,
      });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/models?')) {
        openaiCalls.models += 1;
        res.end(JSON.stringify({ models: [
          { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol' },
          { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6 Terra' },
        ] }));
        return;
      }
      if (req.url === '/responses' || req.url === '/v1/responses') {
        openaiCalls.responses += 1;
        const body = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (body.model === 'gpt-incomplete-test') {
          res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'partial answer' })}\n\n`);
          res.end(`data: ${JSON.stringify({
            type: 'response.incomplete',
            response: {
              id: 'resp_incomplete', status: 'incomplete',
              incomplete_details: { reason: 'max_output_tokens' },
              usage: { input_tokens: 9, output_tokens: 4 },
            },
          })}\n\n`);
          return;
        }
        if (body.tools?.length) {
          res.write(`data: ${JSON.stringify({
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              id: 'fc_test', call_id: 'call_test', type: 'function_call',
              name: 'coding__inspect', arguments: '', status: 'in_progress',
            },
          })}\n\n`);
          res.write(`data: ${JSON.stringify({
            type: 'response.function_call_arguments.delta',
            item_id: 'fc_test', output_index: 0, delta: '{"command":',
          })}\n\n`);
          res.write(`data: ${JSON.stringify({
            type: 'response.function_call_arguments.delta',
            item_id: 'fc_test', output_index: 0, delta: '"pwd"}',
          })}\n\n`);
          res.end(`data: ${JSON.stringify({
            type: 'response.completed',
            response: {
              id: 'resp_tool', status: 'completed',
              output: [{ type: 'function_call', call_id: 'call_test', name: 'coding__inspect', arguments: '{"command":"pwd"}' }],
              usage: { input_tokens: 18, output_tokens: 6 },
            },
          })}\n\n`);
          return;
        }
        res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'NEUMA_' })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'DIRECT' })}\n\n`);
        res.end(`data: ${JSON.stringify({
          type: 'response.completed',
          response: {
            id: 'resp_test', status: 'completed', output: [{ type: 'message' }],
            usage: { input_tokens: 12, output_tokens: 2 },
          },
        })}\n\n`);
        return;
      }
      if (req.url === '/oauth/token') {
        const json = req.headers['content-type'] === 'application/json' ? JSON.parse(raw) : null;
        if (json?.grant_type === 'refresh_token') {
          openaiCalls.refresh += 1;
          res.end(JSON.stringify({
            access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 7200 }),
            refresh_token: 'openai-refresh-2',
          }));
          return;
        }
        openaiCalls.token += 1;
        res.end(JSON.stringify({
          id_token: jwt({
            email: 'operator@example.test',
            'https://api.openai.com/auth': { chatgpt_account_id: 'acct_neuma_test' },
          }),
          access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
          refresh_token: 'openai-refresh-1',
        }));
        return;
      }
      if (req.url === '/oauth/revoke') {
        openaiCalls.revoke += 1;
        res.end(JSON.stringify({ success: true }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  process.env.NEUMA_OAUTH_OPENAI_BASE = `http://127.0.0.1:${portOf(openai)}`;
  process.env.NEUMA_OAUTH_OPENAI_REDIRECT_PORT = String(callbackPort);
  process.env.NEUMA_OPENAI_OAUTH_CLIENT_ID = 'neuma-test-client';
});

afterEach(async () => {
  await cancelFlow('openai-chatgpt');
  for (const k of ENV_DOORS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
  await close(openai);
});

describe('OpenAI ChatGPT browser sign-in owned by Neuma (real protocol server)', () => {
  test('Responses API carries native tools and reconstructs streamed function arguments', async () => {
    const endpoint = `http://127.0.0.1:${portOf(openai)}`;
    const stream = await createStreamRequest([
      { role: 'system', content: 'Use the available tool.' },
      { role: 'user', content: 'Inspect the workspace.' },
    ], {
      route: {
        provider: 'openai-chatgpt', endpoint, apiKey: 'openai-test-token',
        accountId: 'acct_neuma_test', model: 'gpt-5.6-sol', chatPath: '/responses',
      },
      tools: [{
        type: 'function',
        function: {
          name: 'coding__inspect',
          description: 'Inspect the disposable workspace',
          parameters: {
            type: 'object', properties: { command: { type: 'string' } }, required: ['command'],
          },
        },
      }],
    });
    let usage = null;
    let finishReason = null;
    const result = await consumeStreamWithTools(stream, () => {}, {
      onUsage: (value) => { usage = value; },
      onFinishReason: (value) => { finishReason = value; },
    });

    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([{
      callId: 'call_test', server: 'coding', toolName: 'inspect', tool: 'coding/inspect',
      args: { command: 'pwd' }, _native: true,
    }]);
    expect(usage).toEqual({ promptTokens: 18, completionTokens: 6 });
    expect(finishReason).toBe('tool_calls');
    const request = JSON.parse(openaiCalls.bodies.find((call) => call.url === '/responses').body);
    expect(request).toMatchObject({
      model: 'gpt-5.6-sol',
      instructions: 'Use the available tool.',
      tool_choice: 'auto',
      parallel_tool_calls: false,
      tools: [{
        type: 'function', name: 'coding__inspect',
        description: 'Inspect the disposable workspace', strict: false,
      }],
    });
    expect(request.tools[0].parameters).toEqual({
      type: 'object', properties: { command: { type: 'string' } }, required: ['command'],
    });
  });

  test('Responses max-output incompletion preserves partial text and reports length', async () => {
    const endpoint = `http://127.0.0.1:${portOf(openai)}`;
    const stream = await createStreamRequest([
      { role: 'user', content: 'Return more than the output budget.' },
    ], {
      route: {
        provider: 'openai-chatgpt', endpoint, apiKey: 'openai-test-token',
        accountId: 'acct_neuma_test', model: 'gpt-incomplete-test',
      },
    });
    let usage = null;
    let finishReason = null;
    const answer = await consumeStream(stream, () => {}, {
      onUsage: (value) => { usage = value; },
      onFinishReason: (value) => { finishReason = value; },
    });
    expect(answer).toBe('partial answer');
    expect(finishReason).toBe('length');
    expect(usage).toEqual({ promptTokens: 9, completionTokens: 4 });
    expect(openaiCalls.bodies.some((call) => call.url === '/v1/responses')).toBe(true);
  });

  test('PKCE callback stores encrypted account-bound tokens and the broker refreshes them', async () => {
    expect(oauthFlowsFor('openai-chatgpt')).toEqual(['browser']);
    const flow = await startBrowserFlow('openai-chatgpt');
    const authorize = new URL(flow.verificationUrl);
    expect(authorize.searchParams.get('client_id')).toBe('neuma-test-client');
    expect(authorize.searchParams.get('originator')).toBe('neuma');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');

    const callback = new URL(authorize.searchParams.get('redirect_uri'));
    callback.searchParams.set('code', 'neuma-auth-code');
    callback.searchParams.set('state', authorize.searchParams.get('state'));
    const response = await fetch(callback);
    expect(response.status).toBe(200);

    let outcome = await pollBrowserFlow('openai-chatgpt');
    for (let i = 0; outcome.status === 'pending' && i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      outcome = await pollBrowserFlow('openai-chatgpt');
    }
    expect(outcome).toEqual({ status: 'complete', account: 'operator@example.test' });
    expect(openaiCalls.token).toBe(1);
    const exchange = new URLSearchParams(openaiCalls.bodies[0].body);
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('code')).toBe('neuma-auth-code');
    expect(exchange.get('code_verifier')).toBeTruthy();

    const stored = (await loadCredentials())['openai-chatgpt'];
    expect(stored).toMatchObject({
      type: 'oauth',
      refresh: 'openai-refresh-1',
      account: 'operator@example.test',
      accountId: 'acct_neuma_test',
    });
    expect(JSON.stringify(await maskCredential(
      getProvider('openai-chatgpt'),
      computeCredentialState(getProvider('openai-chatgpt'), stored),
      stored,
    ))).not.toContain('acct_neuma_test');

    await setCredential('openai-chatgpt', { ...stored, expiresAt: Date.now() - 1 });
    const credential = await resolveUsableCredential('openai-chatgpt');
    expect(credential.accountId).toBe('acct_neuma_test');
    expect(openaiCalls.refresh).toBe(1);
    expect(openaiCalls.bodies.find((call) => call.contentType === 'application/json').body)
      .toContain('openai-refresh-1');

    const entry = getProvider('openai-chatgpt');
    const endpoint = `http://127.0.0.1:${portOf(openai)}`;
    const models = await liveModels(entry, endpoint, credential.apiKey, { accountId: credential.accountId });
    expect(models.map((model) => model.id)).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra']);

    const chunks = [];
    let usage = null;
    const stream = await createStreamRequest([
      { role: 'system', content: 'Answer exactly.' },
      { role: 'user', content: 'Say NEUMA_DIRECT' },
    ], {
      route: {
        provider: 'openai-chatgpt', endpoint, apiKey: credential.apiKey,
        accountId: credential.accountId, model: 'gpt-5.6-sol', chatPath: '/responses',
      },
    });
    const answer = await consumeStream(stream, (chunk) => chunks.push(chunk), {
      onUsage: (value) => { usage = value; },
    });
    expect(answer).toBe('NEUMA_DIRECT');
    expect(chunks.join('')).toBe('NEUMA_DIRECT');
    expect(usage).toEqual({ promptTokens: 12, completionTokens: 2 });
    const responseCall = openaiCalls.bodies.find((call) => call.url === '/responses');
    expect(responseCall).toMatchObject({
      contentType: 'application/json',
    });
    expect(responseCall.headers.authorization).toBe(`Bearer ${credential.apiKey}`);
    expect(responseCall.headers['chatgpt-account-id']).toBe('acct_neuma_test');
    expect(responseCall.headers.originator).toBe('neuma');
    expect(responseCall.headers.version).toBeTruthy();
    expect(responseCall.headers['user-agent']).toContain('neuma/0.1');
    expect(JSON.parse(responseCall.body)).toMatchObject({
      model: 'gpt-5.6-sol',
      instructions: 'Answer exactly.',
      store: false,
      stream: true,
    });

    await revokeProviderOAuth('openai-chatgpt');
    expect(openaiCalls.revoke).toBe(1);
  });
});
