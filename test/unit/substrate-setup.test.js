/**
 * Substrate setup — the pure guidance functions behind the first-run BYO-LLM
 * wizard: hardware→model recommendation + provider-payload parsing. (The live
 * provider probe is network IO, exercised against real local providers.)
 */

import {
  recommendSubstrate,
  parseOllamaTags,
  parseLmStudioModels,
} from '../../backend/services/substrate-setup.js';

const gpu = (vramGB) => ({ gpu: { name: 'NVIDIA', vramGB }, memory: { totalGB: 64 }, platform: { os: 'linux' } });
const cpu = (totalGB, os = 'linux') => ({ gpu: null, memory: { totalGB }, platform: { os } });

describe('recommendSubstrate (pure)', () => {
  // Design note, 2026-10-06: […] — the newest Qwen at every size the 2026-10-06 ladder
  // proved (scripts/min-spec-ladder.mjs), sized at the served 65536 tokens.
  test('every card class gets the newest model it can hold', () => {
    expect(recommendSubstrate(gpu(96)).model).toBe('Qwen3.8-27B Uncensored (HauhauCS)'); // RTX PRO 6000
    expect(recommendSubstrate(gpu(48)).model).toBe('Qwen3.8-27B Uncensored (HauhauCS)'); // RTX 6000 Ada / A6000
    expect(recommendSubstrate(gpu(32)).model).toBe('Qwen3.8-27B (6-bit)');               // RTX 5090
    expect(recommendSubstrate(gpu(24)).model).toBe('Qwen3.8-27B (4-bit)');               // RTX 3090 / 4090
    expect(recommendSubstrate(gpu(20)).model).toBe('Qwen3.8-27B (3.5-bit, IST Austria)');
    expect(recommendSubstrate(gpu(16)).model).toBe('Qwen3.8-27B (3-bit, IST Austria)');  // 4060 Ti 16 / 4080 / 5070 Ti
    expect(recommendSubstrate(gpu(12)).model).toBe('Qwen3.8-4B (distilled)');             // 3060 / 4070 / 5070
    expect(recommendSubstrate(gpu(8)).model).toBe('Qwen3.8-4B (distilled)');              // 4060 / 5060
  });

  // Every threshold has to hold the model AND its 65536-token KV cache:
  // llama-server is spawned with `-ngl 999` and no OOM retry — a card that
  // cannot hold it all fails at load. The Q8 27B needs ~35 GiB there, the
  // 3-bit 27B ~14.7 GiB (measured 12.2 GiB at 32k on the ladder, + 2 GiB KV).
  test('a card that cannot hold the model AND its context is never offered that tier', () => {
    expect(recommendSubstrate(gpu(32)).model).not.toBe('Qwen3.8-27B Uncensored (HauhauCS)'); // RTX 5090
    expect(recommendSubstrate(gpu(32)).options.map((o) => o.model)).not.toContain('Qwen3.8-27B Uncensored (HauhauCS)');
    expect(recommendSubstrate(gpu(12)).options.map((o) => o.model)).not.toContain('Qwen3.8-27B (3-bit, IST Austria)');
    expect(recommendSubstrate(gpu(16)).options.map((o) => o.model)).not.toContain('Qwen3.8-27B (4-bit)');
  });

  // A small GPU must never make the verdict worse than the same box with no
  // GPU: a card too small for any tier falls back to the processor.
  test('a small GPU never makes the verdict worse than the same box without one', () => {
    const tooSmall = recommendSubstrate(gpu(4));       // gpu() carries 64 GB RAM
    const withoutCard = recommendSubstrate(cpu(64));
    expect(tooSmall.model).toBe(withoutCard.model);
    expect(tooSmall.mode).toBe('cpu');
    const small = recommendSubstrate(gpu(8));
    expect(small.fit).not.toBe('insufficient');
    expect(small.mode).toBe('gpu');
  });

  test('a GPU too small AND too little RAM is honestly insufficient', () => {
    const r = recommendSubstrate({ gpu: { name: 'NVIDIA', vramGB: 4 }, memory: { totalGB: 8 }, platform: { os: 'linux' } });
    expect(r.model).toBeNull();
    expect(r.fit).toBe('insufficient');
    expect(r.why).toMatch(/cloud/i);
  });

  test('Mac unified memory is treated as the budget', () => {
    const r = recommendSubstrate(cpu(128, 'darwin'));
    expect(r.mode).toBe('unified');
    expect(r.model).toBe('Qwen3.8-27B Uncensored (HauhauCS)');
    expect(r.fit).toBe('comfortable');
  });

  // Unified memory is SHARED with the OS: a 16 GB MacBook Air's Metal wired
  // limit is ~12 GiB — it is offered what that holds, never the 27B.
  test('unified memory leaves the OS its share instead of promising all of it', () => {
    const r = recommendSubstrate(cpu(16, 'darwin'));
    expect(r.budgetGB).toBeLessThan(16);
    expect(r.model).toBe('Qwen3.8-4B (distilled)');
  });

  test('CPU-only is promised only a model light per word, and marked tight', () => {
    const r = recommendSubstrate(cpu(128)); // lots of RAM, no GPU
    expect(r.mode).toBe('cpu');
    expect(r.model).toBe('Qwen3.6-35B-A3B'); // the MoE, never a dense 27B that would crawl
    expect(r.fit).toBe('tight');
    expect(r.why).toMatch(/slower/i);
    expect(recommendSubstrate(cpu(16)).model).toBe('Qwen3.8-4B (distilled)'); // 16 - 4 for the OS = 12
  });

  test('a tiny machine is insufficient', () => {
    expect(recommendSubstrate(cpu(8)).fit).toBe('insufficient');
  });

  // Every choice that fits is offered, newest first; only a summon-checked one
  // is ever RECOMMENDED.
  test('offers every model that fits, newest first, each marked checked or not', () => {
    const { options } = recommendSubstrate(gpu(24));
    expect(options.map((o) => `${o.model} ${o.quant}`)).toEqual([
      'Qwen3.8-27B (4-bit) Q4_K_M', 'Qwen3.8-27B (3.5-bit, IST Austria) IQ3_S', 'Qwen3.8-27B (3-bit, IST Austria) IQ3_XXS',
      'Qwen3.8-4B (distilled) Q4_K_M', 'Qwen3.6-35B-A3B Q4_K_M', 'Qwen3.5-4B Q4_K_M',
    ]);
    expect(options.find((o) => o.quant === 'IQ3_XXS')).toMatchObject({ checked: true, source: 'ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF' });
  });

  test('the recommendation is always a summon-checked model', () => {
    for (const vram of [96, 48, 32, 24, 20, 16, 12, 8]) {
      const r = recommendSubstrate(gpu(vram));
      expect(r.options.find((o) => o.model === r.model && o.quant === r.quant)?.checked, `${vram} GB`).toBe(true);
    }
  });
});

describe('provider payload parsers (pure)', () => {
  test('parseOllamaTags pulls model names, tolerates junk', () => {
    expect(parseOllamaTags({ models: [{ name: 'gemma3:27b' }, { name: 'llama3' }] })).toEqual(['gemma3:27b', 'llama3']);
    expect(parseOllamaTags({})).toEqual([]);
    expect(parseOllamaTags(null)).toEqual([]);
  });

  test('parseLmStudioModels pulls ids, tolerates junk', () => {
    expect(parseLmStudioModels({ data: [{ id: 'qwen3.5-122b' }] })).toEqual(['qwen3.5-122b']);
    expect(parseLmStudioModels({ data: [] })).toEqual([]);
    expect(parseLmStudioModels(undefined)).toEqual([]);
  });
});
