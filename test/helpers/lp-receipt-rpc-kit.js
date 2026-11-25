import http from 'node:http';
import process from 'node:process';
import fetch from 'node-fetch';

// impure — a second real RPC listener for local execution tests.
export const startLpReceiptRpc = async (upstream) => {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      const answer = await fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
      res.writeHead(answer.status, { 'content-type': 'application/json' }).end(await answer.text());
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const priorUrl = process.env.NEUMA_BASE_RECEIPT_RPC_URL;
  const priorDepth = process.env.NEUMA_BASE_RECEIPT_CONFIRMATIONS;
  process.env.NEUMA_BASE_RECEIPT_RPC_URL = url;
  process.env.NEUMA_BASE_RECEIPT_CONFIRMATIONS = '1';
  return {
    url,
    close: async () => {
      if (priorUrl === undefined) delete process.env.NEUMA_BASE_RECEIPT_RPC_URL;
      else process.env.NEUMA_BASE_RECEIPT_RPC_URL = priorUrl;
      if (priorDepth === undefined) delete process.env.NEUMA_BASE_RECEIPT_CONFIRMATIONS;
      else process.env.NEUMA_BASE_RECEIPT_CONFIRMATIONS = priorDepth;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};
