/**
 * proof-data — the PROOF SUITE's frozen item set (v1): the platform's native
 * […] suite. No sibling harness, no lm-eval — a
 * fresh install runs this against whatever answers at the serving endpoint.
 *
 * Three sections, each answering one honest question about the served model:
 *   arithmetic  (25) — real GSM8K test items, VERBATIM (openai/gsm8k, MIT —
 *     provenance and attribution ride the JSON's _meta): can it reason?
 *   instruction (12) — authored-for-Neuma, IFEval-style deterministic checks:
 *     can it follow a constraint exactly?
 *   format      (6)  — strict JSON shapes: can it hold a structure, not just
 *     talk about one?
 *
 * Every item is {id, section, prompt, verify} — data plus a scorer pointer;
 * the scoring logic lives in proof-scorer.js. The suite is FROZEN per
 * version: a change to any item is a new PROOF_SUITE_VERSION, because a
 * certificate's whole worth is that the suite it names is the suite that ran.
 *
 * The GSM8K JSON loads at module init (the chain-reader idiom): a broken or
 * missing data file is a deployment-layout bug — fail loudly at boot, never
 * serve a partial suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const PROOF_SUITE_VERSION = '1';

const dataPath = join(dirname(fileURLToPath(import.meta.url)), 'proof-gsm8k-25.json');
const gsm8k = JSON.parse(readFileSync(dataPath, 'utf8'));
if (!Array.isArray(gsm8k?.items) || gsm8k.items.length !== 25) {
  throw new Error('proof-data: proof-gsm8k-25.json must carry exactly 25 items — repo layout broken');
}

/** The arithmetic prompt: zero-shot with the scorer's #### convention stated. */
const arithmeticPrompt = (question) =>
  'Answer this grade-school math word problem. Reason step by step, then end your reply with a final line '
  + 'of exactly "#### N" where N is the final numeric answer (digits only — no commas, no units, no currency symbol).\n\n'
  + `Question: ${question}`;

const arithmetic = gsm8k.items.map((item) => Object.freeze({
  id: item.id,
  section: 'arithmetic',
  prompt: arithmeticPrompt(item.question),
  verify: Object.freeze({ kind: 'final-number', expected: item.final }),
}));

// ── Instruction-following — authored for Neuma, IFEval-style, every check
// deterministic (the scorer's word is exact). ────────────────────────────────
const instruction = [
  { id: 'instr-exact-words', prompt: 'Describe the sea in exactly 20 words.', verify: { kind: 'word-count', exact: 20 } },
  { id: 'instr-word-floor', prompt: 'In at least 50 words, explain why regular exercise matters.', verify: { kind: 'word-count', min: 50 } },
  { id: 'instr-all-caps', prompt: 'Answer in ALL CAPITAL LETTERS only: what is the capital of France?', verify: { kind: 'all-caps' } },
  { id: 'instr-all-lowercase', prompt: 'Answer in all lowercase letters only — no capital letters at all: what is two plus two?', verify: { kind: 'all-lowercase' } },
  { id: 'instr-include', prompt: 'Explain what a lighthouse does in one or two sentences. Your answer must include the word "beam".', verify: { kind: 'must-include', words: ['beam'] } },
  { id: 'instr-include-two', prompt: 'Write one sentence about coffee that includes both the word "aroma" and the word "bitter".', verify: { kind: 'must-include', words: ['aroma', 'bitter'] } },
  { id: 'instr-exclude', prompt: 'Name three primary colors without using the word "red".', verify: { kind: 'must-not-include', words: ['red'] } },
  { id: 'instr-exclude-two', prompt: 'Describe a tree in one sentence without using the words "green" or "leaf".', verify: { kind: 'must-not-include', words: ['green', 'leaf'] } },
  { id: 'instr-numbered-4', prompt: 'List exactly 4 planets of the solar system as a numbered list ("1. Mercury" style), one per line.', verify: { kind: 'numbered-list-count', exact: 4 } },
  { id: 'instr-numbered-3', prompt: 'Give exactly 3 tips for better sleep as a numbered list ("1. ..." style), one per line.', verify: { kind: 'numbered-list-count', exact: 3 } },
  { id: 'instr-starts-with', prompt: 'Begin your answer with exactly the words "The answer is" and then name the largest planet.', verify: { kind: 'starts-with', prefix: 'The answer is' } },
  { id: 'instr-json-only', prompt: 'Answer with ONLY a JSON object — no prose, no markdown fences — with the key "ok" set to true.', verify: { kind: 'json-only' } },
].map((item) => Object.freeze({ ...item, section: 'instruction', verify: Object.freeze(item.verify) }));

// ── Format discipline — strict JSON shapes, judged by parse + shape, never
// by "looks like". Each prompt demands the bare shape and nothing else. ──────
const format = [
  {
    id: 'format-person',
    prompt: 'Reply with ONLY a JSON object — no prose, no markdown — with exactly the keys "name" (a string) and "age" (a number), describing a fictional person.',
    verify: { kind: 'json-shape', shape: { type: 'object', strict: true, keys: { name: 'string', age: 'number' } } },
  },
  {
    id: 'format-trio',
    prompt: 'Reply with ONLY a JSON array — no prose, no markdown — of exactly 3 strings, each the name of a fruit.',
    verify: { kind: 'json-shape', shape: { type: 'array', length: 3, items: 'string' } },
  },
  {
    id: 'format-city',
    prompt: 'Reply with ONLY a JSON object — no prose, no markdown — of the form {"city": {"name": string, "population": number}} for a real city.',
    verify: { kind: 'json-shape', shape: { type: 'object', strict: true, keys: { city: { type: 'object', strict: true, keys: { name: 'string', population: 'number' } } } } },
  },
  {
    id: 'format-status',
    prompt: 'Reply with ONLY a JSON object — no prose, no markdown — with exactly the keys "ok" (a boolean) and "items" (an array, possibly empty).',
    verify: { kind: 'json-shape', shape: { type: 'object', strict: true, keys: { ok: 'boolean', items: 'array' } } },
  },
  {
    id: 'format-tagged-list',
    prompt: 'Reply with ONLY a JSON array — no prose, no markdown — of exactly 2 objects, each with exactly the keys "id" (a number) and "label" (a string).',
    verify: { kind: 'json-shape', shape: { type: 'array', length: 2, items: { type: 'object', strict: true, keys: { id: 'number', label: 'string' } } } },
  },
  {
    id: 'format-answer',
    prompt: 'What is 6 multiplied by 7? Reply with ONLY a JSON object — no prose, no markdown — with exactly one key, "answer", holding the number.',
    verify: { kind: 'json-shape', shape: { type: 'object', strict: true, keys: { answer: 'number' } } },
  },
].map((item) => Object.freeze({ ...item, section: 'format', verify: Object.freeze(item.verify) }));

/** The whole suite, frozen: 25 arithmetic + 12 instruction + 6 format. */
export const PROOF_SUITE = Object.freeze([...arithmetic, ...instruction, ...format]);

/** Per-section sampling bounds for the run (temperature 0 / seed 7 ride every call). */
export const SECTION_MAX_TOKENS = Object.freeze({ arithmetic: 768, instruction: 320, format: 512 });

/** The section order the runner walks (arithmetic first — the longest reads). */
export const SECTION_ORDER = Object.freeze(['arithmetic', 'instruction', 'format']);
