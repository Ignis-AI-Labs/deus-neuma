/** Real authenticated upload and redemption; pure production request builders. No model invoked. */
import { afterAll, beforeAll, expect, test } from 'vitest';
import express from 'express';
import attachmentRouter from '../../backend/routes/attachment-routes.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { redeemAttachments, composeVisionTurn } from '../../backend/services/portal-turn-input.js';
import { buildStreamBody } from '../../backend/services/llm-request-builders.js';
import { solidPngDataUri } from '../helpers/image-fixtures.js';

const images = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]]
  .map((rgb, i) => solidPngDataUri(rgb, 320 + i, 240 + i));
let server, base, auth;
beforeAll(async () => {
  auth = await fullAuth();
  const app = express();
  app.use('/api/v1/attachments', attachmentRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1/attachments`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

for (const count of [2, 4]) test(`${count} distinct images retain bytes, dimensions and order on every wire`, async () => {
  const originals = images.slice(0, count);
  const response = await fetch(base, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ images: originals }),
  });
  expect(response.status).toBe(200);
  const { ids } = await response.json();
  expect(ids).toHaveLength(count);
  const redeemed = redeemAttachments({ walletAddress: auth.address }, ids);
  expect(redeemed.ok).toBe(true);
  expect(redeemed.images).toEqual(originals);
  const messages = [{ role: 'user', content: composeVisionTurn('Read every image in order.', redeemed.images) }];
  for (const provider of ['lm-studio', 'llama-server', 'openai', 'anthropic', 'ollama', 'openai-chatgpt']) {
    const wire = JSON.parse(JSON.stringify(buildStreamBody({ provider, model: 'test', endpoint: 'http://localhost:1' }, messages, {})));
    let carried;
    if (provider === 'ollama') carried = wire.messages[0].images.map((b64) => `data:image/png;base64,${b64}`);
    else if (provider === 'anthropic') carried = wire.messages[0].content.filter((p) => p.type === 'image').map((p) => `data:${p.source.media_type};base64,${p.source.data}`);
    else if (provider === 'openai-chatgpt') carried = wire.input[0].content.filter((p) => p.type === 'input_image').map((p) => p.image_url);
    else carried = wire.messages[0].content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url);
    expect(carried, provider).toEqual(originals);
  }
});
