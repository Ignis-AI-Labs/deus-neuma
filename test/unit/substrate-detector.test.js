/**
 * Substrate detector — against THIS machine, with no mocks (#390 tranche 6).
 *
 * This file mocked `os` and `child_process` to fabricate a machine ([…], 128 GB, an RTX 5090) and then asserted the detector
 * reported that machine back. So it proved the mock agreed with itself, and
 * a detector that had stopped reading the host entirely would have passed.
 *
 * Two of the three mocks were also stale. `child_process` has not been an
 * import of substrate-detector.js since the GPU probe moved to gpu-probe.js
 * (2026-08-02, the AMD fix) — it was mocking a module the code under test no
 * longer loads. And `llm-selection` was mocked for `getActiveModel`, which
 * the detector no longer calls either; it reads the served key through
 * `activeServedModelKey`.
 *
 * Now: the real `os`, the real GPU probe against the real machine, and the
 * real config seam. Nothing about the host is asserted as a literal — every
 * hardware claim is a RELATIONSHIP to what `os` itself reports, which is what
 * makes it both true and portable. The GPU parsers are pure and exported, so
 * their edge cases (including "no GPU") are proven with real inputs rather
 * than by pretending a probe failed.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import os from 'os';
import { getSubstrateProfile, formatSubstrateForPrompt } from '../../backend/services/substrate-detector.js';
import { parseNvidiaSmi, parseAmdSysfs, detectGpu } from '../../backend/services/gpu-probe.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { closedProviderEndpoint } from '../helpers/local-provider.js';

const previousConfig = getConfig();
afterAll(() => setConfig(previousConfig));

describe('getSubstrateProfile — reports the real host', () => {
  beforeEach(() => setConfig(previousConfig));

  test('every hardware field matches what os itself reports', async () => {
    const profile = await getSubstrateProfile();

    expect(profile.cpu.model).toBe(os.cpus()[0]?.model || 'Unknown');
    expect(profile.cpu.cores).toBe(os.cpus().length);
    expect(profile.cpu.arch).toBe(os.arch());

    expect(profile.memory.totalGB).toBe(Math.round(os.totalmem() / 1024 ** 3));

    expect(profile.platform.os).toBe(os.platform());
    expect(profile.platform.hostname).toBe(os.hostname());
    expect(profile.platform.version).toBe(os.version());
  });

  test('the GPU field is whatever the real probe finds — null or a real card', async () => {
    const profile = await getSubstrateProfile();
    const probed = await detectGpu();

    expect(profile.gpu).toEqual(probed);
    if (profile.gpu !== null) {
      // A card was really found: it must be described, never half-described.
      expect(typeof profile.gpu.name).toBe('string');
      expect(profile.gpu.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(profile.gpu.vramGB)).toBe(true);
      expect(profile.gpu.vramGB).toBeGreaterThan(0);
      expect(typeof profile.gpu.vendor).toBe('string');
    }
  });

  test('a found card is probed once per process; every caller gets the same frozen record', async () => {
    const first = await detectGpu();
    const [a, b] = await Promise.all([detectGpu(), detectGpu()]);
    if (first === null) {
      expect(a).toBeNull(); // no card here: a miss is never remembered, each ask probes
      return;
    }
    expect(a).toBe(first);
    expect(b).toBe(first);
    expect(Object.isFrozen(first)).toBe(true); // a fresh probe would be a new object
  });

  test('the profile is frozen', async () => {
    const profile = await getSubstrateProfile();
    expect(() => { profile.cpu = {}; }).toThrow();
  });

  test('the llm section reflects the real config', async () => {
    setConfig({ provider: 'lm-studio', model: 'qwen3-32b', endpoint: 'http://localhost:1234' });
    const profile = await getSubstrateProfile();
    expect(profile.llm.provider).toBe('lm-studio');
    expect(profile.llm.endpoint).toBe('http://localhost:1234');
    // The served-model channel carries the model KEY, never a display name
    // (selection truth, 02ca1fc48). With no llama-server serving, the resting
    // fallback is cfg.model.
    expect(profile.llm.model).toBe('qwen3-32b');
  });

  test('an unreachable provider still yields a profile, falling back to the configured model', async () => {
    // A really-closed port, not a stub told to reject. The detector must not
    // let a dead conduit take the hardware profile down with it.
    const { endpoint } = await closedProviderEndpoint();
    setConfig({ provider: 'lm-studio', model: 'qwen3-32b', endpoint });

    const profile = await getSubstrateProfile();
    expect(profile.llm.model).toBe('qwen3-32b');
    expect(profile.cpu.cores).toBe(os.cpus().length);
    expect(profile.memory.totalGB).toBeGreaterThan(0);
  });
});

describe('the GPU parsers — pure, so real inputs are the whole proof', () => {
  const RAM = 128 * 1024 ** 3;

  test('a dedicated NVIDIA card parses to name and VRAM', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 5090, 32768', RAM))
      .toEqual({ name: 'NVIDIA GeForce RTX 5090', vramGB: 32, unified: false, vendor: 'nvidia' });
  });

  test('unified-memory silicon reports system RAM, never NaN', () => {
    // GB10/Jetson answer "[N/A]" for memory.total because GPU memory IS
    // system memory. The old failure here rendered "NaN GB" to the operator.
    const parsed = parseNvidiaSmi('NVIDIA GB10, [N/A]', RAM);
    expect(parsed.unified).toBe(true);
    expect(parsed.vramGB).toBe(128);
    expect(Number.isNaN(parsed.vramGB)).toBe(false);
  });

  test('no output — the real "no GPU" case — is null, not a fabricated card', () => {
    // This is what […] actually
    // means. It needs no mocked exec failure: an empty stdout IS the failure.
    expect(parseNvidiaSmi('', RAM)).toBeNull();
    expect(parseNvidiaSmi(undefined, RAM)).toBeNull();
    expect(parseNvidiaSmi('   \n', RAM)).toBeNull();
    expect(parseNvidiaSmi(',,,', RAM)).toBeNull();
  });

  test('an AMD card is detected from sysfs — the fix that made Radeon rigs visible', () => {
    const parsed = parseAmdSysfs({
      vendor: '0x1002', vramBytes: String(24 * 1024 ** 3),
      productName: 'Radeon RX 7900 XTX', cardLabel: 'card0',
    });
    expect(parsed.vendor).toBe('amd');
    expect(parsed.vramGB).toBe(24);
    expect(parsed.name).toContain('Radeon');
  });

  test('a non-AMD vendor id is not claimed as AMD', () => {
    expect(parseAmdSysfs({ vendor: '0x10de', vramBytes: '1000', productName: 'x' })).toBeNull();
    expect(parseAmdSysfs({})).toBeNull();
  });
});

describe('formatSubstrateForPrompt', () => {
  test('formats a profile with a GPU', () => {
    const result = formatSubstrateForPrompt({
      cpu: { model: 'AMD Ryzen 9 7950X', cores: 24, arch: 'x64' },
      gpu: { name: 'NVIDIA GeForce RTX 5090', vramGB: 32 },
      memory: { totalGB: 128 },
      platform: { os: 'linux', version: '#1', hostname: 'test' },
      llm: { provider: 'lm-studio', model: 'Qwen3-32B', endpoint: 'http://localhost:1234' },
    });

    expect(result).toContain('Platform: linux (x64)');
    expect(result).toContain('CPU: AMD Ryzen 9 7950X (24 cores)');
    expect(result).toContain('RAM: 128GB');
    expect(result).toContain('GPU: NVIDIA GeForce RTX 5090 (32GB VRAM)');
    expect(result).toContain('LLM: Qwen3-32B via lm-studio');
  });

  test('formats a profile without a GPU', () => {
    const result = formatSubstrateForPrompt({
      cpu: { model: 'Intel i7-12700K', cores: 12, arch: 'x64' },
      gpu: null,
      memory: { totalGB: 32 },
      platform: { os: 'win32', version: 'Windows 11', hostname: 'desktop' },
      llm: { provider: 'ollama', model: 'llama3', endpoint: 'http://localhost:11434' },
    });

    expect(result).toContain('Platform: win32 (x64)');
    expect(result).toContain('CPU: Intel i7-12700K (12 cores)');
    expect(result).toContain('RAM: 32GB');
    expect(result).not.toContain('GPU:');
    expect(result).toContain('LLM: llama3 via ollama');
  });

  test('the REAL profile of this machine formats without holes', async () => {
    // The pure cases above use hand-built inputs, which is fine — they are
    // pure. This one closes the loop: the shape the detector really produces
    // is a shape the formatter really handles.
    const line = formatSubstrateForPrompt(await getSubstrateProfile());
    expect(line).toContain(`Platform: ${os.platform()}`);
    expect(line).toContain(`(${os.cpus().length} cores)`);
    expect(line).not.toContain('undefined');
    expect(line).not.toContain('NaN');
  });

  test('returns empty string for a null substrate', () => {
    expect(formatSubstrateForPrompt(null)).toBe('');
    expect(formatSubstrateForPrompt(undefined)).toBe('');
  });

  test('appends the measured parallel capacity when a scan is passed', () => {
    const substrate = {
      cpu: { model: 'x', cores: 8, arch: 'x64' }, gpu: null, memory: { totalGB: 64 },
      platform: { os: 'linux', version: '#1', hostname: 'h' },
      llm: { provider: 'lm-studio', model: 'qwen', endpoint: 'e' },
    };
    const withCap = formatSubstrateForPrompt(substrate, { ceiling: 3, boundClass: 'A', runAt: '2026-07-04T00:00:00Z' });
    expect(withCap).toContain('LLM: qwen via lm-studio');
    expect(withCap).toContain('about 3 of you working in parallel');
  });

  test('omits capacity honestly when unmeasured', () => {
    const substrate = {
      cpu: { model: 'x', cores: 8, arch: 'x64' }, gpu: null, memory: { totalGB: 64 },
      platform: { os: 'linux', version: '#1', hostname: 'h' },
      llm: { provider: 'lm-studio', model: 'qwen', endpoint: 'e' },
    };
    expect(formatSubstrateForPrompt(substrate, null)).not.toContain('Parallel capacity');
    expect(formatSubstrateForPrompt(substrate)).not.toContain('Parallel capacity');
  });
});
