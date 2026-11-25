// Re-read every pinned model byte immediately before a render. Install-time verification
// alone cannot catch a file swapped under a name the frozen pack already trusts.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extraModelRoots, installsLedger } from './model-install.js';

const CORE_FILES = Object.freeze([
  ['ckptName', 'checkpoints', null],
  ['unetName', 'diffusion_models', null],
  ['clipName', 'text_encoders', 'clip'],
  ['vaeName', 'vae', 'vae'],
  ['textEncoderName', 'text_encoders', 'textEncoder'],
  ['upscalerName', 'upscale_models', 'upscaler'],
  ['lowNoiseName', 'diffusion_models', 'lowNoise'],
  ['highLoraName', 'loras', 'highLora'],
  ['lowLoraName', 'loras', 'lowLora'],
  ['enhancerName', 'text_encoders', 'enhancer'],
]);

const keyOf = ({ folder, name }) => `${folder}/${name}`;

/** The files a model/pipeline names, with any pack-pinned digest attached. Pure. */
export const pinnedFileSpecs = (model, pipeline = null) => {
  const files = new Map();
  for (const [field, folder, companion] of CORE_FILES) {
    if (!model?.[field]) continue;
    const attested = companion ? model.companions?.[companion] : model;
    files.set(`${folder}/${model[field]}`, {
      folder, name: model[field], sha256: attested?.sha256 ?? null, bytes: attested?.bytes ?? null,
    });
  }
  for (const file of [model, pipeline].flatMap((item) => (Array.isArray(item?.files) ? item.files : []))) {
    if (!file?.folder || !file?.name) continue;
    const key = keyOf(file);
    files.set(key, { ...files.get(key), ...file });
  }
  return [...files.values()];
};

const installedDigests = async (file) => {
  const rows = await fs.readFile(file, 'utf8').catch(() => '');
  const out = new Map();
  for (const line of rows.split('\n')) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (row.folder && row.name && /^[0-9a-f]{64}$/.test(row.sha256 || '')) out.set(keyOf(row), row.sha256);
    } catch {
      return new Map();
    }
  }
  return out;
};

const placesOf = (file, cfg) => [
  ...(cfg.modelsDir ? [path.join(cfg.modelsDir, file.folder, file.name)] : []),
  ...extraModelRoots(cfg.extraModelPaths ? cfg.extraModelPathsText : '')
    .filter((root) => root.folders[file.folder])
    .map((root) => path.join(root.base, root.folders[file.folder], file.name)),
];

const sha256Of = (file) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
});

/** impure — verify each file that has a pack or install-ledger SHA-256. */
export const verifyPinnedModelFiles = async (model, cfg, pipeline = null, { ledgerFile = installsLedger() } = {}) => {
  const specs = pinnedFileSpecs(model, pipeline);
  const installed = await installedDigests(ledgerFile);
  const extraText = cfg.extraModelPaths ? await fs.readFile(cfg.extraModelPaths, 'utf8').catch(() => '') : '';
  const rooted = { ...cfg, extraModelPathsText: extraText };
  let checked = 0;
  for (const file of specs) {
    const expected = file.sha256 || installed.get(keyOf(file));
    if (!/^[0-9a-f]{64}$/.test(expected || '')) continue;
    const existing = [];
    for (const candidate of placesOf(file, rooted)) {
      const stat = await fs.stat(candidate).catch(() => null);
      if (stat?.isFile()) existing.push({ candidate, stat });
    }
    if (!existing.length) return { ok: false, reason: `${keyOf(file)} is missing; its pinned bytes cannot be verified` };
    const { candidate, stat } = existing[0];
    if (Number.isSafeInteger(file.bytes) && stat.size !== file.bytes) {
      return { ok: false, reason: `${keyOf(file)} changed after its SHA-256 was pinned — the render is refused` };
    }
    if (await sha256Of(candidate) !== expected) {
      return { ok: false, reason: `${keyOf(file)} does not match its pinned SHA-256 — the render is refused` };
    }
    checked += 1;
  }
  return { ok: true, checked };
};
