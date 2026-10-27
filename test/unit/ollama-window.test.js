/**
 * OLLAMA WINDOW — the window an Ollama serves, fitted to the graphics card (ollama-window.js, pure).
 *
 * The model's layout below is the real /api/show model_info of the model the setup installs
 * (hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF:Q4_K_M on Ollama 0.40.7), and MEASURED is what that
 * model took on the GPU (nvidia-smi, per process) on 2026-10-23, served at each window with one
 * slot: the sizing must never read below the truth, nor far above it.
 */
import { describe, expect, test } from 'vitest';
import {
  OLLAMA_SERVED_CONTEXT, OLLAMA_WINDOW_FLOOR, fitOllamaWindow, gpuBytesAt, gpuRoomBytes, kvBytesPerToken,
} from '../../backend/services/ollama-window.js';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const QWEN38_4B_INFO = Object.freeze({
  'general.architecture': 'qwen35',
  'qwen35.block_count': 33,
  'qwen35.context_length': 262144,
  'qwen35.embedding_length': 2560,
  'qwen35.attention.head_count': 16,
  'qwen35.attention.head_count_kv': 4,
  'qwen35.attention.key_length': 256,
  'qwen35.attention.value_length': 256,
  'qwen35.full_attention_interval': 4,
});
// /api/tags size of that model
const QWEN38_4B_BYTES = 2_783_446_711;
// window → MiB on the GPU (the 64K reading is the peak with a real 17,022-token prompt)
const MEASURED = Object.freeze({ 8192: 3674, 16384: 3946, 32768: 4512, 65536: 5886 });
const model = { weightsBytes: QWEN38_4B_BYTES, kvPerToken: kvBytesPerToken(QWEN38_4B_INFO) };

describe('the KV cache a model keeps per token', () => {
  test('a hybrid model keeps it in one layer of four: 9 of 33 layers for the 4B, f16, never below the 8 measured', () => {
    // measured: 256 MiB for 8,192 tokens in 8 layers = 32 KiB a token; rounded up to 9 layers
    expect(kvBytesPerToken(QWEN38_4B_INFO)).toBe(9 * 4 * 512 * 2);
    expect(kvBytesPerToken(QWEN38_4B_INFO)).toBeGreaterThanOrEqual(256 * MIB / 8192);
  });

  test('a plain transformer keeps it in every layer; per-layer head counts take the largest', () => {
    expect(kvBytesPerToken({ 'llama.block_count': 32, 'llama.attention.head_count_kv': 8, 'llama.attention.head_count': 32, 'llama.embedding_length': 4096 }))
      .toBe(32 * 8 * (128 + 128) * 2);
    expect(kvBytesPerToken({ 'g.block_count': 2, 'g.attention.head_count_kv': [4, 8], 'g.attention.key_length': 64, 'g.attention.value_length': 64 }))
      .toBe(2 * 8 * 128 * 2);
  });

  test('a report without the layout gives null, never a guess', () => {
    expect(kvBytesPerToken(null)).toBeNull();
    expect(kvBytesPerToken({ 'x.context_length': 4096 })).toBeNull();
  });
});

describe('what a window costs on the card, against the measured truth', () => {
  for (const [window, mib] of Object.entries(MEASURED)) {
    test(`${window} tokens: at least the measured ${mib} MiB, within 10% above it`, () => {
      const sized = gpuBytesAt(Number(window), model) / MIB;
      expect(sized).toBeGreaterThanOrEqual(mib);
      expect(sized).toBeLessThanOrEqual(mib * 1.1);
    });
  }
});

describe('the room a model may take', () => {
  test('free memory less the headroom the desktop needs: 1.5 GB, or a tenth of a large card', () => {
    expect(gpuRoomBytes({ freeBytes: 10 * GIB, totalBytes: 12 * GIB })).toBe(8.5 * GIB);
    expect(gpuRoomBytes({ freeBytes: 90 * GIB, totalBytes: 96 * GIB })).toBeCloseTo(90 * GIB - 9.6 * GIB, -3);
  });

  test('the operator budget (NEUMA_MODEL_BUDGET_GB) caps the card as if it were that size', () => {
    expect(gpuRoomBytes({ freeBytes: 24 * GIB, totalBytes: 96 * GIB, budgetGB: 12 })).toBe(10.5 * GIB);
  });

  test('a card whose free memory is unread is sized by its total; an unread card gives null', () => {
    expect(gpuRoomBytes({ totalBytes: 8 * GIB })).toBe(6.5 * GIB);
    expect(gpuRoomBytes({})).toBeNull();
  });

  test('a card fuller than the headroom has no room, never a negative', () => {
    expect(gpuRoomBytes({ freeBytes: 1 * GIB, totalBytes: 12 * GIB })).toBe(0);
  });
});

describe('the window served', () => {
  test('a 12 GB laptop card serves the 4B at 32,768 tokens, wholly on the card, and says how much it takes', () => {
    const fit = fitOllamaWindow({ roomBytes: gpuRoomBytes({ freeBytes: 10.8 * GIB, totalBytes: 12 * GIB }), ...model });
    expect(fit).toMatchObject({ window: OLLAMA_SERVED_CONTEXT, onGpu: true });
    expect(fit.needBytes).toBeLessThan(5 * GIB);
    expect(fit.line).toMatch(/32,768-token window: about 4\.7 GB of the 9\.3 GB/);
  });

  test('the window steps down only as far as the card needs, never below the floor that holds a being whole', () => {
    const at = (gib) => fitOllamaWindow({ roomBytes: gib * GIB, ...model }).window;
    expect(at(4.75)).toBe(32768);
    expect(at(4.5)).toBe(24576);
    expect(at(4.25)).toBe(OLLAMA_WINDOW_FLOOR);
    expect(OLLAMA_WINDOW_FLOOR).toBeGreaterThan(17_022);
  });

  test('a card that cannot hold even the floor keeps the floor, says part runs on the processor, and cuts nothing', () => {
    const fit = fitOllamaWindow({ roomBytes: gpuRoomBytes({ freeBytes: 5 * GIB, totalBytes: 6 * GIB }), ...model });
    expect(fit).toMatchObject({ window: OLLAMA_WINDOW_FLOOR, onGpu: false });
    expect(fit.line).toMatch(/part of it runs on the processor/);
    expect(fit.line).toMatch(/nothing the being says is cut/);
  });

  test('an unread card is served the usual window, and says it could not read the card', () => {
    const fit = fitOllamaWindow({ roomBytes: null, ...model });
    expect(fit).toMatchObject({ window: OLLAMA_SERVED_CONTEXT, onGpu: null });
    expect(fit.line).toMatch(/could not be read/);
  });

  test('the usual window is never more than the 65,536 it replaced, and never the 262,144 the name table gives the 4B', () => {
    expect(OLLAMA_SERVED_CONTEXT).toBeLessThan(65536);
    expect(fitOllamaWindow({ roomBytes: 1000 * GIB, ...model }).window).toBe(OLLAMA_SERVED_CONTEXT);
  });
});
