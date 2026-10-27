/**
 * MANAGED OLLAMA PLAN — what the platform sets up for a person with no model server
 * (managed-ollama-plan.js, pure). The pinned build, the model name Ollama pulls, the steps
 * for each starting point, the disk check, and the pull-progress parser.
 */
import { describe, expect, test } from 'vitest';
import {
  OLLAMA_ALT_ENDPOINT, OLLAMA_ENDPOINT, OLLAMA_VERSION, humanBytes, installPlan, managedEndpoints, managedServeEnv, ollamaAssetFor,
  ollamaModelRef, ollamaPullable, pullProgress, setupDoneLine, versionAtLeast,
} from '../../backend/services/managed-ollama-plan.js';

const REC = Object.freeze({ model: 'Qwen3.8-4B (distilled)', quant: 'Q4_K_M', sizeGB: 2.8, source: 'empero-ai/Qwen3.8-4B-Distill-GGUF' });
const base = (over = {}) => ({
  platform: 'linux', arch: 'x64', recommendation: REC, running: { up: false, version: null, models: [] },
  system: null, managedInstalled: false, freeBytes: 100e9, ...over,
});

describe('the pinned Ollama build', () => {
  test('Linux and Windows on x64 have a pinned file with its SHA-256; nothing else does', () => {
    for (const [p, a] of [['linux', 'x64'], ['win32', 'x64']]) {
      const asset = ollamaAssetFor(p, a);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.size).toBeGreaterThan(100e6);
      expect(asset.url).toBe(`https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/${asset.name}`);
    }
    expect(ollamaAssetFor('linux', 'x64').bin).toBe('bin/ollama');
    expect(ollamaAssetFor('win32', 'x64').bin).toBe('ollama.exe');
    expect(ollamaAssetFor('darwin', 'arm64')).toBeNull();
    expect(ollamaAssetFor('linux', 'arm64')).toBeNull();
  });
});

describe('the model Ollama pulls', () => {
  test('a recommendation becomes hf.co/<repo>:<quant>', () => {
    expect(ollamaModelRef(REC)).toBe('hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF:Q4_K_M');
  });
  test('anything that is not a plain repo and quant is refused, never passed to a shell or URL', () => {
    expect(ollamaModelRef(null)).toBeNull();
    expect(ollamaModelRef({ ...REC, source: '../../etc' })).toBeNull();
    expect(ollamaModelRef({ ...REC, source: 'a/b; rm -rf /' })).toBeNull();
    expect(ollamaModelRef({ ...REC, quant: 'Q4 K' })).toBeNull();
  });
});

describe('the plan for each starting point', () => {
  test('nothing installed: download, unpack, start, pull', () => {
    const plan = installPlan(base());
    expect(plan.supported).toBe(true);
    expect(plan.server).toBe('download');
    expect(plan.steps.map((s) => s.id)).toEqual(['download', 'unpack', 'start', 'pull', 'verify']);
    expect(plan.managed).toBe(true);
    expect(plan.downloadBytes).toBe(ollamaAssetFor('linux', 'x64').size + 2.8e9);
    expect(plan.enoughDisk).toBe(true);
  });
  test('Ollama installed but stopped: start and pull, no download', () => {
    const plan = installPlan(base({ system: { bin: 'ollama', version: '0.41.0' } }));
    expect(plan.server).toBe('installed');
    expect(plan.managed).toBe(false);
    expect(plan.steps.map((s) => s.id)).toEqual(['start', 'pull', 'verify']);
  });
  test('Ollama running without the model: pull only', () => {
    const plan = installPlan(base({ running: { up: true, version: OLLAMA_VERSION, models: ['llama3:8b'] } }));
    expect(plan.server).toBe('running');
    expect(plan.endpoint).toBe(OLLAMA_ENDPOINT);
    expect(plan.steps.map((s) => s.id)).toEqual(['pull', 'verify']);
  });
  test('Ollama running with the model: nothing to download, only the answer check and adopt', () => {
    const plan = installPlan(base({ running: { up: true, version: OLLAMA_VERSION, models: ['hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF:Q4_K_M'] } }));
    expect(plan.steps.map((s) => s.id)).toEqual(['verify']);
    expect(plan.downloadBytes).toBe(0);
    expect(plan.model.ready).toBe(true);
    expect(plan.needBytes).toBe(0);
  });
  test('an outdated Ollama installed here is not used: the platform downloads its own, off its port, and says why', () => {
    // proven 2026-10-22: Ollama 0.24.0 could not load the recommended Qwen3.8 GGUF. Stopped now, its
    // own service can take the usual port at any boot, so the platform's never shares it
    const plan = installPlan(base({ system: { bin: '/usr/local/sbin/ollama', version: '0.24.0' } }));
    expect(plan.server).toBe('download');
    expect(plan.endpoint).toBe(OLLAMA_ALT_ENDPOINT);
    expect(plan.notes[0]).toMatch(/older Ollama \(0\.24\.0\).*too old/);
  });
  test('an outdated Ollama RUNNING on the usual port: the platform\'s own runs beside it on the next port', () => {
    const plan = installPlan(base({ running: { up: true, version: '0.24.0', models: [] }, system: { bin: 'ollama', version: '0.24.0' } }));
    expect(plan.server).toBe('download');
    expect(plan.endpoint).toBe(OLLAMA_ALT_ENDPOINT);
    expect(plan.notes[0]).toMatch(/running here, too old/);
  });
  test('a moved endpoint moves the platform\'s server and its next port; anything but loopback http is ignored', () => {
    expect(managedEndpoints()).toEqual({ usual: OLLAMA_ENDPOINT, alt: OLLAMA_ALT_ENDPOINT });
    const moved = managedEndpoints('http://localhost:47434/');
    expect(moved).toEqual({ usual: 'http://127.0.0.1:47434', alt: 'http://127.0.0.1:47435' });
    for (const bad of ['http://10.0.0.5:47434', 'https://127.0.0.1:47434', 'http://127.0.0.1:80', 'nonsense']) {
      expect(managedEndpoints(bad)).toEqual({ usual: OLLAMA_ENDPOINT, alt: OLLAMA_ALT_ENDPOINT });
    }
    expect(installPlan(base({ endpoints: moved })).endpoint).toBe('http://127.0.0.1:47434');
    expect(installPlan(base({ endpoints: moved, running: { up: true, version: '0.24.0', models: [] } })).endpoint).toBe('http://127.0.0.1:47435');
  });
  test('the platform\'s own server, up at its recorded address, is the one used: no download, no notes about others', () => {
    const own = { endpoint: OLLAMA_ALT_ENDPOINT, up: true, version: OLLAMA_VERSION, models: ['hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF:Q4_K_M'] };
    const plan = installPlan(base({ own, running: { up: true, version: '0.34.0', models: ['llama3:8b'] }, system: { bin: 'ollama', version: '0.34.0' }, managedInstalled: true }));
    expect(plan).toMatchObject({ server: 'running', managed: true, endpoint: OLLAMA_ALT_ENDPOINT, downloadBytes: 0, needBytes: 0 });
    expect(plan.steps.map((s) => s.id)).toEqual(['verify']);
    expect(plan.notes).toEqual([]);
  });
  test('the platform\'s own server on disk but stopped: started again at its recorded address, no download', () => {
    const own = { endpoint: 'http://127.0.0.1:47500', up: false, version: null, models: [] };
    const plan = installPlan(base({ own, managedInstalled: true }));
    expect(plan).toMatchObject({ server: 'managed', managed: true, endpoint: 'http://127.0.0.1:47500' });
    expect(plan.steps.map((s) => s.id)).toEqual(['start', 'pull', 'verify']);
  });
  test('an outdated Ollama answering at the platform\'s recorded address is never taken for its own', () => {
    const own = { endpoint: OLLAMA_ENDPOINT, up: true, version: '0.34.0', models: [] };
    const plan = installPlan(base({ own, running: own, managedInstalled: true }));
    expect(plan).toMatchObject({ server: 'managed', managed: true, endpoint: OLLAMA_ALT_ENDPOINT });
  });
  test('a running Ollama whose version cannot be read is not trusted either', () => {
    const plan = installPlan(base({ running: { up: true, version: null, models: [] } }));
    expect(plan.server).toBe('download');
    expect(plan.endpoint).toBe(OLLAMA_ALT_ENDPOINT);
  });
  test('versions compare as numbers, and an unreadable one never passes', () => {
    expect(versionAtLeast('0.40.7', '0.40.7')).toBe(true);
    expect(versionAtLeast('0.41.0', '0.40.7')).toBe(true);
    expect(versionAtLeast('0.9.0', '0.40.7')).toBe(false);
    expect(versionAtLeast('ollama version is 0.24.0', '0.40.7')).toBe(false);
    expect(versionAtLeast(null, '0.40.7')).toBe(false);
  });
  test('a full disk is said before anything downloads', () => {
    const plan = installPlan(base({ freeBytes: 2e9 }));
    expect(plan.enoughDisk).toBe(false);
    expect(plan.needBytes).toBeGreaterThan(2e9);
  });
  test('below the floor there is no model to set up, and the reason is the capacity check\'s own', () => {
    const plan = installPlan(base({ recommendation: { model: null, fit: 'insufficient', why: 'Below the recommended floor.' } }));
    expect(plan).toEqual({ supported: false, reason: 'Below the recommended floor.' });
  });
  test('an OS with no pinned build and no server is told to install one itself', () => {
    const plan = installPlan(base({ platform: 'darwin', arch: 'arm64' }));
    expect(plan.supported).toBe(false);
    expect(plan.reason).toMatch(/no Ollama build for darwin/);
  });
});

describe('a model Ollama cannot pull', () => {
  // proven 2026-10-22: hf.co/...:Q8_K_P is refused at the manifest ([…])
  const HOUSE = Object.freeze({
    model: 'Qwen3.8-27B Uncensored (HauhauCS)', quant: 'Q8_K_P', sizeGB: 32.4, source: 'HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF',
    options: [
      { model: 'Qwen3.8-27B Uncensored (HauhauCS)', quant: 'Q8_K_P', sizeGB: 32.4, source: 'HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF' },
      { model: 'Qwen3.8-27B (6-bit)', quant: 'Q6_K', sizeGB: 22.0, source: 'unsloth/Qwen3.8-27B-GGUF' },
    ],
  });
  test('the standard llama.cpp schemes are pullable; a custom one is not', () => {
    for (const q of ['Q4_K_M', 'Q6_K', 'Q8_0', 'IQ3_S', 'IQ3_XXS', 'BF16']) expect(ollamaPullable({ ...REC, quant: q })).toBe(true);
    expect(ollamaPullable({ ...REC, quant: 'Q8_K_P' })).toBe(false);
  });
  test('the next best pullable option is set up instead, and the person is told why', () => {
    const plan = installPlan(base({ recommendation: HOUSE }));
    expect(plan.model.ref).toBe('hf.co/unsloth/Qwen3.8-27B-GGUF:Q6_K');
    expect(plan.model.sizeGB).toBe(22.0);
    expect(plan.notes[0]).toMatch(/Q8_K_P.*cannot download.*next best: Qwen3\.8-27B \(6-bit\)/);
  });
  test('with no pullable option there is nothing to set up', () => {
    const plan = installPlan(base({ recommendation: { ...HOUSE, options: [HOUSE.options[0]] } }));
    expect(plan.supported).toBe(false);
  });
});

describe('pull progress', () => {
  test('a layer line carries its bytes; a status line carries none; an error is an error', () => {
    expect(pullProgress('{"status":"pulling 1a2b","total":200,"completed":50}')).toEqual({ status: 'pulling 1a2b', completed: 50, total: 200 });
    expect(pullProgress('{"status":"verifying sha256 digest"}')).toEqual({ status: 'verifying sha256 digest', completed: null, total: null });
    expect(pullProgress('{"error":"pull model manifest: file does not exist"}')).toEqual({ error: 'pull model manifest: file does not exist' });
    expect(pullProgress('not json')).toBeNull();
  });
  test('bytes read as a person reads them', () => {
    expect(humanBytes(2.8e9)).toBe('2.8 GB');
    expect(humanBytes(36_838_937)).toBe('37 MB');
    expect(humanBytes(0)).toBe('0 MB');
  });
});

describe("the platform's own server: what it is started with (2026-10-23)", () => {
  test('the fitted window as its default, one model and one slot', () => {
    expect(managedServeEnv({ window: 32768 })).toEqual({ OLLAMA_CONTEXT_LENGTH: '32768', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_NO_CLOUD: '1' });
  });

  test("Ollama's cloud models are off by default (prompts stay on this PC); the person's own setting stands", () => {
    expect(managedServeEnv({ window: 32768 }).OLLAMA_NO_CLOUD).toBe('1');
    expect(managedServeEnv({ window: 32768, env: { OLLAMA_NO_CLOUD: '0' } }).OLLAMA_NO_CLOUD).toBe('0');
  });

  test("the person's own slot and model settings stand", () => {
    expect(managedServeEnv({ window: 20480, env: { OLLAMA_NUM_PARALLEL: '2', OLLAMA_MAX_LOADED_MODELS: '3' } }))
      .toMatchObject({ OLLAMA_CONTEXT_LENGTH: '20480', OLLAMA_NUM_PARALLEL: '2', OLLAMA_MAX_LOADED_MODELS: '3' });
  });

  test('a card held by the driver guard is hidden from it: no CUDA device, no Vulkan', () => {
    expect(managedServeEnv({ window: 32768, holdGpu: true })).toMatchObject({ CUDA_VISIBLE_DEVICES: '-1', OLLAMA_VULKAN: '0' });
    expect(managedServeEnv({ window: 32768 })).not.toHaveProperty('CUDA_VISIBLE_DEVICES');
  });

  test("the plan carries the driver guard's words for the screen, and nothing when it has none", () => {
    const held = { hold: true, checked: true, line: 'The graphics driver here is 572.70 …', link: 'https://www.nvidia.com/en-us/drivers/' };
    expect(installPlan(base({ gpuGuard: held })).gpuDriver).toEqual(held);
    expect(installPlan(base({ gpuGuard: { hold: false, checked: true } })).gpuDriver).toBeNull();
    expect(installPlan(base()).gpuDriver).toBeNull();
  });
});

describe('an install downloads and never loads a model (2026-10-24)', () => {
  test('the installer plan has no answer check; the app plan keeps it', () => {
    expect(installPlan(base({ verify: false })).steps.map((s) => s.id)).toEqual(['download', 'unpack', 'start', 'pull']);
    expect(installPlan(base()).steps.at(-1).id).toBe('verify');
  });

  test('a machine already set up has nothing to do at install, not a hidden model load', () => {
    const ref = ollamaModelRef(REC);
    const running = { up: true, version: OLLAMA_VERSION, models: [ref] };
    expect(installPlan(base({ running, verify: false })).steps).toEqual([]);
  });

  test('the done line says downloaded, not answered, when nothing was loaded', () => {
    const line = setupDoneLine({ name: 'Qwen3.8-4B', version: '0.40.7', loaded: false, notes: [undefined, 'Update your driver.'] });
    expect(line).toContain('downloaded');
    expect(line).toContain('first opens');
    expect(line).toContain('Update your driver.');
    expect(setupDoneLine({ name: 'Qwen3.8-4B', version: '0.40.7', loaded: true })).toBe('Qwen3.8-4B is ready on Ollama 0.40.7.');
  });
});
