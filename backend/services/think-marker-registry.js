/**
 * Reasoning-channel marker pairs per family — Qwen3/DeepSeek wrap thought in
 * <think>…</think>; Gemma 4 channels it in <|channel>thought…<channel|>
 * (asymmetric: pipe-before opens, pipe-after closes). ORDER MATTERS: the
 * stream filter treats the FIRST pair as the implicit-open shape.
 */
export const THINK_MARKER_REGISTRY = Object.freeze([
  Object.freeze({ start: '<think>', end: '</think>', families: Object.freeze(['alibaba', 'deepseek']) }),
  Object.freeze({ start: '<|channel>thought', end: '<channel|>', families: Object.freeze(['google']) }),
]);

