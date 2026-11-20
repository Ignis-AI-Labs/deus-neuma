/**
 * A dishonest chain node, for the tests that prove one node's word is not
 * enough (RULE 0: a real HTTP JSON-RPC listener in front of a real node).
 * Every request reaches the real node untouched and its answer comes back
 * untouched, except the ones `lie` chooses to answer itself — the way a
 * compromised or hostile RPC endpoint answers: well-formed, and false.
 * Sibling of rpc-fault-proxy.js (a node that fails) and rpc-stub.js.
 *
 * impure — a listening socket and outbound HTTP to the node.
 */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Buffer } from 'node:buffer';
import fetch from 'node-fetch';

/**
 * @param {string} upstream - the real node's URL
 * @param {(request: {method: string, params: Array<unknown>}, honest: () => Promise<unknown>) => unknown} lie
 *   returns the false `result` for a request, or undefined to let the node answer;
 *   `honest()` gives the node's own result, for a lie built on top of it
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export const startLyingRpc = async (upstream, lie) => {
  const ask = async (item) => {
    const answer = await fetch(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
    return answer.json();
  };
  const answerOne = async (item) => {
    const lied = await lie(item, async () => (await ask(item)).result);
    return lied === undefined ? ask(item) : { jsonrpc: '2.0', id: item.id, result: lied };
  };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const out = Array.isArray(parsed) ? await Promise.all(parsed.map(answerOne)) : await answerOne(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`node unreachable: ${error.message}`);
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};
