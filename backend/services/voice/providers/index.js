// Voice provider adapter registry.
//
// Each adapter module exports:
//   synthesize({ text, voiceDNA, emotion, signal, config }): AsyncGenerator<AudioChunk>
//   testConnection(config): Promise<{ ok, latencyMs?, error? }>
//
// Adapters are intentionally optional — an unimplemented engine returns undefined
// here and tts-provider.js gives a clear error rather than crashing at import.
// This lets engines.json list engines (for download/UI) before their adapter ships.

import { zonosAdapter } from './zonos.js';
import { kokoroAdapter } from './kokoro.js';
import { parlerAdapter } from './parler.js';
import { cartesiaAdapter } from './cartesia.js';
import { elevenlabsAdapter } from './elevenlabs.js';
import { kyutaiAdapter } from './kyutai.js';
import { qwen3Adapter } from './qwen3.js';

export const adapters = Object.freeze({
  zonos: zonosAdapter,
  kokoro: kokoroAdapter,
  parler: parlerAdapter,
  cartesia: cartesiaAdapter,
  elevenlabs: elevenlabsAdapter,
  kyutai: kyutaiAdapter,
  qwen3: qwen3Adapter,
});
