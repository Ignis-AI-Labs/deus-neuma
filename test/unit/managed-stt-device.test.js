// Where dictation runs on an installed app (managed-stt-device.js): the graphics card only where the
// speech model fits beside the house's model, else the processor; and the machine read behind it
// (managed-stt-probe.js) on real nvidia-smi text and this machine's real folders. No mocks.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CUDA13_DRIVER_MIN, STT_GPU_BYTES, sttDeviceFor } from '../../backend/services/managed-stt-device.js';
import { findCudaLibDir, parseNvidiaCard } from '../../backend/services/managed-stt-probe.js';

const GIB = 1024 ** 3;
const card = (totalGB, freeGB, driverMajor = 590) => ({ vendor: 'nvidia', totalBytes: totalGB * GIB, freeBytes: freeGB * GIB, driverMajor });
const ready = { build: true, cudaLibDir: '/lib/cuda13' };

describe('sttDeviceFor', () => {
  it('a 12 GB card running a 27B model keeps dictation on the processor, even before the model loads', () => {
    const house = 10.84 * GIB; // Qwen3.8-27B IQ3_XXS
    expect(sttDeviceFor({ ...ready, gpu: card(12, 11.5), houseBytes: house }).device).toBe('processor');
    expect(sttDeviceFor({ ...ready, gpu: card(12, 0.85), houseBytes: house }).device).toBe('processor');
  });

  it('a 24 GB card running the same model has room for both', () => {
    expect(sttDeviceFor({ ...ready, gpu: card(24, 12), houseBytes: 10.84 * GIB }).device).toBe('gpu');
  });

  it('with the house model unknown, only a large card with free room takes it', () => {
    expect(sttDeviceFor({ ...ready, gpu: card(16, 15), houseBytes: null }).device).toBe('processor');
    expect(sttDeviceFor({ ...ready, gpu: card(96, 22), houseBytes: null }).device).toBe('gpu');
    expect(sttDeviceFor({ ...ready, gpu: card(96, 2), houseBytes: null }).device).toBe('processor');
  });

  it('never the card without a build, an NVIDIA card, a CUDA 13 driver and its libraries', () => {
    const big = card(96, 60);
    expect(sttDeviceFor({ ...ready, build: false, gpu: big }).reason).toMatch(/no graphics-card build/);
    expect(sttDeviceFor({ ...ready, gpu: null }).reason).toMatch(/no NVIDIA/);
    expect(sttDeviceFor({ ...ready, gpu: { ...big, vendor: 'amd' } }).device).toBe('processor');
    expect(sttDeviceFor({ ...ready, gpu: card(96, 60, CUDA13_DRIVER_MIN - 1) }).reason).toMatch(/older than 580/);
    expect(sttDeviceFor({ ...ready, cudaLibDir: null, gpu: big }).reason).toMatch(/CUDA 13 runtime/);
  });

  it('the model always has to fit the card as it stands now', () => {
    expect(sttDeviceFor({ ...ready, gpu: card(48, STT_GPU_BYTES / GIB + 0.5), houseBytes: 1 * GIB }).device).toBe('processor');
  });
});

describe('the machine read', () => {
  it('reads nvidia-smi as it prints', () => {
    expect(parseNvidiaCard('24354, 97887, 615.71.09\n')).toEqual({
      vendor: 'nvidia', freeBytes: 24354 * 1024 * 1024, totalBytes: 97887 * 1024 * 1024, driverMajor: 615,
    });
    expect(parseNvidiaCard('')).toBeNull();
    expect(parseNvidiaCard('[N/A], 0, 550.1')).toBeNull();
  });

  it('finds the CUDA 13 runtime only in a folder holding all three libraries', () => {
    expect(findCudaLibDir(['/nonexistent'])).toBeNull();
    const ollama = '/usr/local/lib/ollama/cuda_v13';
    if (fs.existsSync(`${ollama}/libcublasLt.so.13`)) expect(findCudaLibDir(['/nonexistent', ollama])).toBe(ollama);
    expect(findCudaLibDir(['/usr/local/lib/ollama/cuda_v12'])).toBeNull(); // CUDA 12 names, not 13
  });
});
