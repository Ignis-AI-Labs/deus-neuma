/**
 * A real JSON-RPC endpoint in front of a real node (anvil), told to fail on
 * demand. Every request goes over HTTP to a real listener; in `forward` mode
 * the body is relayed to the node untouched and its answer relayed back.
 * The failure modes are the ones a hosted RPC really produces:
 *   'http-500'  → HTTP 500 with a text body (an overloaded gateway)
 *   'rpc-error' → HTTP 200, a JSON-RPC error -32005 per request (a limit hit)
 *   'refuse'    → the listener closes and open sockets drop: connection refused
 * Sibling of rpc-stub.js (hostile answers with no node behind them).
 *
 * impure — a listening socket and outbound HTTP to the node.
 */
import { createServer } from 'node:http';
import { once } from 'node:events';

const rpcError = (item) => ({ jsonrpc: '2.0', id: item?.id ?? null, error: { code: -32005, message: 'request limit exceeded' } });

/**
 * @param {string} upstream - the real node's URL
 * @returns {Promise<{ url: string, requests: number, setMode: (mode: string) => Promise<void>, close: () => Promise<void> }>}
 */
export const startRpcFaultProxy = async (upstream) => {
  let mode = 'forward';
  let requests = 0;
  const sockets = new Set();
  const server = createServer((req, res) => {
    requests += 1;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (mode === 'http-500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('upstream exploded');
        return;
      }
      if (mode === 'rpc-error') {
        const parsed = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(rpcError) : rpcError(parsed)));
        return;
      }
      try {
        const answer = await fetch(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        res.writeHead(answer.status, { 'Content-Type': 'application/json' });
        res.end(await answer.text());
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`node unreachable: ${error.message}`);
      }
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const stopListening = async () => {
    if (!server.listening) return;
    const closed = new Promise((resolve) => server.close(resolve));
    for (const socket of sockets) socket.destroy();
    await closed;
  };

  return {
    url: `http://127.0.0.1:${port}`,
    get requests() { return requests; },
    setMode: async (next) => {
      mode = next;
      if (next === 'refuse') { await stopListening(); return; }
      if (!server.listening) {
        server.listen(port, '127.0.0.1');
        await once(server, 'listening');
      }
    },
    close: stopListening,
  };
};
