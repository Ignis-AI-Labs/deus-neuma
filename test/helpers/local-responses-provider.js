/**
 * A REAL local server speaking OpenAI's RESPONSES wire protocol (#409 cause B
 * work, extracted from api-witness-routes.test.js which sat at its size cap).
 *
 * Not a mock of the provider: a real HTTP server the real provider client
 * really connects to, so request framing, the SSE envelope, the native
 * function_call item stream and the client's own parse all run. Sibling of
 * local-provider.js, which does the same for the chat-completions dialect.
 *
 * The script drives the TOOL HUD loop (tool-hud.js, 2026-10-14): the first
 * turn searches (`system__tool_search` for the coding hand's contract), the
 * turn after it calls that hand THROUGH THE DOOR (`system__call` naming
 * `coding/inspect`), and the turn after that answers in words — the sequence
 * a model on the two doors is taught to take.
 *
 * @returns {Promise<{port: number, bodies: object[], close: () => Promise<void>}>}
 *   `bodies` is the live array of request bodies the client actually sent.
 */
import http from 'http';
import { isThinkProbe, respondThinkProbe } from './think-probe.js';

// One native function_call exchange on the Responses SSE wire.
const writeFunctionCall = (res, { id, callId, name, args }) => {
  res.write(`data: ${JSON.stringify({
    type: 'response.output_item.added', output_index: 0,
    item: {
      id, call_id: callId, type: 'function_call',
      name, arguments: '', status: 'in_progress',
    },
  })}\n\n`);
  res.write(`data: ${JSON.stringify({
    type: 'response.function_call_arguments.delta', item_id: id,
    output_index: 0, delta: args,
  })}\n\n`);
  res.end(`data: ${JSON.stringify({
    type: 'response.completed',
    response: {
      id: `resp_${id}`, status: 'completed',
      output: [{ type: 'function_call', call_id: callId, name, arguments: args }],
      usage: { input_tokens: 30, output_tokens: 8 },
    },
  })}\n\n`);
};

const writeFinalAnswer = (res, text) => {
  res.write(`data: ${JSON.stringify({
    type: 'response.output_text.delta',
    delta: text,
  })}\n\n`);
  res.end(`data: ${JSON.stringify({
    type: 'response.completed',
    response: {
      id: 'resp_portal_final', status: 'completed', output: [{ type: 'message' }],
      usage: { input_tokens: 46, output_tokens: 7 },
    },
  })}\n\n`);
};

export const startResponsesProvider = () => new Promise((resolve) => {
  const capturedBodies = [];
  const provider = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.endsWith('/responses')) {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        if (isThinkProbe(body)) { respondThinkProbe(res); return; }
        capturedBodies.push(body);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (capturedBodies.length === 1) {
          // Round 0: the wire is the two doors, so the model SEARCHES for the
          // contract of the hand the work needs.
          writeFunctionCall(res, {
            id: 'fc_search', callId: 'call_search',
            name: 'system__tool_search', args: '{"query":"coding/inspect"}',
          });
          return;
        }
        if (capturedBodies.length === 2) {
          // The contract rode the previous tool result; the model calls the
          // hand through the door — the wire never changed.
          writeFunctionCall(res, {
            id: 'fc_portal', callId: 'call_portal',
            name: 'system__call', args: '{"tool":"coding/inspect","args":{"command":"pwd; ls"}}',
          });
          return;
        }
        writeFinalAnswer(res, 'Native inspection completed from the disposable workspace.');
      });
    } else {
      res.writeHead(404); res.end();
    }
  });
  provider.listen(0, '127.0.0.1', () => resolve({
    port: provider.address().port,
    bodies: capturedBodies,
    close: () => new Promise((done) => provider.close(done)),
  }));
});
