/**
 * The think-behavior probe, for stub provider servers.
 *
 * `llm-provider.js` classifies a model's reasoning shape ONCE per
 * endpoint+model before the first stream (`probeThinkBehavior`) — a filter
 * cannot un-send reasoning it only recognises after the fact. The probe is a
 * NON-streaming completion carrying exactly one user message.
 *
 * Witness turns began probing their OWN route (`getThinkBehavior(route)`)
 * rather than the machine default, which is what WR-I03 requires — a witness
 * speaks only through its own configured provider. So a witness turn against a
 * stub endpoint now sees the probe land on that stub first.
 *
 * A stub that ignores it answers the probe with an SSE stream (the probe wants
 * JSON) and, worse, counts it as a turn request — shifting every captured-body
 * index. Because the result is CACHED per endpoint+model, it lands only on
 * whichever test hits that endpoint first, so index arithmetic is not a stable
 * fix. Answer it and leave it out of the turn record instead.
 */

/** Is this request body the think-behavior probe rather than a real turn? (pure) */
export const isThinkProbe = (body) => body?.stream === false
  && Array.isArray(body?.messages)
  && body.messages.length === 1
  && body.messages[0]?.role === 'user'
  && String(body.messages[0]?.content || '').includes('Reply with only the word: ready');

/**
 * Answer the probe the way a real OpenAI-compatible server does: a plain JSON
 * completion. A bare "ready" (no reasoning markers) classifies as non-thinking,
 * which is what these stubs represent.
 * impure — writes the response.
 */
export const respondThinkProbe = (res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ready' } }] }));
};
