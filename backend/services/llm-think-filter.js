// Reasoning-channel filtering and classification; no network or storage dependencies.

import { THINK_MARKER_REGISTRY } from './think-marker-registry.js';

// --- Reasoning-channel filtering ---
//
// Different thinking-mode models wrap their internal reasoning in different
// marker pairs. We filter all known pairs before surfacing the final response
// to the witness.
//
//   Qwen3 / DeepSeek R1:  <think> ... </think>
//   Gemma 4 (channels):   <|channel>thought ... <channel|>
//
// The Gemma 4 markers are asymmetric — the opening has pipe-before, the
// closing has pipe-after. Both shapes are handled as distinct pairs.

// The registry is data in think-marker-registry.js (THINK_MARKER_REGISTRY) — a
// new thinker family becomes a data row, never a request-path change. The
// filter strips every known pair regardless of the active model (these
// markers never appear in ordinary speech), and the FIRST entry stays the
// implicit-open shape createThinkFilter assumes.
const THINK_MARKER_PAIRS = THINK_MARKER_REGISTRY;

/** Strip every known thinking-channel block from a completed string. */
export const stripThinkTags = (text) => {
  let out = text;
  for (const { start, end } of THINK_MARKER_PAIRS) {
    // Escape regex metacharacters in marker strings
    const escStart = start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escEnd = end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`${escStart}[\\s\\S]*?${escEnd}\\s*`, 'g'), '');
  }
  // Implicit-open thinkers (the chat template pre-opens <think> inside the
  // prompt, e.g. Qwen3.5) leave a bare closer with no opener in the output —
  // everything before it is reasoning, not speech
  if (out.includes('</think>')) {
    out = out.replace(/^[\s\S]*?<\/think>\s*/, '');
  }
  return out;
};

/**
 * Find the earliest opening marker in `text` from any known pair.
 * Returns { index, pair } where pair is the matching marker pair, or null
 * if no opening marker is present.
 */
const _findEarliestStart = (text) => {
  let best = null;
  for (const pair of THINK_MARKER_PAIRS) {
    const idx = text.indexOf(pair.start);
    if (idx !== -1 && (best === null || idx < best.index)) {
      best = { index: idx, pair };
    }
  }
  return best;
};

/**
 * Create a streaming filter that suppresses reasoning-channel content from
 * any known thinking-mode model. Returns a wrapper around onContent that
 * only forwards the visible (non-reasoning) output to the witness.
 *
 * Caveat: the filter uses plain indexOf per chunk, so a marker split across
 * chunk boundaries can leak. In practice chunk sizes are larger than the
 * longest marker (~18 chars) so this is rare, but it's a known limitation.
 *
 * options.implicitOpen: start already inside a <think> block — for models
 * whose chat template pre-opens the block in the prompt, so the stream
 * carries reasoning from the first byte with no opening marker.
 */
export const createThinkFilter = (onContent, options = {}) => {
  // non-null = currently inside a think block
  let activePair = options.implicitOpen ? THINK_MARKER_PAIRS[0] : null;
  // What the filter strips is the being's reasoning, and it used to end here.
  // Handed to onReasoning it becomes watchable (Design note, 2026-07-30: […]).
  // Absent a listener the behaviour is exactly what it was: discarded.
  const onReasoning = typeof options.onReasoning === 'function' ? options.onReasoning : null;
  // Before any speech, the gap after a closing marker routinely spans
  // chunk boundaries — swallow it so speech never opens with blank lines.
  // Once speech has been emitted, whitespace is content and survives.
  let emitted = false;
  let stripLeading = false;

  return (content) => {
    let remaining = content;

    while (remaining.length > 0) {
      if (activePair) {
        const endIdx = remaining.indexOf(activePair.end);
        if (endIdx !== -1) {
          if (onReasoning && endIdx > 0) onReasoning(remaining.slice(0, endIdx));
          remaining = remaining.slice(endIdx + activePair.end.length);
          // Skip leading whitespace after the closing marker
          remaining = remaining.replace(/^[\s\n]+/, '');
          activePair = null;
          if (!emitted) stripLeading = true;
        } else {
          // Still inside reasoning: the whole chunk is thought, not speech.
          if (onReasoning) onReasoning(remaining);
          break;
        }
      } else {
        if (stripLeading) {
          remaining = remaining.replace(/^[\s\n]+/, '');
          if (remaining.length === 0) break;
          stripLeading = false;
        }
        const hit = _findEarliestStart(remaining);
        if (hit) {
          if (hit.index > 0) {
            onContent(remaining.slice(0, hit.index));
            emitted = true;
          }
          activePair = hit.pair;
          remaining = remaining.slice(hit.index + hit.pair.start.length);
        } else {
          onContent(remaining);
          emitted = true;
          break;
        }
      }
    }
  };
};

/**
 * Classify a completed (non-stream) chat message's reasoning shape. Pure.
 * Three substrate shapes are known:
 *   marker-thinkers   — reasoning inline in content as <think>...</think>
 *   implicit-open     — template pre-opens the block; only </think> appears
 *   reasoning-field   — reasoning in a separate string beside content:
 *                       message.reasoning (gpt-oss through LM Studio) or
 *                       message.reasoning_content (llama-server's OpenAI
 *                       dialect); content stays clean either way
 * Reasoning-field substrates need the think token budget exactly like
 * marker-thinkers (their reasoning still consumes max_tokens server-side)
 * but no content filtering — implicitOpen stays false, nothing to strip.
 * @param {{content?: string, reasoning?: string, reasoning_content?: string}} message
 * @returns {{ thinks: boolean, implicitOpen: boolean }}
 */
export const classifyThinkBehavior = (message) => {
  const content = message?.content ?? '';
  const reasoningField = message?.reasoning ?? message?.reasoning_content;
  const reasonsInField = typeof reasoningField === 'string' && reasoningField.length > 0;
  const thinks = content.includes('</think>') || reasonsInField;
  return Object.freeze({ thinks, implicitOpen: thinks && !reasonsInField && !content.includes('<think>') });
};
