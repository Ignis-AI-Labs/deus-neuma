// The Agent Client Protocol wire — JSON-RPC 2.0, one message per line, over a
// pair of streams (an editor launches `neuma acp` and talks on its stdin and
// stdout). This module knows the framing and the request bookkeeping and
// nothing about Neuma: the handlers are handed in.
//
// The law of the transport (agentclientprotocol.com, transports): every line
// on the output is a protocol message and nothing else; logs belong on stderr.
//
// impure (stream IO).

import readline from 'node:readline';

/** JSON-RPC error codes this wire answers with. */
export const RPC = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
});

/** An error a handler throws to answer with a specific JSON-RPC code. */
export class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Open the wire.
 * impure — reads `input` line by line, writes to `output`.
 * @param {object} opts
 * @param {NodeJS.ReadableStream} opts.input
 * @param {{ write: (text: string) => unknown }} opts.output
 * @param {Record<string, (params: object) => unknown>} opts.handlers - by method name; a
 *   request's handler returns its result, a notification's return is ignored
 * @param {(line: string) => void} [opts.log] - diagnostics, never the output
 * @returns {{ request: (method: string, params: object) => Promise<object>,
 *   notify: (method: string, params: object) => void, closed: Promise<void>,
 *   drain: () => Promise<void> }} `closed`: the input ended; `drain`: every request already
 *   read has been answered (a client that sends and hangs up still gets its answers)
 */
export const openAcpWire = ({ input, output, handlers, log = () => {} }) => {
  const pending = new Map();
  const inFlight = new Set(); // requests from the client still being answered
  let nextId = 1;
  const send = (message) => output.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const answer = (id, result) => send({ id, result: result ?? {} });
  const refuse = (id, code, message) => send({ id, error: { code, message } });

  const onRequest = async ({ id, method, params }) => {
    const handler = Object.hasOwn(handlers, method) ? handlers[method] : null;
    if (!handler) { refuse(id, RPC.METHOD_NOT_FOUND, `${method} is not something this agent does`); return; }
    try {
      answer(id, await handler(params ?? {}));
    } catch (error) {
      refuse(id, Number.isInteger(error?.code) ? error.code : RPC.INTERNAL_ERROR, String(error?.message || error));
    }
  };

  const onLine = (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      refuse(null, RPC.PARSE_ERROR, 'that line is not JSON');
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      refuse(null, RPC.INVALID_REQUEST, 'a message is one JSON object');
      return;
    }
    const isResponse = !('method' in message) && ('result' in message || 'error' in message);
    if (isResponse) {
      const waiting = pending.get(message.id);
      if (!waiting) { log(`acp: a response to nothing asked (id ${message.id})`); return; }
      pending.delete(message.id);
      if (message.error) waiting.reject(new RpcError(message.error.code, message.error.message));
      else waiting.resolve(message.result ?? {});
      return;
    }
    if (typeof message.method !== 'string') {
      if ('id' in message) refuse(message.id, RPC.INVALID_REQUEST, 'a request needs a method');
      return;
    }
    if ('id' in message && message.id !== null) {
      // Requests run side by side: a cancel must reach a running prompt.
      const running = onRequest(message).finally(() => inFlight.delete(running));
      inFlight.add(running);
      return;
    }
    // A notification: no answer, ever — a failure is only logged.
    const handler = Object.hasOwn(handlers, message.method) ? handlers[message.method] : null;
    if (!handler) { log(`acp: notification ${message.method} ignored`); return; }
    Promise.resolve().then(() => handler(message.params ?? {})).catch((error) => log(`acp: ${message.method} failed — ${error.message}`));
  };

  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  reader.on('line', onLine);
  const closed = new Promise((resolve) => {
    reader.on('close', () => {
      // Nobody is left to answer what we asked.
      for (const waiting of pending.values()) waiting.reject(new RpcError(RPC.INTERNAL_ERROR, 'the client went away'));
      pending.clear();
      resolve();
    });
  });

  return {
    closed,
    drain: async () => { while (inFlight.size > 0) await Promise.allSettled([...inFlight]); },
    notify: (method, params) => send({ method, params }),
    request: (method, params) => new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    }),
  };
};
