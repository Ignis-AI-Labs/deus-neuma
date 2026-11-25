import os from 'os';
import path from 'path';
import { resolveComfyConfig } from './image-forge/comfyui-config.js';

/** Absolute program and model stores the app loads outside a being's sandbox. Pure. */
export const programFolderWallPaths = (env = process.env) => {
  const comfy = resolveComfyConfig(env);
  return Object.freeze([
    comfy.installDir,
    comfy.modelsDir,
    comfy.dataDir,
    comfy.extraModelPaths,
    path.join(os.homedir(), '.node_libraries'),
    path.join(os.homedir(), '.node_modules'),
    path.join(os.homedir(), '.ollama', 'models'),
  ].filter((target) => typeof target === 'string' && path.isAbsolute(target)));
};
