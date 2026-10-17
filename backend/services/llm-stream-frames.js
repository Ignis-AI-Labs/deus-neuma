// LLM stream frames — pure per-dialect wire-line parsing and channel census.
//
// Split out of llm-provider.js (SIZE-026). Everything here is pure: a line of
// wire text in, a normalized event (or census) out. The composer
// (llm-provider.js) owns the reader and the stall guard; this module only
// decides what a line MEANS.

import {
  readOllamaStreamUsage,
  readOpenAIStreamUsage,
  readPartialStreamUsage,
  readResponsesStreamUsage,
} from './provider-stream-telemetry.js';

// --- Stream line parsing (pure, per provider) ---
// Unified per-line SSE parser. Returns null (skip), { done: true }
// ([DONE]/parsed.done/message_stop), or { content, toolCalls, usage } (any
// field null). toolCalls = raw delta.tool_calls (OpenAI shape), consumer
// assembles by index; no native tool calling → toolCalls null forever (calls
// ride the text protocol). usage = normalized final-chunk tokens (requested
// via stream_options.include_usage); servers that never emit it yield
// usage: null forever — capability absence, never faked zeros.


/**
 * Ollama's native tool calls → the OpenAI delta vocabulary every consumer in
 * this file already speaks. Measured against Ollama 0.24 on 2026-08-04; three
 * silently destructive differences if passed through raw:
 *   OpenAI (fragments): { index, id, function: { name, arguments: '{"pa' } }
 *   Ollama (complete):  { id, function: { index, name, arguments: {path:…} } }
 *   1. `index` sits INSIDE `function` — read outside it is undefined, every
 *      call in a multi-call turn collapses onto index 0, all but one lost.
 *   2. `arguments` is an OBJECT, not a JSON fragment — mergeToolCallDelta
 *      string-concatenates it to '[object Object]', which fails JSON.parse
 *      into {}: the call SURVIVES with no arguments (a write_file with no
 *      path and no content), worse than dropping it.
 *   3. The call arrives complete in one frame — the stringified arguments
 *      are a whole JSON document on first sight.
 */
export const toOpenAIToolCallDeltas = (calls) => {
  if (!Array.isArray(calls) || calls.length === 0) return null;
  return calls.map((call, i) => ({
    index: call?.index ?? call?.function?.index ?? i,
    id: call?.id ?? null,
    function: {
      name: call?.function?.name ?? '',
      arguments: typeof call?.function?.arguments === 'string'
        ? call.function.arguments
        : JSON.stringify(call?.function?.arguments ?? {}),
    },
  }));
};

/** The SSE terminator, distinguished from […]. */
const DONE_FRAME = Symbol('[DONE]');

/**
 * The JSON payload of one wire line — or null when the line carries none.
 *
 * FRAMING LIVES HERE AND NOWHERE ELSE. Ollama's native /api/chat speaks
 * newline-delimited JSON with no `data:` prefix; everything else speaks SSE,
 * where the space after `data:` is OPTIONAL per spec (Kimi frames bare
 * `data:{...}`, Anthropic frames `data: {...}` — requiring the space read a
 * whole healthy turn as nothing, 2026-07-27). Both the event reader below and
 * the channel census read through this one function so the two can never
 * disagree about what a frame even is.
 */
const _frameJson = (line, wire) => {
  if (wire === 'ollama') {
    if (!line.trim()) return null;
    try { return JSON.parse(line); } catch { return null; }
  }
  if (!line.startsWith('data:')) return null;
  const data = line[5] === ' ' ? line.slice(6) : line.slice(5);
  if (data === '[DONE]') return DONE_FRAME;
  try { return JSON.parse(data); } catch { return null; }
};

/**
 * WHICH WIRE CHANNELS CARRIED BYTES, and how many — the accounting that turns
 * […] into a named field.
 *
 * A stage that comes out empty while the wire reports hundreds of completion
 * tokens means the substrate spoke into a channel nobody read. That has now
 * happened three times on three different fields (`reasoning`,
 * `reasoning_content`, Ollama's `thinking`), and each time it cost a round of
 * guessing against a community member's log because the report named the model
 * and the endpoint but never the CHANNEL. Folded across a stream this answers
 * it outright: {"reasoning": 2042, "content": 0} is a diagnosis, not a mystery.
 *
 * Field names and byte counts only — never the bytes themselves. What a being
 * says in its own ceremony does not belong in a log.
 *
 * @returns {Object|null} field → byte count for this frame, or null if empty
 */
export const frameChannelBytes = (line, wire) => {
  const parsed = _frameJson(line, wire);
  if (parsed === null || parsed === DONE_FRAME) return null;
  const container = wire === 'ollama' ? parsed.message
    : wire === 'anthropic' ? parsed.delta
      : wire === 'openai-responses' ? parsed
        : parsed.choices?.[0]?.delta;
  if (!container || typeof container !== 'object') return null;
  const out = {};
  for (const [field, value] of Object.entries(container)) {
    if (value === null || value === undefined) continue;
    const bytes = typeof value === 'string' ? value.length : JSON.stringify(value).length;
    if (bytes > 0) out[field] = bytes;
  }
  return Object.keys(out).length > 0 ? out : null;
};

/** Fold one frame's census into a running tally. Mutates `tally` (caller owns). */
export const tallyChannelBytes = (tally, frame) => {
  if (!frame) return tally;
  for (const [field, bytes] of Object.entries(frame)) tally[field] = (tally[field] || 0) + bytes;
  return tally;
};

const _readLine = (line, provider) => {
  const framed = _frameJson(line, provider);
  if (framed === null) return null;
  if (framed === DONE_FRAME) return { done: true };
  if (provider === 'ollama') {
    try {
      const parsed = framed;
      // ollama states its finish on the done line ('stop' | 'length')
      if (parsed.done) {
        const usage = readOllamaStreamUsage(parsed);
        return {
          done: true,
          finishReason: parsed.done_reason ?? null,
          ...(usage ? { usage } : {}),
        };
      }
      // This used to read message.content and NOTHING else — `toolCalls: null`
      // was hardcoded and `thinking` was never looked at. On a thinking model
      // that is the whole turn thrown away: measured on Ollama 0.24 with
      // qwen3, a tool-calling turn puts 0 characters in content, 483 in
      // `thinking` and the call itself in `tool_calls`. The ceremony then
      // reported […] — a lie by
      // omission — while the model had reasoned and acted perfectly.
      return {
        content: parsed.message?.content || null,
        reasoning: parsed.message?.thinking || null,
        toolCalls: toOpenAIToolCallDeltas(parsed.message?.tool_calls),
      };
    } catch { return null; }
  }
  // SSE frames — see _frameJson above for the framing itself.
  try {
    const parsed = framed;
    if (provider === 'anthropic') {
      if (parsed.type === 'message_stop') return { done: true };
      if (parsed.type === 'message_start') {
        const usage = readPartialStreamUsage({
          promptTokens: parsed.message?.usage?.input_tokens,
          cachedPromptTokens: parsed.message?.usage?.cache_read_input_tokens,
        });
        return {
          content: null,
          toolCalls: null,
          ...(usage ? { usage } : {}),
        };
      }
      if (parsed.type === 'content_block_start') {
        // A tool call opens as its own content block: the id and name arrive
        // here, the arguments stream as input_json_delta fragments on the same
        // block index. Emitted in the OpenAI delta vocabulary so
        // mergeToolCallDelta / decodeToolCallDeltas serve this wire unchanged
        // (#259 — before this, the frame fell through to null and a being on
        // this dialect could talk but never act).
        if (parsed.content_block?.type === 'tool_use') {
          return {
            content: null,
            toolCalls: [{
              index: parsed.index ?? 0,
              id: parsed.content_block.id || null,
              function: { name: parsed.content_block.name || '', arguments: '' },
            }],
          };
        }
        return null;
      }
      if (parsed.type === 'content_block_delta') {
        // EXTENDED THINKING rides this same event under its own delta type, and
        // it is NOT speech: it must never join the answer. Proven on the wire
        // 2026-07-30 (kimi-for-coding/k3): `"type":"thinking_delta","thinking":…`.
        // Before this it fell through to null and the being's reasoning was
        // received and discarded, byte by byte.
        if (parsed.delta?.type === 'thinking_delta') {
          return { content: null, toolCalls: null, reasoning: parsed.delta.thinking || null };
        }
        // The call's arguments, streamed as JSON fragments (#259). partial_json
        // concatenates across frames exactly like OpenAI's arguments fragments,
        // which is why mergeToolCallDelta needs no changes.
        if (parsed.delta?.type === 'input_json_delta') {
          return {
            content: null,
            toolCalls: [{
              index: parsed.index ?? 0,
              function: { arguments: parsed.delta.partial_json || '' },
            }],
          };
        }
        return { content: parsed.delta?.text || null, toolCalls: null };
      }
      if (parsed.type === 'message_delta') {
        // normalize to the OpenAI vocabulary the callers speak
        const stopReason = parsed.delta?.stop_reason;
        const reason = stopReason === 'max_tokens' ? 'length'
          : stopReason === 'tool_use' ? 'tool_calls'
            : stopReason ?? null;
        const usage = readPartialStreamUsage({
          completionTokens: parsed.usage?.output_tokens,
        });
        return {
          content: null,
          toolCalls: null,
          finishReason: reason,
          ...(usage ? { usage } : {}),
        };
      }
      // Anthropic's mid-stream failure (`{"type":"error","error":{type:
      // overloaded_error,…}}`) used to fall through to null — the stream
      // simply ENDED, and an overload read as an empty answer. It surfaces
      // now, with its type as the code the ladder classifies by.
      if (parsed.type === 'error') {
        return {
          error: parsed.error?.message || parsed.error?.type || 'Anthropic stream error',
          code: parsed.error?.type || null,
        };
      }
      return null;
    }
    if (provider === 'openai-responses') {
      if (parsed.type === 'response.output_text.delta') {
        return { content: parsed.delta || null, toolCalls: null };
      }
      if (parsed.type === 'response.output_item.added' && parsed.item?.type === 'function_call') {
        return {
          content: null,
          toolCalls: [{
            index: parsed.output_index ?? 0,
            id: parsed.item.call_id || parsed.item.id,
            function: { name: parsed.item.name || '', arguments: parsed.item.arguments || '' },
          }],
        };
      }
      if (parsed.type === 'response.function_call_arguments.delta') {
        return {
          content: null,
          toolCalls: [{
            index: parsed.output_index ?? 0,
            id: parsed.item_id,
            function: { arguments: parsed.delta || '' },
          }],
        };
      }
      if (parsed.type === 'response.completed') {
        const response = parsed.response || {};
        const calledTool = Array.isArray(response.output)
          && response.output.some((item) => item?.type === 'function_call');
        return {
          done: true,
          finishReason: calledTool ? 'tool_calls' : 'stop',
          usage: readResponsesStreamUsage(response),
        };
      }
      if (parsed.type === 'response.failed') {
        // The provider's own failure CODE rides along (server_error,
        // rate_limit_exceeded, …) — the retry ladder classifies by it, and a
        // bare message would read as unretryable (the 2026-07-29 gap: a
        // 200-wrapped 500 never climbed the ladder).
        return {
          error: parsed.response?.error?.message || parsed.response?.error?.code || 'OpenAI response failed',
          code: parsed.response?.error?.code || null,
        };
      }
      if (parsed.type === 'response.incomplete') {
        const response = parsed.response || {};
        const reason = response.incomplete_details?.reason || 'unknown reason';
        if (reason === 'max_output_tokens') {
          return { done: true, finishReason: 'length', usage: readResponsesStreamUsage(response) };
        }
        return { error: `OpenAI response incomplete: ${reason}` };
      }
      return null;
    }
    // The usage chunk arrives last, often with an EMPTY choices array — the
    // delta reads stay null-safe so it flows through the same event shape.
    const choice = parsed.choices?.[0];
    return {
      content: choice?.delta?.content ?? null,
      // The reasoning channel beside the speech, where a vendor opens one. Two
      // spellings in the wild, both proven on this machine 2026-07-30:
      // `reasoning_content` (zai-coding-plan/glm-5.2, xai/grok-4.3) and
      // `reasoning` (gpt-oss through LM Studio — the same field getThinkBehavior
      // already classifies on a completed message). It is NOT speech: it rides
      // its own channel and never joins the answer.
      reasoning: choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? null,
      toolCalls: choice?.delta?.tool_calls ?? null,
      usage: readOpenAIStreamUsage(parsed),
      // 'stop' | 'length' | … on the final content chunk; null until then.
      // A 'length' here is the ONLY mechanical proof an answer was cut by
      // the token budget (S7f RCA lead: a cut answer used to be
      // indistinguishable from a complete one).
      finishReason: choice?.finish_reason ?? null,
    };
  } catch { return null; }
};

// The capacity scan (capacity-scan.js) owns its own drain loop — it needs a
// stall budget and token accounting the shared pump doesn't expose — but it
// must never fork the per-provider line parsing, or the two drift apart.
export const readStreamLine = _readLine;
