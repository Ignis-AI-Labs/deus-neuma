/** Completed stream actions, independent of provider and queue ownership. */
import { THINK_MARKER_REGISTRY } from './model-capabilities.js';

const statementEnded = (text) => /(?:[.!?。！？]["'”’)]*|\n\s*\n)\s*$/u.test(text);

/**
 * Stateful stream observer. The callback returns true only when it took a
 * handoff. Native reasoning yields BEFORE the next channel; inline reasoning
 * and speech yield AFTER the received chunk has been recorded and emitted.
 * Code fences and tool payloads are not statement boundaries.
 */
export const createStreamActionBoundary = (onBoundary, { implicitOpen = false } = {}) => {
  let nativeReasoning = false;
  let activeThought = implicitOpen ? THINK_MARKER_REGISTRY[0] : null;
  let tail = '';
  let fenced = false;
  let toolText = false;
  return (event, phase) => {
    if (!onBoundary) return false;
    if (phase === 'before') {
      if (nativeReasoning && !event.reasoning && (event.content || event.toolCalls || event.done)) {
        nativeReasoning = false;
        return onBoundary();
      }
      return false;
    }
    if (event.reasoning) nativeReasoning = true;
    if (typeof event.content !== 'string' || !event.content) return false;
    const text = tail + event.content;
    const previousLength = tail.length;
    let thoughtEnded = false;
    // Retain enough overlap for markers split over transport chunks, but
    // process a marker only when its final byte arrives in the new chunk.
    const tokens = [
      ...THINK_MARKER_REGISTRY.flatMap((pair) => [
        { marker: pair.start, pair, opens: true }, { marker: pair.end, pair, opens: false },
      ]),
      { marker: '```', fence: true },
      ...['tool_call', 'tool_calls', 'function_calls'].flatMap((tag) => [
        { marker: `<${tag}>`, tool: true, opens: true }, { marker: `</${tag}>`, tool: true, opens: false },
      ]),
    ].flatMap((token) => [...text.matchAll(new RegExp(token.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))]
      .filter((match) => match.index + token.marker.length > previousLength)
      .map((match) => ({ ...token, index: match.index })))
      .sort((a, b) => a.index - b.index);
    for (const token of tokens) {
      if (token.tool && !activeThought && !fenced) toolText = token.opens;
      else if (token.fence && !activeThought) fenced = !fenced;
      else if (!token.tool && !fenced && token.opens) activeThought = token.pair;
      else if (!fenced && activeThought?.end === token.marker) {
        activeThought = null;
        thoughtEnded = true;
      }
    }
    tail = text.slice(-64);
    if (thoughtEnded || (!activeThought && !fenced && !toolText && statementEnded(text))) return onBoundary();
    return false;
  };
};

/** impure — aborting fetch may already have errored its reader before cancel. */
export const cancelActionStream = async (reader, signal) => {
  try { await reader.cancel(); }
  catch (error) { if (!signal?.aborted) throw error; }
};
