#!/usr/bin/env node
/**
 * x-media-verify — prove the X media path against the REAL API, publishing
 * NOTHING.
 *
 * Uploading media is not speech: it returns a media id that expires unused
 * (~24h) and appears nowhere public. So the one leg the test suite cannot
 * exercise — the actual signed multipart round-trip to api.x.com — can be
 * proven here without the account saying a word.
 *
 * This script never calls POST /2/tweets. There is deliberately no flag to
 * make it do so; publishing goes through the queue and the operator's card.
 *
 *   node scripts/x-media-verify.mjs [path/to/image.png]
 *
 * With no argument it generates a small PNG in a temp dir and uploads that.
 * Requires the four X_* credentials the poster already uses.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Same bootstrap as x-read-verify: a bare driver must load the operator's .env
// itself — `loadConfig` validates process.env, it does not populate it.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const { xPostCredentials } = await import('../backend/services/social/x-poster.js');
const { readMediaFile, setAltText, uploadMedia } = await import('../backend/services/social/x-media.js');

// A 1x1 PNG — real bytes, valid header, nothing to see.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const say = (...a) => console.log(...a);

const main = async () => {
  const credentials = xPostCredentials();
  if (!credentials) {
    say('✗ X credentials are not configured (X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET).');
    say('  Nothing was attempted.');
    process.exit(1);
  }

  let target = process.argv[2];
  if (!target) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'x-media-verify-'));
    target = path.join(dir, 'probe.png');
    await fs.writeFile(target, TINY_PNG);
    say(`· no file given — generated ${target}`);
  }

  const read = await readMediaFile(path.resolve(target));
  if (!read.ok) {
    say(`✗ ${read.detail}`);
    process.exit(1);
  }
  say(`· ${read.filename} — ${read.contentType}, ${read.content.length} bytes (type from magic bytes, not the name)`);

  say('· uploading (this publishes nothing) …');
  const up = await uploadMedia(credentials, read);
  if (!up.ok) {
    say(`✗ upload failed: ${up.detail}${up.status ? ` (HTTP ${up.status})` : ''}`);
    process.exit(1);
  }
  say(`✓ media id ${up.mediaId}`);

  const described = await setAltText(credentials, up.mediaId, 'A verification probe uploaded by x-media-verify. Not published.');
  say(described.ok ? '✓ alt text attached' : `✗ alt text did not attach: ${described.detail}`);

  say('');
  say('Nothing was posted. The media id above will expire unused.');
  process.exit(described.ok ? 0 : 1);
};

main().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
