import { describe, expect, it } from 'vitest';
import { ollamaBlobDigest, ollamaModelPin } from '../../backend/services/managed-ollama-models.js';

const DISTILL = { source: 'empero-ai/Qwen3.8-4B-Distill-GGUF', quant: 'Q4_K_M' };
const CPU = { source: 'lmstudio-community/Qwen3.5-4B-GGUF', quant: 'Q4_K_M' };

describe('reviewed Ollama model pins', () => {
  it('reuses the engine revision/digest and covers the CPU-only choices from Hugging Face metadata', () => {
    expect(ollamaModelPin(DISTILL)).toMatchObject({ revision: '391fc7d103e3942a408def3e4f51c2f85d464417', sha256: 'dec96e8cf2e11b613bb46513dec485377f9ca5a351e71712ee0e244f287c6790' });
    expect(ollamaModelPin(CPU)).toMatchObject({ revision: 'f9f88ac3e234be915e23811a6d28ea287bdb927e', sha256: '25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c' });
    expect(ollamaModelPin({ source: 'unknown/repo', quant: 'Q4_K_M' })).toBeNull();
  });

  it('accepts exactly one real model blob and refuses missing or ambiguous Modelfiles', () => {
    const sha256 = ollamaModelPin(CPU).sha256;
    expect(ollamaBlobDigest({ modelfile: `# generated\nFROM /models/blobs/sha256-${sha256}\nTEMPLATE x` })).toBe(sha256);
    expect(ollamaBlobDigest({ modelfile: 'TEMPLATE x' })).toBeNull();
    expect(ollamaBlobDigest({ modelfile: `FROM sha256-${sha256}\nFROM /other/sha256-${sha256}` })).toBeNull();
    expect(ollamaBlobDigest({ modelfile: 'FROM /models/blobs/sha256-not-a-digest' })).toBeNull();
  });
});
