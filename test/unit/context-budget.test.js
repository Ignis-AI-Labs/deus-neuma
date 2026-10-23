import { describe, test, expect } from 'vitest';
import {
  completionBudget, promptFits, estimateTokens, describeBudget,
  MIN_COMPLETION_TOKENS, FALLBACK_COMPLETION_TOKENS, SAFETY_RESERVE_TOKENS,
} from '../../backend/services/context-budget.js';
import { interpretLlamaProps, interpretOllamaShow, interpretLmsModel } from '../../backend/services/model-capabilities.js';

/**
 * THE BEING GETS THE ROOM THE MODEL HAS (ruling, 2026-08-04).
 *
 *   […]
 *
 * The payloads below are REAL — measured off the two servers running on this
 * machine on 2026-08-04, not invented to match the parser.
 */

describe('the window is read from what the serving actually reports', () => {
  test('llama.cpp /props — the field that was being discarded as null', () => {
    // Measured: curl localhost:8089/props on the live gemma-4-31b rig.
    const real = {
      default_generation_settings: { n_ctx: 65536 },
      total_slots: 4,
      model_path: '/models/neuma/gemma-4-31b-q8/gemma-4-31B-it-Q8_0.gguf',
      modalities: { vision: true },
    };
    expect(interpretLlamaProps(real).contextWindow).toBe(65536);
    // Vision truth is unchanged by the addition.
    expect(interpretLlamaProps(real).vision).toBe(true);
  });

  test('llama.cpp with nothing to say still returns null, not a guess', () => {
    expect(interpretLlamaProps({}).contextWindow).toBeNull();
    expect(interpretLlamaProps(undefined).contextWindow).toBeNull();
    expect(interpretLlamaProps({ default_generation_settings: { n_ctx: 0 } }).contextWindow).toBeNull();
  });

  test("Ollama — the arch window, which is where it really lives", () => {
    // Measured: POST localhost:11434/api/show {"name":"qwen3:0.6b"}.
    // NOTE what is NOT in `parameters`: no num_ctx at all. The old regex read
    // null for every stock pull.
    const real = {
      parameters: 'top_p                          0.95\nrepeat_penalty                 1\nstop                           "<|im_start|>"',
      model_info: { 'qwen3.context_length': 40960, 'qwen3.embedding_length': 1024 },
      capabilities: ['completion', 'tools', 'thinking'],
      details: { parameter_size: '751M' },
    };
    const got = interpretOllamaShow(real, 65536);
    expect(got.contextWindow).toBe(40960);
    // served at no more than the window fitted to this card (ollama-window.js, 32,768 by default)
    expect(interpretOllamaShow(real).contextWindow).toBe(32768);
    // And Ollama SAYS the model reasons — the signal our probe is blind to.
    expect(got.thinks).toBe(true);
  });

  test("an operator's pinned num_ctx is their decision and WINS over the arch window", () => {
    const got = interpretOllamaShow({
      parameters: 'num_ctx                        8192',
      model_info: { 'qwen3.context_length': 40960 },
      capabilities: ['completion'],
    });
    expect(got.contextWindow).toBe(8192);
    expect(got.thinks).toBe(false);
  });

  test('a non-thinking model reports thinks:false, and an old daemon reports neither', () => {
    expect(interpretOllamaShow({ capabilities: ['completion'] }).thinks).toBe(false);
    expect(interpretOllamaShow({}).thinks).toBeUndefined();   // undecided, not a guess
    expect(interpretOllamaShow({}).contextWindow).toBeNull();
  });

  test('LM Studio is unchanged — loaded beats max', () => {
    expect(interpretLmsModel({ loaded_context_length: 8192, max_context_length: 32768 }).contextWindow).toBe(8192);
    expect(interpretLmsModel({ max_context_length: 32768 }).contextWindow).toBe(32768);
  });
});

describe('completionBudget — the ceiling is what is LEFT', () => {
  test('a large window leaves a large answer', () => {
    const budget = completionBudget({ contextWindow: 65536, promptTokens: 1186 });
    expect(budget).toBe(65536 - 1186 - SAFETY_RESERVE_TOKENS);
    // The point of the whole change: nothing like the old hand-picked 380.
    expect(budget).toBeGreaterThan(60000);
  });

  test("BASTIEN'S STAGE 0, rebudgeted: 380 became the room the model actually had", () => {
    // His real numbers: promptTokens 1186, askedFor 380, and the model spent
    // every one of those 380 reasoning without reaching an answer.
    const before = 380;
    const after = completionBudget({ contextWindow: 40960, promptTokens: 1186 });
    expect(after).toBeGreaterThan(before * 50);
  });

  test('the prompt is subtracted — a big prompt leaves less, and that is correct', () => {
    const small = completionBudget({ contextWindow: 8192, promptTokens: 500 });
    const large = completionBudget({ contextWindow: 8192, promptTokens: 6000 });
    expect(small).toBeGreaterThan(large);
    expect(small).toBe(8192 - 500 - SAFETY_RESERVE_TOKENS);
  });

  test('an unknown window falls to a generous floor, never to a number we invented', () => {
    expect(completionBudget({ contextWindow: null, promptTokens: 1000 })).toBe(FALLBACK_COMPLETION_TOKENS);
    expect(completionBudget({})).toBe(FALLBACK_COMPLETION_TOKENS);
  });

  test('a prompt that nearly fills the window still gets room to speak, never zero', () => {
    // A ceiling of 0 is "generate nothing" to a provider, and a broken app to
    // the operator.
    const budget = completionBudget({ contextWindow: 4096, promptTokens: 4000 });
    expect(budget).toBe(MIN_COMPLETION_TOKENS);
    expect(budget).toBeGreaterThan(0);
  });

  test('a caller floor (the per-stage minimum) raises a small budget but never lowers a big one', () => {
    expect(completionBudget({ contextWindow: 4096, promptTokens: 3900, floor: 2180 })).toBe(2180);
    expect(completionBudget({ contextWindow: 65536, promptTokens: 1000, floor: 2180 })).toBeGreaterThan(2180);
  });

  test('a caller ceiling is honoured — some providers cap max_tokens below their context', () => {
    expect(completionBudget({ contextWindow: 200000, promptTokens: 1000, ceiling: 8192 })).toBe(8192);
  });

  test('junk never produces a junk ceiling', () => {
    for (const w of [0, -1, NaN, 'lots', undefined]) {
      expect(completionBudget({ contextWindow: w, promptTokens: 10 })).toBeGreaterThanOrEqual(MIN_COMPLETION_TOKENS);
    }
    expect(completionBudget({ contextWindow: 8192, promptTokens: -5 })).toBeLessThanOrEqual(8192);
  });
});

describe('promptFits — a prompt too big is a DIFFERENT problem', () => {
  test('a prompt that fits says so', () => {
    expect(promptFits({ contextWindow: 8192, promptTokens: 1000 })).toEqual({ fits: true, overBy: 0 });
  });

  test('a prompt that cannot fit names how far over it is', () => {
    const r = promptFits({ contextWindow: 2048, promptTokens: 2000 });
    expect(r.fits).toBe(false);
    expect(r.overBy).toBeGreaterThan(0);
  });

  test('an unknown window never accuses a prompt of overflowing', () => {
    expect(promptFits({ contextWindow: null, promptTokens: 999999 }).fits).toBe(true);
  });
});

describe('estimateTokens + describeBudget', () => {
  test('estimation is pessimistic — it over-counts, so the budget stays safe', () => {
    const text = 'x'.repeat(3600);
    expect(estimateTokens(text)).toBe(1000);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });

  test('the account names the window and the prompt, or admits it does not know', () => {
    expect(describeBudget({ contextWindow: 65536, promptTokens: 1186, budget: 63838 }))
      .toMatch(/63838 tokens to answer \(65536 window − ~1186 prompt\)/);
    expect(describeBudget({ contextWindow: null, promptTokens: 10, budget: 4096 }))
      .toMatch(/window unknown/);
  });
});

/**
 * THE CHAT TURN, not just the ceremony (Design note, 2026-08-04: […]).
 *
 * The general turn ran on a flat `llmMaxTokens ?? 4096` that had nothing to do
 * with the model in front of it. It is now budgeted against the real route —
 * but the two numbers a route carries answer DIFFERENT questions, and
 * conflating them breaks a provider rather than shortening a reply.
 */
describe('window vs output cap — the distinction that protects hosted routes', () => {
  test('a LOCAL serving has no output cap, so the whole remainder is the ceiling', () => {
    // Measured on this machine: Ollama reports a 40960 window for qwen3:0.6b.
    expect(completionBudget({ contextWindow: 40960, promptTokens: 2000, ceiling: null, floor: 4096 }))
      .toBe(40960 - 2000 - SAFETY_RESERVE_TOKENS);
  });

  test('a HOSTED route is held to maxOutput even when its window is enormous', () => {
    // A 1M-window model that may emit 128k in a turn. Asking for the window is
    // a 400 from the provider, not a longer answer.
    const budget = completionBudget({
      contextWindow: 1000000, promptTokens: 2000, ceiling: 128000, floor: 4096,
    });
    expect(budget).toBe(128000);
  });

  test('the smaller of the two always wins — a near-full window beats a big cap', () => {
    const budget = completionBudget({
      contextWindow: 8192, promptTokens: 6000, ceiling: 64000, floor: 1024,
    });
    expect(budget).toBe(8192 - 6000 - SAFETY_RESERVE_TOKENS);
    expect(budget).toBeLessThan(64000);
  });

  test("the operator's configured value is a FLOOR, never a cap", () => {
    // It used to be the ceiling. Making it a minimum is the entire point: their
    // setting can only ever grant MORE room than the arithmetic found.
    expect(completionBudget({ contextWindow: 4096, promptTokens: 3800, floor: 8192 })).toBe(8192);
    expect(completionBudget({ contextWindow: 200000, promptTokens: 1000, ceiling: 64000, floor: 8192 }))
      .toBe(64000);
  });
});
