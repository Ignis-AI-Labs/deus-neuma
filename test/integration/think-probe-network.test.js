// Actual network refusal and no-network hosted behavior; not inference proof.
import http from 'node:http';
import { channel } from 'node:diagnostics_channel';
import { once } from 'node:events';
import { test, expect } from 'vitest';
import { getThinkBehavior } from '../../backend/services/llm-provider.js';

const listener = async () => {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
};
const close = (server) => new Promise((resolve) => server.close(resolve));

test('closed real listener produces no-think fallback without throwing', async () => {
  const server = await listener();
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  await close(server);
  const route = { provider: 'lm-studio', endpoint, model: 'offline-proof' };
  const errors = [];
  const diagnostics = channel('undici:request:error');
  const observe = ({ request, error }) => {
    if (String(request.origin) === endpoint) errors.push(error.code);
  };
  diagnostics.subscribe(observe);
  try {
    expect(await getThinkBehavior(route)).toEqual({ thinks: false, implicitOpen: false });
    expect(await getThinkBehavior(route)).toEqual({ thinks: false, implicitOpen: false });
    // Actual transport diagnostics also prove failure was retried rather than cached.
    expect(errors).toEqual(['ECONNREFUSED', 'ECONNREFUSED']);
  } finally { diagnostics.unsubscribe(observe); }

});

test('hosted provider bypasses probing without connecting to the configured listener', async () => {
  const server = await listener();
  let connections = 0;
  server.on('connection', () => { connections++; });
  try {
    const route = { provider: 'anthropic', endpoint: `http://127.0.0.1:${server.address().port}`,
      model: 'hosted-skip-proof' };
    expect(await getThinkBehavior(route)).toEqual({ thinks: false, implicitOpen: false });
    expect(connections).toBe(0);
  } finally { await close(server); }
});
