/**
 * The image-forge engine (ComfyUI) and the press's Chromium start from the
 * helper environment, never the backend's (security seat G7, audit
 * 2026-10-19). Both run content a being shaped — a workflow, a pressed page —
 * so a backend secret in their environment is one /proc read or one custom
 * node away from leaving. Pure builders on a real-shaped env; every secret
 * here is FAKE.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { comfyEngineEnvironment } from '../../backend/services/image-forge/comfyui-supervisor.js';
import { pressEnvironment } from '../../backend/services/doc-press/chromium-press.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SECRETS = Object.freeze({
  AUTH_SECRET: 'FAKE_auth_secret_for_test',
  DNA_ENCRYPTION_KEY: 'FAKE_dna_key_for_test',
  DEPLOYER_PRIVATE_KEY: '0xFAKEFAKEFAKE',
  OPENAI_API_KEY: 'sk-FAKE',
  ANTHROPIC_API_KEY: 'sk-ant-FAKE',
  NODE_OPTIONS: '--require /tmp/FAKE-preload.js',
});

// The shape a desk backend really runs with: session essentials, the npm
// toolchain on PATH, GPU and cache settings, the user bus, and the secrets.
const BACKEND_ENV = Object.freeze({
  HOME: '/home/op', USER: 'op', LANG: 'en_US.UTF-8', LC_NUMERIC: 'en_US.UTF-8', LANGUAGE: 'en_US',
  PATH: '/repo/node_modules/.bin:/usr/local/bin:/usr/bin',
  XDG_RUNTIME_DIR: '/run/user/1000', TMPDIR: '/var/tmp/op',
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
  CUDA_VISIBLE_DEVICES: '0', NVIDIA_DRIVER_CAPABILITIES: 'compute,utility',
  HF_HOME: '/mnt/models/hf', HUGGINGFACE_HUB_CACHE: '/mnt/models/hf/hub',
  PYTORCH_CUDA_ALLOC_CONF: 'expandable_segments:True', TORCH_HOME: '/mnt/models/torch',
  OMP_NUM_THREADS: '8', MKL_NUM_THREADS: '8', LD_LIBRARY_PATH: '/usr/local/cuda/lib64',
  COMFYUI_INSTALL_DIR: '/opt/comfy', FONTCONFIG_FILE: '/etc/fonts/fonts.conf',
  HTTPS_PROXY: 'http://proxy.local:3128',
  ...SECRETS,
});

const noSecretSurvives = (out) => {
  for (const key of Object.keys(SECRETS)) expect(out).not.toHaveProperty(key);
  for (const value of Object.values(SECRETS)) expect(Object.values(out)).not.toContain(value);
};

describe('comfyEngineEnvironment — the engine keeps its GPU stack, never the backend\'s secrets', () => {
  const out = comfyEngineEnvironment(BACKEND_ENV, 'linux');

  test('no backend secret survives', () => noSecretSurvives(out));

  test('the GPU, torch, model-cache, ComfyUI and user-bus keys survive unchanged', () => {
    for (const key of ['CUDA_VISIBLE_DEVICES', 'NVIDIA_DRIVER_CAPABILITIES', 'HF_HOME', 'HUGGINGFACE_HUB_CACHE',
      'PYTORCH_CUDA_ALLOC_CONF', 'TORCH_HOME', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'LD_LIBRARY_PATH',
      'COMFYUI_INSTALL_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'HOME', 'LANG', 'TMPDIR', 'HTTPS_PROXY']) {
      expect(out[key]).toBe(BACKEND_ENV[key]);
    }
  });

  test('the npm toolchain leaves PATH; the operator\'s own PATH stays', () => {
    expect(out.PATH).toBe('/usr/local/bin:/usr/bin');
  });

  test('the input is never mutated', () => {
    expect(BACKEND_ENV.AUTH_SECRET).toBe(SECRETS.AUTH_SECRET);
  });
});

describe('pressEnvironment — Chromium keeps only the essentials, fonts and locale', () => {
  const out = pressEnvironment(BACKEND_ENV, 'linux');

  test('no backend secret survives', () => noSecretSurvives(out));

  test('home, locale and font config survive', () => {
    for (const key of ['HOME', 'LANG', 'LC_NUMERIC', 'LANGUAGE', 'FONTCONFIG_FILE', 'XDG_RUNTIME_DIR', 'TMPDIR']) {
      expect(out[key]).toBe(BACKEND_ENV[key]);
    }
  });

  test('the GPU stack and the user bus are not the press\'s to hold', () => {
    for (const key of ['CUDA_VISIBLE_DEVICES', 'HF_HOME', 'LD_LIBRARY_PATH', 'COMFYUI_INSTALL_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
      expect(out).not.toHaveProperty(key);
    }
  });
});

// READ, not run: ComfyUI is a GPU engine another session drives, so this
// suite never launches it. What it can prove without a GPU is that the one
// spawn in the supervisor hands the child this builder's result.
describe('the ComfyUI spawn passes the builder\'s environment (read)', () => {
  test('the supervisor spawn carries env: comfyEngineEnvironment(process.env) and no raw process.env', () => {
    const src = readFileSync(path.join(REPO, 'backend/services/image-forge/comfyui-supervisor.js'), 'utf8');
    const spawnCall = src.slice(src.indexOf('spawn(launch.cmd'), src.indexOf('closeSync(logFd)'));
    expect(spawnCall).toContain('env: comfyEngineEnvironment(process.env)');
    expect(src).not.toMatch(/env:\s*process\.env\b/);
  });
});
