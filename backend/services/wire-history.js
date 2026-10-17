/**
 * WIRE HISTORY — OpenAI-shaped conversation history → each wire's native
 * shape. Pure throughout; extracted from llm-provider.js under the size law
 * (the provider stood past its frozen baseline).
 *
 * A turn's history is composed once, in OpenAI chat shape: content parts for
 * images, `tool_calls` on assistant turns, `role:'tool'` + `tool_call_id`
 * results (#283 — the on-contract native exchange both seats now produce).
 * OpenAI-compatible providers (lm-studio, openai, xai, custom) take all of
 * that natively; Anthropic, Ollama, and the Responses API each speak their
 * own dialect, so the one choke point every provider body flows through
 * converts here.
 */

const DATA_URI_PARTS = /^data:(image\/[a-z+.-]+);base64,(.*)$/s;

/**
 * OpenAI content parts → Anthropic content blocks. Strings pass through.
 * @param {string|Array} content
 */
export const toAnthropicContent = (content) => {
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (part?.type === 'image_url') {
      const m = DATA_URI_PARTS.exec(part.image_url?.url || '');
      // A non-data URL can't be inlined — surface it as text rather than
      // silently dropping what the witness attached.
      if (!m) return { type: 'text', text: '[attached image could not be converted]' };
      return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
    }
    return { type: 'text', text: part?.text ?? '' };
  });
};

/**
 * OpenAI-shaped history → Anthropic Messages turns (#259). Three shapes
 * convert: an assistant turn's `tool_calls` become `tool_use` content blocks
 * (input parsed from the JSON-string arguments; a parse failure yields {} so
 * the turn survives), a `role:'tool'` result becomes a `tool_result` block on
 * a user turn, and consecutive same-role turns fold into one — the Messages
 * API refuses non-alternating roles, and every result of a round belongs to
 * the single user turn that answers the assistant's calls.
 */
export const toAnthropicMessages = (messages) => {
  const asBlocks = (content) => (Array.isArray(content)
    ? content
    : [{ type: 'text', text: String(content ?? '') }]);
  const push = (out, role, content) => {
    const prev = out[out.length - 1];
    if (prev?.role !== role) { out.push({ role, content }); return; }
    prev.content = [...asBlocks(prev.content), ...asBlocks(content)];
  };
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      push(out, 'user', [{
        type: 'tool_result',
        tool_use_id: m.tool_call_id || '',
        content: textContentOf(m.content),
      }]);
      continue;
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const text = textContentOf(m.content);
      push(out, 'assistant', [
        ...(text ? [{ type: 'text', text }] : []),
        ...m.tool_calls.map((call) => {
          let input = {};
          if (call.function?.arguments) {
            try { input = JSON.parse(call.function.arguments); } catch { input = {}; }
          }
          return {
            type: 'tool_use',
            id: call.id || '',
            name: call.function?.name || '',
            input,
          };
        }),
      ]);
      continue;
    }
    push(out, m.role, toAnthropicContent(m.content));
  }
  return out;
};

/**
 * OpenAI message → Ollama message shape.
 *
 * Two conversions, one choke point:
 * - An assistant turn's native `tool_calls` (#283): Ollama's /api/chat
 *   unmarshals `function.arguments` as an OBJECT (a Go map), not the OpenAI
 *   JSON string — parse it across; a parse failure yields {} so the turn
 *   survives. `role:'tool'` results pass through untouched: Ollama reads
 *   `content` and ignores unknown fields like `tool_call_id`.
 * - Content parts flatten to { content, images: [rawB64] }.
 * Messages with neither pass through untouched.
 * @param {{ role: string, content: string|Array, tool_calls?: Array }} message
 */
export const toOllamaMessage = (message) => {
  if (message?.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return {
      ...message,
      content: typeof message.content === 'string' ? message.content : textContentOf(message.content),
      tool_calls: message.tool_calls.map((call) => {
        let args = call.function?.arguments;
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        return { ...call, function: { ...call.function, arguments: args || {} } };
      }),
    };
  }
  if (!Array.isArray(message?.content)) return message;
  const text = message.content
    .filter((p) => p?.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');
  const images = message.content
    .filter((p) => p?.type === 'image_url')
    .map((p) => DATA_URI_PARTS.exec(p.image_url?.url || '')?.[2])
    .filter(Boolean);
  return { ...message, content: text, ...(images.length ? { images } : {}) };
};

/** Text of a string-or-parts content field. Pure. */
export const textContentOf = (content) => (typeof content === 'string'
  ? content
  : (content || []).filter((part) => part?.type === 'text').map((part) => part.text || '').join('\n'));

const toResponsesMessage = (message) => {
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  const textType = role === 'assistant' ? 'output_text' : 'input_text';
  const content = Array.isArray(message.content)
    ? message.content.map((part) => part?.type === 'image_url'
      ? { type: 'input_image', image_url: part.image_url?.url || '' }
      : { type: textType, text: part?.text || '' })
    : [{ type: textType, text: String(message.content || '') }];
  return { type: 'message', role, content };
};

const responsesFunctionCall = (toolCall) => ({
  type: 'function_call',
  call_id: String(toolCall?.id || ''),
  name: String(toolCall?.function?.name || ''),
  arguments: typeof toolCall?.function?.arguments === 'string'
    ? toolCall.function.arguments
    : JSON.stringify(toolCall?.function?.arguments || {}),
});

/**
 * Convert OpenAI chat messages into Responses API input items, preserving
 * native function call/output pairing across model rounds.
 * @param {Array<{role:string,content?:string|Array,tool_calls?:Array,tool_call_id?:string}>} messages
 * @returns {Array<object>} Responses input items excluding system instructions.
 */
export const toResponsesInput = (messages) => (messages || []).flatMap((message) => {
  if (!message || message.role === 'system') return [];
  if (message.role === 'tool') {
    return [{
      type: 'function_call_output',
      call_id: String(message.tool_call_id || ''),
      output: textContentOf(message.content),
    }];
  }
  const toolCalls = message.role === 'assistant' && Array.isArray(message.tool_calls)
    ? message.tool_calls.map(responsesFunctionCall)
    : [];
  const hasContent = Array.isArray(message.content)
    ? message.content.length > 0
    : message.content !== null && message.content !== undefined && message.content !== '';
  return [...(hasContent || toolCalls.length === 0 ? [toResponsesMessage(message)] : []), ...toolCalls];
});
