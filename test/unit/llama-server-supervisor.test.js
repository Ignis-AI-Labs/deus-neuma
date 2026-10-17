import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  resolveServingLaunchConfig, servingLaunchArguments, activeLaunchConfig, selectSubstrateModel,
  shouldRelight, RELIGHT_WINDOW_MS, RELIGHT_MAX, projectSupervisorFailure,
  startSupervised, supervisorStatus, withDiscoveredProjector,
} from '../../backend/services/llama-server-supervisor.js';
// The memoized projector lives in its domain now (model-catalog, size law).
import { projectorMemoHit, PROJECTOR_NULL_TTL_MS } from '../../backend/services/model-catalog.js';
import { SERVING_CACHE_RAM_MIB, SERVING_PARALLEL_SLOTS, SERVING_SERVER_SLOTS } from '../../backend/services/serving-launch-config.js';

// The spawn/stop/health path is proven by integration against the real binary
// (RULE 0 — see the supervisor proof); these cover the pure launch planning.

// The served-truth chain reads the spawn's persisted claim — isolate it or
// the test machine's OWN live llama-server claim steers every launch plan.
let savedClaimDir;
beforeEach(() => {
  savedClaimDir = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-claims-'));
});
afterEach(() => {
  if (savedClaimDir === undefined) delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  else process.env.NEUMA_SUBSTRATE_CLAIM_DIR = savedClaimDir;
});

describe('resolveServingLaunchConfig', () => {
  test('raw environment and legacy directory adapter sources are ignored', () => {
    const cfg = resolveServingLaunchConfig({
      NEUMA_ADAPTERS_DIR: '/raw/registry',
      LLAMA_SERVER_LORAS: '/raw/a.gguf,/raw/b.gguf',
    });
    expect(cfg.loras).toEqual([]);
    expect(cfg).not.toHaveProperty('adaptersDir');
  });

  test('active config carries the exact serving key but no unstaged adapters', () => {
    const cfg = activeLaunchConfig({
      SUBSTRATE_MODEL: 'gemma-4-31b',
      LLAMA_SERVER_MODEL: '/models/gemma-4-31b.gguf',
      LLAMA_SERVER_LORAS: '/raw/adapter.gguf',
    });
    expect(cfg.servingModel).toBe('gemma-4-31b');
    expect(cfg.loras).toEqual([]);
  });

  test('parses url host/port and normalizes localhost to 127.0.0.1', () => {
    const cfg = resolveServingLaunchConfig({ LLAMA_SERVER_URL: 'http://localhost:8089' });
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(8089);
  });

  test('keeps an explicit ip host', () => {
    const cfg = resolveServingLaunchConfig({ LLAMA_SERVER_URL: 'http://127.0.0.1:9001' });
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(9001);
  });

  test('LLAMA_SERVER_LORAS cannot reach launch arguments', () => {
    const cfg = resolveServingLaunchConfig({ LLAMA_SERVER_LORAS: ' /a.gguf , /b.gguf ,' });
    expect(servingLaunchArguments(cfg)).not.toContain('--lora');
  });

  test('disableCudaGraphs defaults true, off only when explicitly "0"', () => {
    expect(resolveServingLaunchConfig({}).disableCudaGraphs).toBe(true);
    expect(resolveServingLaunchConfig({ GGML_CUDA_DISABLE_GRAPHS: '0' }).disableCudaGraphs).toBe(false);
  });

  test('disableCudaFusion defaults true (the Jul 22 abort lived in the fusion kernel), off only when explicitly "0"', () => {
    expect(resolveServingLaunchConfig({}).disableCudaFusion).toBe(true);
    expect(resolveServingLaunchConfig({ GGML_CUDA_DISABLE_FUSION: '0' }).disableCudaFusion).toBe(false);
  });

  test('mmproj comes from LLAMA_SERVER_MMPROJ, empty without it', () => {
    expect(resolveServingLaunchConfig({}).mmproj).toBe('');
    expect(resolveServingLaunchConfig({ LLAMA_SERVER_MMPROJ: '/p/mmproj-m-f16.gguf' }).mmproj).toBe('/p/mmproj-m-f16.gguf');
  });

  test('rejects a malformed endpoint instead of silently changing its authority', () => {
    expect(() => resolveServingLaunchConfig({ LLAMA_SERVER_URL: 'not a url' }))
      .toThrow('LLAMA_SERVER_URL must be an exact loopback HTTP endpoint with a port');
  });
});


describe('shouldRelight — the crash-relight decision', () => {
  const NOW = 1_700_000_000_000;

  test('a deliberate stop never relights — idle-unload and the forge stay honored', () => {
    expect(shouldRelight({ deliberate: true, recent: [], now: NOW })).toBe(false);
  });

  test('a crash relights while under the cap', () => {
    expect(shouldRelight({ deliberate: false, recent: [], now: NOW })).toBe(true);
    expect(shouldRelight({ deliberate: false, recent: [NOW - 60_000], now: NOW })).toBe(true);
  });

  test('at the cap inside the window it stands down — no boot-looping a poisoned launch', () => {
    const recent = Array.from({ length: RELIGHT_MAX }, (_, i) => NOW - (i + 1) * 1000);
    expect(shouldRelight({ deliberate: false, recent, now: NOW })).toBe(false);
  });

  test('relights outside the window expire — a crash tomorrow is not punished for one today', () => {
    const recent = Array.from({ length: RELIGHT_MAX }, () => NOW - RELIGHT_WINDOW_MS - 1000);
    expect(shouldRelight({ deliberate: false, recent, now: NOW })).toBe(true);
  });
});

describe('projectSupervisorFailure', () => {
  test('projects bounded public codes without paths or raw process output', () => {
    const projected = projectSupervisorFailure({
      code: 'process-exited',
      error: 'child failed at /private/path — raw stderr',
      detail: { model: '/private/model.gguf' },
      at: '2026-08-13T00:00:00.000Z',
    });
    expect(projected).toEqual({
      code: 'process-exited',
      message: 'The local substrate process exited unexpectedly.',
      at: '2026-08-13T00:00:00.000Z',
    });
    expect(JSON.stringify(projected)).not.toContain('/private');
    expect(JSON.stringify(projected)).not.toContain('stderr');
  });

  test('normalizes unknown internal failures to one stable public code', () => {
    expect(projectSupervisorFailure({ code: 'untrusted', error: 'secret' })).toEqual({
      code: 'spawn-failed',
      message: 'The local substrate process could not start.',
      at: null,
    });
  });
});

describe('servingLaunchArguments', () => {
  test('emits model, ctx, full offload, host/port, metrics, and the gemma-4 serving-law flags', () => {
    const args = servingLaunchArguments(resolveServingLaunchConfig({
      LLAMA_SERVER_MODEL: '/m.gguf', LLAMA_SERVER_URL: 'http://127.0.0.1:8089', SUBSTRATE_CONTEXT_LENGTH: '4096',
    }));
    expect(args).toEqual(['--model', '/m.gguf', '-c', '4096', '-ngl', '999', '--cache-ram', String(SERVING_CACHE_RAM_MIB), '--parallel', String(SERVING_SERVER_SLOTS), '--kv-unified', '--host', '127.0.0.1', '--port', '8089', '--metrics', '--jinja', '--reasoning', 'auto']);
    // Founder's law 2026-08-15: reasoning a model has is ON by default — 'auto'
    // lets the model's own template decide; nothing here may pin it off.
    expect(args.slice(args.indexOf('--reasoning'))).toEqual(['--reasoning', 'auto']);
    // The host-cache law: OFF (0) since 2026-10-13 — the RAM cache re-seated every warm chat
    // (serving-cache-ram.test.js names the measurement); never -1, the 116 GB OOM.
    expect(args.slice(args.indexOf('--cache-ram'), args.indexOf('--cache-ram') + 2)).toEqual(['--cache-ram', '0']);
    // The pool law: slots NEVER partition the window — --parallel above 1 is
    // only lawful beside --kv-unified, or a lone being gets a quarter-window.
    expect(SERVING_PARALLEL_SLOTS).toBeGreaterThanOrEqual(1);
    // Six hold, four run (2026-10-14): the server parks more chats than the
    // line runs at once — never fewer, or the line would queue inside it.
    expect(SERVING_SERVER_SLOTS).toBeGreaterThanOrEqual(SERVING_PARALLEL_SLOTS);
    expect(args.indexOf('--kv-unified')).toBe(args.indexOf('--parallel') + 2);
  });

  test('never puts a LoRA on the serving argv — Voice Pack replaced them', () => {
    const cfg = resolveServingLaunchConfig({ LLAMA_SERVER_MODEL: '/private/model' });
    const args = servingLaunchArguments({ ...cfg, loras: ['/private/adapter-a', '/private/adapter-b'] });
    expect(args.slice(0, 2)).toEqual(['--model', '/private/model']);
    expect(args).not.toContain('--lora-init-without-apply');
    expect(args).not.toContain('--lora-scaled');
    expect(args).not.toContain('--lora');
  });

  test('omits the init-without-apply flag when there are no adapters', () => {
    const args = servingLaunchArguments(resolveServingLaunchConfig({ LLAMA_SERVER_MODEL: '/m.gguf' }));
    expect(args).not.toContain('--lora-init-without-apply');
    expect(args).not.toContain('--lora-scaled');
  });

  test('a projector rides beside the model in argv — no LoRA after it', () => {
    const cfg = resolveServingLaunchConfig({
      LLAMA_SERVER_MODEL: '/private/model',
      LLAMA_SERVER_MMPROJ: '/p/mmproj-m-f16.gguf',
    });
    const args = servingLaunchArguments({ ...cfg, loras: ['/private/adapter'] });
    expect(args.slice(0, 4)).toEqual(['--model', '/private/model', '--mmproj', '/p/mmproj-m-f16.gguf']);
    expect(args).not.toContain('--lora-scaled');
  });

  test('no projector configured → no --mmproj flag', () => {
    const args = servingLaunchArguments(resolveServingLaunchConfig({ LLAMA_SERVER_MODEL: '/m.gguf' }));
    expect(args).not.toContain('--mmproj');
  });
});

describe('activeLaunchConfig projector discovery (real disk)', () => {
  test('pairs a projector riding beside the configured model; explicit env wins', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-mmproj-'));
    const model = path.join(dir, 'm-Q8_0.gguf');
    const projector = path.join(dir, 'mmproj-m-BF16.gguf');
    fs.writeFileSync(model, '');
    fs.writeFileSync(projector, '');

    const discovered = activeLaunchConfig({ LLAMA_SERVER_MODEL: model });
    expect(discovered.mmproj).toBe(projector);

    const explicit = activeLaunchConfig({ LLAMA_SERVER_MODEL: model, LLAMA_SERVER_MMPROJ: '/elsewhere/mmproj-other.gguf' });
    expect(explicit.mmproj).toBe('/elsewhere/mmproj-other.gguf');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a rig with no projector serves blind — mmproj stays empty, no throw', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-mmproj-'));
    const model = path.join(dir, 'm-Q8_0.gguf');
    fs.writeFileSync(model, '');
    const cfg = activeLaunchConfig({ LLAMA_SERVER_MODEL: model, NEUMA_MODELS_DIRS: '/definitely/not/here' });
    expect(cfg.mmproj).toBe('');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a model switch re-pairs the projector — the memo keys on the model, never sticks', () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-mmproj-a-'));
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-mmproj-b-'));
    const modelA = path.join(dirA, 'alpha.gguf');
    const modelB = path.join(dirB, 'beta.gguf');
    const projA = path.join(dirA, 'mmproj-alpha-f16.gguf');
    const projB = path.join(dirB, 'mmproj-beta-f16.gguf');
    fs.writeFileSync(modelA, ''); fs.writeFileSync(projA, '');
    fs.writeFileSync(modelB, ''); fs.writeFileSync(projB, '');
    const env = { LLAMA_SERVER_MODEL: modelA };

    expect(activeLaunchConfig(env).mmproj).toBe(projA);
    // The witness ignites another cataloged model — its OWN projector must ride.
    selectSubstrateModel(modelB, 'beta');
    expect(activeLaunchConfig(env).mmproj).toBe(projB);
    selectSubstrateModel(null); // restore the resting truth for later tests
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });
});

describe('withDiscoveredProjector — the last gate\'s fail-safe (#529, real disk)', () => {
  // The 2026-09-13 incident: a bench night-run spread activeLaunchConfig and
  // then set mmproj:'' before relighting the house serving — the supervisor
  // obeyed and the house went blind on a vision model. The gate now repairs
  // a projector-less BASE-ONLY config instead of obeying it.
  const rig = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-failsafe-'));
    const model = path.join(dir, 'm-Q8_0.gguf');
    const projector = path.join(dir, 'mmproj-m-BF16.gguf');
    fs.writeFileSync(model, '');
    fs.writeFileSync(projector, '');
    return { dir, model, projector };
  };

  test('a base-only blind config gains the projector — and the argv carries it', () => {
    const { dir, model, projector } = rig();
    const blind = { ...resolveServingLaunchConfig({ LLAMA_SERVER_MODEL: model }), mmproj: '' };
    const repaired = withDiscoveredProjector(blind, {});
    expect(repaired.mmproj).toBe(projector);
    expect(servingLaunchArguments(repaired)).toContain('--mmproj');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a lineage-supervised launch is NEVER filled — the text-only authority law stands', () => {
    const { dir, model } = rig();
    const lineage = {
      ...resolveServingLaunchConfig({ LLAMA_SERVER_MODEL: model }),
      servingModel: 'abc123/committed-tuple',
    };
    expect(withDiscoveredProjector(lineage, {}).mmproj).toBe('');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('an explicit projector passes through untouched', () => {
    const { dir, model } = rig();
    const explicit = resolveServingLaunchConfig({
      LLAMA_SERVER_MODEL: model, LLAMA_SERVER_MMPROJ: '/elsewhere/mmproj-other.gguf',
    });
    expect(withDiscoveredProjector(explicit, {}).mmproj).toBe('/elsewhere/mmproj-other.gguf');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a rig with no projector still serves blind — the gate invents nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-failsafe-blind-'));
    const model = path.join(dir, 'm-Q8_0.gguf');
    fs.writeFileSync(model, '');
    const cfg = resolveServingLaunchConfig({ LLAMA_SERVER_MODEL: model });
    expect(withDiscoveredProjector(cfg, { NEUMA_MODELS_DIRS: '/definitely/not/here' }).mmproj).toBe('');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('projectorMemoHit (pure boundary)', () => {
  test('a found pairing sticks for the life of the key', () => {
    const entry = { key: 'k', value: '/p.gguf', at: 1000 };
    expect(projectorMemoHit(entry, 'k', 1000 + 86_400_000)).toBe(true);
  });

  test('a null pairing answers inside the TTL, expires past it, and a wrong key never hits', () => {
    const entry = { key: 'k', value: null, at: 1000 };
    expect(projectorMemoHit(entry, 'k', 1000 + PROJECTOR_NULL_TTL_MS - 1)).toBe(true);
    expect(projectorMemoHit(entry, 'k', 1000 + PROJECTOR_NULL_TTL_MS + 1)).toBe(false);
    expect(projectorMemoHit(entry, 'other', 1000)).toBe(false);
    expect(projectorMemoHit({ key: null, value: null, at: 0 }, 'k', 1000)).toBe(false);
  });
});

describe('startSupervised failure visibility (real corridor, no spawn)', () => {
  // The pre-health corridor used to fail only into the fire-and-observe
  // .catch: the desk polled an ignition that showed nothing igniting and
  // nothing failed (witnessed 2026-08-14 and after the 2026-08-15 power-out
  // reboot). A real staging failure — a base model path with no file behind
  // it — must now land in the public lastError contract.
  test('a pre-health corridor failure lands in lastError, not only the log', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-refusal-'));
    const previousClaimDir = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = dir; // claim/log lanes stay off the live desk's registry
    try {
      const cfg = resolveServingLaunchConfig({
        LLAMA_SERVER_BIN: process.execPath,
        LLAMA_SERVER_MODEL: path.join(dir, 'never-staged.gguf'),
        LLAMA_SERVER_URL: 'http://127.0.0.1:1',
      });
      await expect(startSupervised(cfg, { waitMs: 1000 })).rejects.toThrow();
      const status = await supervisorStatus(cfg);
      expect(status.lastError).toMatchObject({ code: 'launch-refused' });
      expect(status.lastError.message).toContain('refused before start');
      expect(typeof status.lastError.at).toBe('string');
    } finally {
      if (previousClaimDir === undefined) delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
      else process.env.NEUMA_SUBSTRATE_CLAIM_DIR = previousClaimDir;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // #316's last blind spot: validatedServingLaunchConfig throws SYNCHRONOUSLY,
  // before the boot corridor's catch exists — that refusal must record too.
  test('a synchronous launch-validation throw records launch-not-ready', async () => {
    await expect(startSupervised({ not: 'a-launch-config' })).rejects.toThrow();
    const status = await supervisorStatus(resolveServingLaunchConfig({
      LLAMA_SERVER_BIN: process.execPath,
      LLAMA_SERVER_URL: 'http://127.0.0.1:1',
    }));
    expect(status.lastError).toMatchObject({ code: 'launch-not-ready' });
    expect(typeof status.lastError.at).toBe('string');
  });
});

