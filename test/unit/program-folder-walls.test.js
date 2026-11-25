import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { programFolderWallPaths } from '../../backend/services/program-folder-walls.js';
import { platformWallWriteReason, platformWriteWalls } from '../../backend/services/platform-write-walls.js';

const ROOT = path.join(os.tmpdir(), 'neuma-program-wall-proof');
const env = Object.freeze({
  COMFYUI_INSTALL_DIR: path.join(ROOT, 'ComfyUI'),
  COMFYUI_MODELS_DIR: path.join(ROOT, 'models'),
  COMFYUI_DATA_DIR: path.join(ROOT, 'data'),
  COMFYUI_OUTPUT_DIR: path.join(ROOT, 'output'),
  COMFYUI_EXTRA_MODEL_PATHS: path.join(ROOT, 'extra_model_paths.yaml'),
});

describe('PR20 F-02/M-19: executable and model stores are walled', () => {
  test('the registry names configured ComfyUI stores and Node global module folders', () => {
    expect(programFolderWallPaths(env)).toEqual(expect.arrayContaining([
      env.COMFYUI_INSTALL_DIR,
      env.COMFYUI_MODELS_DIR,
      env.COMFYUI_DATA_DIR,
      env.COMFYUI_EXTRA_MODEL_PATHS,
      path.join(os.homedir(), '.node_libraries'),
      path.join(os.homedir(), '.node_modules'),
      path.join(os.homedir(), '.ollama', 'models'),
    ]));
    expect(programFolderWallPaths({}).every((target) => path.isAbsolute(target))).toBe(true);
  });

  test.each([
    path.join(ROOT, 'ComfyUI', 'main.py'),
    path.join(ROOT, 'ComfyUI', '.venv', 'bin', 'python'),
    path.join(ROOT, 'models', 'unet', 'planted.safetensors'),
    path.join(ROOT, 'data', 'user', 'default.sqlite'),
    env.COMFYUI_EXTRA_MODEL_PATHS,
    path.join(os.homedir(), '.node_libraries', 'supports-color', 'index.js'),
    path.join(os.homedir(), '.node_modules', 'supports-color', 'index.js'),
    path.join(os.homedir(), '.ollama', 'models', 'blobs', 'sha256-abc'),
  ])('the real platform wall refuses %s', (target) => {
    expect(platformWallWriteReason(target, platformWriteWalls(env))).toContain("install's own state");
  });

  test('generated output and near-miss folders stay outside this wall', () => {
    const walls = platformWriteWalls(env);
    expect(platformWallWriteReason(path.join(env.COMFYUI_OUTPUT_DIR, 'image.png'), walls)).toBeNull();
    expect(platformWallWriteReason(path.join(ROOT, 'ComfyUI-backup', 'note.txt'), walls)).toBeNull();
  });
});
