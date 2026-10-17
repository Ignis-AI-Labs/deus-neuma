/** Real stores from a read-only install cwd; no provider or GPU involved. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { writeStoredRoots, readStoredRoots } from '../../backend/services/gallery/gallery-roots.js';
import { loadBrandKit } from '../../backend/services/doc-press/brand-kit.js';
import { contentLawPath } from '../../backend/services/image-forge/image-being-tools.js';
import { loadScreenList } from '../../backend/services/image-forge/prompt-screen.js';
import { readManifest, resolveImage } from '../../backend/services/image-forge/image-store.js';
import { recordReview, readReviews } from '../../backend/services/image-forge/review-log.js';
import { recordAttempt, readAttempts } from '../../backend/services/image-forge/attempt-log.js';

const root = process.argv[2];
const override = process.argv[3] === 'override';
const write = async (file, content) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
};

await assert.rejects(fs.writeFile(path.join(process.cwd(), 'forbidden'), 'x'), /EACCES|EROFS/);
for (const phase of ['first', 'second']) {
  // Modules were imported before this change: roots must resolve per call.
  process.env.NEUMA_DATA_ROOT = path.join(root, phase, 'data');
  const target = override ? path.join(root, phase, 'overrides') : process.env.NEUMA_DATA_ROOT;
  const files = {
    NEUMA_GALLERY_ROOTS_PATH: path.join(target, 'settings/gallery-roots.json'),
    NEUMA_BRAND_KITS_DIR: path.join(target, 'brand-kits'),
    COMFYUI_CONTENT_LAW_PATH: path.join(target, 'image-forge/content-law.json'),
    COMFYUI_IMAGE_STORE_DIR: path.join(target, 'image-forge/images'),
    COMFYUI_REVIEW_LOG_PATH: path.join(target, 'image-forge/reviews.jsonl'),
    COMFYUI_ATTEMPT_LOG_PATH: path.join(target, 'image-forge/attempts.jsonl'),
  };
  for (const [key, value] of Object.entries(files)) {
    if (override) process.env[key] = value;
    else delete process.env[key];
  }

  const roots = [{ id: 'review-root', dir: root, label: phase }];
  await writeStoredRoots(roots);
  assert.deepEqual(await readStoredRoots(), roots);
  assert.deepEqual(JSON.parse(await fs.readFile(files.NEUMA_GALLERY_ROOTS_PATH, 'utf8')).roots, roots);

  await write(path.join(files.NEUMA_BRAND_KITS_DIR, 'review/kit.json'), JSON.stringify({ name: phase }));
  assert.equal((await loadBrandKit({ kitId: 'review' })).name, phase);
  const explicit = path.join(root, phase, 'explicit-kits');
  await write(path.join(explicit, 'review/kit.json'), JSON.stringify({ name: 'explicit' }));
  assert.equal((await loadBrandKit({ kitId: 'review', kitsDir: explicit })).name, 'explicit');

  await write(files.COMFYUI_CONTENT_LAW_PATH, JSON.stringify({ classes: { csam: ['fixtureblocked'] } }));
  assert.equal(contentLawPath(), files.COMFYUI_CONTENT_LAW_PATH);
  assert.equal(loadScreenList(contentLawPath()).failClosed, false);

  const imageDir = path.join(files.COMFYUI_IMAGE_STORE_DIR, 'review-lane');
  await write(path.join(imageDir, 'manifest.jsonl'), JSON.stringify({ imageId: phase, file: 'image.png', createdAt: '2026-09-09' }) + '\n');
  await write(path.join(imageDir, 'image.png'), 'stored-image-bytes');
  assert.equal(readManifest('review-lane').at(-1).imageId, phase);
  const image = resolveImage('review-lane', phase);
  assert.equal(image.ok, true);
  assert.equal(await fs.readFile(image.path, 'utf8'), 'stored-image-bytes');

  recordReview({ imageId: phase, verdict: 'keep' });
  assert.equal(readReviews().entries[0].imageId, phase);
  assert.equal(JSON.parse(await fs.readFile(files.COMFYUI_REVIEW_LOG_PATH, 'utf8')).imageId, phase);
  recordAttempt({ jobId: phase, outcome: 'ok' });
  assert.equal(readAttempts().entries[0].jobId, phase);
  assert.equal(JSON.parse(await fs.readFile(files.COMFYUI_ATTEMPT_LOG_PATH, 'utf8')).jobId, phase);
}
assert.deepEqual(await fs.readdir(process.cwd()), []);
