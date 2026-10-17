/**
 * A REAL OpenAI-compatible server on loopback (#390 tranche 6).
 *
 * This is not a mock of llm-provider. It is a real HTTP server, speaking the
 * real wire protocol, that the real llm-provider really connects to over a
 * real socket — the same category as a testnet or a temp directory: a real
 * dependency configured for testing. Everything under test runs: request
 * construction, headers, the JSON body, SSE framing, chunk assembly,
 * timeouts, error propagation. The only thing it does not do is run weights,
 * and that claim is never made here — a GPU model cannot be lit inside the
 * parallel suite (presence is not consent, see gpu-optin.js), and real
 * generation is proven in the substrate-live lane instead.
 *
 * The distinction that matters: mocking `consumeStream` proves a promise
 * resolved. This proves bytes crossed a socket and came back parsed.
 *
 * The shape is lifted from chat-titler-route.test.js, which proved it works;
 * several suites had each grown their own copy.
 */
import http from 'http';
import { isThinkProbe, respondThinkProbe } from './think-probe.js';

/**
 * Start a real loopback provider.
 *
 * @param {object} [opts]
 * @param {string|string[]} [opts.reply] - what the assistant says; an array is
 *   emitted as several SSE chunks, which is how a real stream arrives.
 * @param {string[]} [opts.models] - ids returned from GET /models
 * @param {string} [opts.finishReason] - the finish_reason on the last chunk.
 *   'length' is the real shape of a token-budget cut, which callers that fail
 *   closed on a truncated turn need to see arrive over the wire.
 * @param {Array<string|string[]|{reply: string|string[], reasoning?: string|string[], toolCalls?: Array<{id?: string, name: string, args?: object}>, usage?: {prompt_tokens: number, completion_tokens: number}, finishReason?: string, status?: number, errorMessage?: string, errorType?: string}>} [opts.script]
 *   successive answers, one per completion request, for suites that need a
 *   sequence (a corrupt turn then a clean one, a ladder of attempts). Once
 *   exhausted the last entry repeats, so a caller never silently falls off
 *   the end onto a different answer than it asked for. An entry's `reasoning`
 *   streams on the vendor reasoning channel (`delta.reasoning_content`) BEFORE
 *   its speech chunks — the shape a thinking model really sends. An entry's
 *   `toolCalls` streams NATIVE function calls after the speech chunks — the
 *   OpenAI wire shape (`delta.tool_calls` fragments assembled by index): id
 *   and the complete function name on the first fragment, the arguments JSON
 *   deliberately SPLIT across two fragments, because argument reassembly is
 *   part of the path under test and a server that sent whole blobs would
 *   never exercise it.
 *   An entry's `delayMs` holds that answer back — a model taking its time;
 *   a caller that hangs up meanwhile is never written to.
 *   An entry's `status` makes the server REFUSE that completion with a real
 *   HTTP error status and an OpenAI-shaped error body ({error: {message,
 *   type}} — `errorMessage` / `errorType`, invalid_request_error by default).
 *   `specialTokens` (piece -> id) is the vocabulary's special tokens, as
 *   POST /tokenize reports them (llama.cpp's shape; parse_special honored).
 *   `serverHeader` sets the `Server` header on every reply, as a real
 *   server sends it (llama.cpp: 'llama.cpp' — the server-budget lever).
 * @returns {Promise<{
 *   server: import('http').Server, port: number, endpoint: string,
 *   hits: any[], turns: any[], close: () => Promise<void>,
 * }>} `hits` records every request (probe answers excluded, see think-probe.js);
 *   `turns` records only the completion bodies.
 */
export const startLocalProvider = ({
  reply = 'A Local Answer', models = ['test-model'], finishReason = 'stop', script = null, serverHeader = null,
  specialTokens = {},
} = {}) =>
  new Promise((resolve) => {
    const hits = [];
    const turns = [];

    // Normalise the script (if any) to {chunks, reasoning, toolCalls, finishReason} entries.
    const normalize = (entry) => (
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? { chunks: entry.reply === undefined ? [] : (Array.isArray(entry.reply) ? entry.reply : [entry.reply]),
          reasoning: entry.reasoning
            ? (Array.isArray(entry.reasoning) ? entry.reasoning : [entry.reasoning])
            : [],
          toolCalls: Array.isArray(entry.toolCalls) ? entry.toolCalls : [],
          finishReason: entry.finishReason || finishReason, usage: entry.usage,
          status: Number.isInteger(entry.status) ? entry.status : null,
          errorMessage: entry.errorMessage || 'the server refused this request',
          errorType: entry.errorType || 'invalid_request_error',
          delayMs: Number.isFinite(entry.delayMs) ? entry.delayMs : 0 }
        : { chunks: Array.isArray(entry) ? entry : [entry], reasoning: [], toolCalls: [], finishReason, delayMs: 0 });
    let scripted = Array.isArray(script) && script.length ? script.map(normalize) : null;
    const answerFor = (index) => (scripted
      ? scripted[Math.min(index, scripted.length - 1)]
      : normalize(reply));
    // Completions being answered right now, and the most at once — the width a
    // caller really drove the server at.
    let inFlight = 0;
    let maxInFlight = 0;
    /** Re-script a running server and clear the turn log — one setup, many cases. */
    const setScript = (entries) => {
      scripted = Array.isArray(entries) && entries.length ? entries.map(normalize) : null;
      turns.length = 0;
      hits.length = 0;
      maxInFlight = inFlight;
    };

    const server = http.createServer((req, res) => {
      // A real llama.cpp names itself on every reply (`Server: llama.cpp`).
      if (serverHeader) res.setHeader('Server', serverHeader);
      if (req.method === 'GET') {
        hits.push({ method: 'GET', url: req.url });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
        return;
      }

      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', async () => {
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { /* malformed stays {} */ }

        hits.push({ method: req.method, url: req.url, body, headers: req.headers });

        // The think-behavior probe is a real request the provider really makes
        // once per endpoint+model. Answering it as JSON — and keeping it out
        // of `turns` — is what a real server does; counting it as a turn would
        // shift every index the caller asserts on.
        if (isThinkProbe(body)) { respondThinkProbe(res); return; }

        // POST /tokenize answers as llama.cpp's does: a special token the
        // vocabulary holds (`specialTokens`, piece -> id) is ONE token when
        // parse_special asks for it; anything else is a token per character.
        if (req.url === '/tokenize') {
          const content = String(body.content ?? '');
          const tokens = body.parse_special && Number.isInteger(specialTokens[content])
            ? [{ id: specialTokens[content], piece: content }]
            : [...content].map((ch) => ({ id: ch.codePointAt(0), piece: ch }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tokens: body.with_pieces ? tokens : tokens.map((t) => t.id) }));
          return;
        }

        // ROUTE BY ENDPOINT, as a real server does. The provider also probes
        // Ollama's /api/show and llama.cpp's /props before a turn; treating
        // every POST as a completion counted those as turns and silently
        // shifted the scripted answers by one (measured — that off-by-one is
        // exactly the kind of thing a hand-rolled stub server gets wrong).
        if (!Array.isArray(body.messages)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ model_info: {}, capabilities: [] }));
          return;
        }

        const answer = answerFor(turns.length);
        turns.push(body);

        // A scripted REFUSAL: the server answers this completion with a real
        // HTTP error status and an OpenAI-shaped error body — the way a real
        // server refuses a request it cannot serve.
        if (answer.status) {
          res.writeHead(answer.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: answer.errorMessage, type: answer.errorType } }));
          return;
        }

        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        res.once('close', () => { inFlight -= 1; });
        // `delayMs`: the model takes its time — a long prefill, a long answer.
        // A caller that hangs up meanwhile is never written to.
        if (answer.delayMs) {
          await new Promise((r) => { setTimeout(r, answer.delayMs); });
          if (res.destroyed || res.writableEnded) return;
        }

        if (body.stream === false) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            choices: [{
              message: {
                role: 'assistant',
                content: answer.chunks.join(''),
                ...(answer.toolCalls.length ? {
                  tool_calls: answer.toolCalls.map((c, i) => ({
                    id: c.id ?? `call_${i}`,
                    type: 'function',
                    function: { name: String(c.name ?? ''), arguments: JSON.stringify(c.args ?? {}) },
                  })),
                } : {}),
              },
              finish_reason: answer.finishReason,
            }],
          }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        // The reasoning channel opens BEFORE the speech, as a thinking model
        // really sends it — its own field, never a content chunk.
        for (const piece of answer.reasoning) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: piece } }] })}\n\n`);
        }
        for (const piece of answer.chunks) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        }
        // Native function calls arrive AFTER the narration, as the OpenAI wire
        // really streams them: id and the COMPLETE function name on the first
        // fragment (the name is never split — mergeToolCallDelta's replace
        // semantics are the contract, and a split name would overwrite itself
        // into its tail), the arguments JSON across several fragments,
        // assembled client-side by index. The arguments are split across TWO
        // fragments on purpose: that reassembly IS part of the path under
        // test, so the fragments must genuinely need it.
        answer.toolCalls.forEach((call, i) => {
          const name = String(call.name ?? '');
          const args = JSON.stringify(call.args ?? {});
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
            index: i, id: call.id ?? `call_${i}`, type: 'function',
            function: { name },
          }] } }] })}\n\n`);
          const argsSplit = Math.max(1, Math.floor(args.length / 2));
          for (const part of [args.slice(0, argsSplit), args.slice(argsSplit)]) {
            if (!part) continue;
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{
              index: i, function: { arguments: part },
            }] } }] })}\n\n`);
          }
        });
        // The finish reason rides its own final chunk, as a real server sends
        // it — callers that fail closed on a cut turn read it from here.
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: answer.finishReason }] })}\n\n`);
        if (answer.usage) res.write(`data: ${JSON.stringify({ choices: [], usage: answer.usage })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        endpoint: `http://127.0.0.1:${port}`,
        hits,
        turns,
        setScript,
        /** The most completions this server answered at once (since the last setScript). */
        maxInFlight: () => maxInFlight,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });

/**
 * A port nothing is listening on — for proving that an unreachable provider
 * is reported as unreachable rather than silently treated as fine. Real
 * refusal from the real network stack; no stub says "false" on its behalf.
 * @returns {Promise<{ endpoint: string, port: number }>}
 */
export const closedProviderEndpoint = () => new Promise((resolve) => {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve({ endpoint: `http://127.0.0.1:${port}`, port }));
  });
});
