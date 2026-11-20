// The Ollama path uses the same reviewed model bytes as the managed engine.
import { modelFilesFor } from './managed-engine-plan.js';

const pin = (revision, name, size, sha256) => Object.freeze({ revision, name, size, sha256 });
const CPU_PINS = Object.freeze({
  'lmstudio-community/Qwen3.6-35B-A3B-GGUF:Q4_K_M': pin('68a34855558af61cbef0324d31f411be8a506b08', 'Qwen3.6-35B-A3B-Q4_K_M.gguf', 21_166_757_728, '4ac6a06bce551257267f49ad2226f8671a22519ccc1a4dde9d5b433d1f2a410d'),
  'lmstudio-community/Qwen3.5-4B-GGUF:Q4_K_M': pin('f9f88ac3e234be915e23811a6d28ea287bdb927e', 'Qwen3.5-4B-Q4_K_M.gguf', 2_707_513_696, '25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c'),
});

/** The reviewed revision and GGUF digest for an Ollama recommendation, or null. Pure. */
export const ollamaModelPin = (choice) => modelFilesFor(choice)?.model ?? CPU_PINS[`${choice?.source}:${choice?.quant}`] ?? null;

/** The single model blob named by Ollama's Modelfile, or null when absent or ambiguous. Pure. */
export const ollamaBlobDigest = (show) => {
  const rows = String(show?.modelfile ?? '').split('\n')
    .map((line) => /^FROM\s+(?:.*\/)?sha256-([0-9a-f]{64})\s*$/.exec(line.trim()))
    .filter(Boolean);
  return rows.length === 1 ? rows[0][1] : null;
};
