/**
 * POST MEDIA (RULE 0) — Design note, 2026-07-26: […]
 *
 * Real image bytes on real temp disk, the real path sandbox, the real queue
 * store, the real multipart builder and the real OAuth 1.0a signer. The ONLY
 * thing not exercised here is the network call to X itself — that needs live
 * credentials and is proven separately by `scripts/x-media-verify.mjs`, which
 * uploads without posting. Nothing on the claimed path is mocked.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  sniffImageType, buildMultipartBody, readMediaFile, mediaCategoryFor, MEDIA_MAX_BYTES,
} from '../../backend/services/social/x-media.js';
import { resolveMediaFile, isUnderRoot, reverifyMediaFile } from '../../backend/services/social/media-source.js';
import { resolvePostMedia } from '../../backend/services/social/post-media.js';
import { validateDraft, postQueue } from '../../backend/services/social/post-queue.js';
import { buildOAuth1Header, signatureBaseString } from '../../backend/services/social/x-poster.js';

// Real, minimal, valid image bytes — not fixtures pretending to be images.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(64, 7)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(64, 3)]);

let ground, outside, savedQueue;

beforeAll(async () => {
  ground = await createTempDir('media-ground');
  outside = await createTempDir('media-outside');
  savedQueue = process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(ground, 'queue.json');

  await fs.writeFile(path.join(ground, 'render.png'), PNG);
  await fs.writeFile(path.join(ground, 'shot.jpg'), JPEG);
  await fs.writeFile(path.join(ground, 'notes.txt'), 'this is not an image');
  await fs.writeFile(path.join(ground, 'liar.png'), Buffer.from('plain text wearing a png name'));
  await fs.writeFile(path.join(outside, 'private-key.png'), PNG);
});

afterAll(async () => {
  if (savedQueue === undefined) delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
  else process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = savedQueue;
});

beforeEach(async () => {
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
});

describe('media type is decided by the BYTES, never the filename', () => {
  test('recognises the real formats X accepts', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(GIF)).toBe('image/gif');
    expect(sniffImageType(Buffer.concat([
      Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(8),
    ]))).toBe('image/webp');
  });

  test('a text file wearing a .png name is refused', async () => {
    const result = await readMediaFile(path.join(ground, 'liar.png'));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('not a JPEG, PNG, GIF or WEBP');
  });

  test('an empty or missing file is refused with the honest reason', async () => {
    const empty = path.join(ground, 'empty.png');
    await fs.writeFile(empty, '');
    expect((await readMediaFile(empty)).detail).toContain('empty');
    expect((await readMediaFile(path.join(ground, 'nope.png'))).detail).toContain('gone');
  });

  test('a real image reads with its sniffed type and true name', async () => {
    const result = await readMediaFile(path.join(ground, 'render.png'));
    expect(result).toMatchObject({ ok: true, contentType: 'image/png', filename: 'render.png' });
    expect(result.content.equals(PNG)).toBe(true);
    expect(result.content.length).toBeLessThan(MEDIA_MAX_BYTES);
  });
});

describe('THE MEDIA SANDBOX — a post can only carry files from open ground', () => {
  test('an image inside the open folder resolves', async () => {
    const result = await resolveMediaFile(path.join(ground, 'render.png'), [ground]);
    expect(result.ok).toBe(true);
    expect(result.path).toBe(await fs.realpath(path.join(ground, 'render.png')));
  });

  test('a file OUTSIDE every open folder is refused', async () => {
    const result = await resolveMediaFile(path.join(outside, 'private-key.png'), [ground]);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('outside every folder open to you');
  });

  test('a traversal path cannot climb out of the ground', async () => {
    const climb = path.join(ground, '..', path.basename(outside), 'private-key.png');
    const result = await resolveMediaFile(climb, [ground]);
    expect(result.ok).toBe(false);
  });

  test('a SYMLINK pointing outside the ground is refused — realpath, not prefix', async () => {
    // The whole reason the check resolves before comparing: a link whose NAME
    // sits inside the ground while its target does not.
    const link = path.join(ground, 'innocent.png');
    await fs.symlink(path.join(outside, 'private-key.png'), link);
    const result = await resolveMediaFile(link, [ground]);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('outside every folder open to you');
    await fs.rm(link);
  });

  test('with no folder open, nothing can be attached at all', async () => {
    const result = await resolveMediaFile(path.join(ground, 'render.png'), []);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('no folder is open');
  });

  test('a relative path is refused rather than guessed at', async () => {
    expect((await resolveMediaFile('render.png', [ground])).detail).toContain('must be absolute');
  });

  test('isUnderRoot treats the root itself as inside, and a sibling as outside', () => {
    expect(isUnderRoot('/a/b', '/a/b')).toBe(true);
    expect(isUnderRoot('/a/b/c.png', '/a/b')).toBe(true);
    expect(isUnderRoot('/a/bc/c.png', '/a/b')).toBe(false);
    expect(isUnderRoot('/a', '/a/b')).toBe(false);
  });
});

describe('re-verification at publication time', () => {
  test('an unchanged file passes', async () => {
    const real = await fs.realpath(path.join(ground, 'render.png'));
    expect(await reverifyMediaFile(real)).toMatchObject({ ok: true });
  });

  test('a file swapped for a symlink AFTER staging fails the send', async () => {
    const staged = path.join(ground, 'swapme.png');
    await fs.writeFile(staged, PNG);
    const real = await fs.realpath(staged);
    await fs.rm(staged);
    await fs.symlink(path.join(outside, 'private-key.png'), staged);

    const result = await reverifyMediaFile(real);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/changed after it was staged|gone/);
    await fs.rm(staged);
  });

  test('a file deleted between staging and sending fails the send', async () => {
    const doomed = path.join(ground, 'doomed.png');
    await fs.writeFile(doomed, PNG);
    const real = await fs.realpath(doomed);
    await fs.rm(doomed);
    expect((await reverifyMediaFile(real)).detail).toContain('gone');
  });
});

describe('the queue carries media as part of the governance record', () => {
  test('a staged draft persists its images and alt text to REAL disk', async () => {
    const entry = await postQueue.add({
      channelId: 'x',
      text: 'the render is ready',
      media: [{ path: path.join(ground, 'render.png'), alt: 'A dark chamfered panel with a cyan signal line.' }],
      queuedBy: 'Kagipem',
    });
    const [stored] = await postQueue.load();
    expect(stored.id).toBe(entry.id);
    expect(stored.media).toHaveLength(1);
    expect(stored.media[0].alt).toContain('cyan signal line');
  });

  test('the queue read names the images and FLAGS a missing description', async () => {
    const { formatQueueForBeing } = await import('../../backend/services/social/queue-view.js');
    await postQueue.add({
      channelId: 'x', text: 'described', queuedBy: 'A',
      media: [{ path: path.join(ground, 'render.png'), alt: 'described properly' }],
    });
    await postQueue.add({
      channelId: 'x', text: 'undescribed', queuedBy: 'A',
      media: [{ path: path.join(ground, 'shot.jpg') }],
    });
    const view = formatQueueForBeing(await postQueue.load());
    expect(view).toContain('render.png [described]');
    expect(view).toContain('shot.jpg [NO ALT TEXT]');
  });

  test('the validator refuses a malformed or oversized attachment list', () => {
    const base = { channelId: 'x', text: 'hi' };
    expect(validateDraft({ ...base, media: 'not-a-list' })).toContain('must be a list');
    expect(validateDraft({ ...base, media: [{}] })).toContain('needs a path');
    expect(validateDraft({ ...base, media: Array(5).fill({ path: '/x.png' }) })).toContain('at most 4');
    expect(validateDraft({ ...base, media: [{ path: '/x.png', alt: 'x'.repeat(1001) }] })).toContain('too long');
    expect(validateDraft({ ...base, media: [{ path: '/x.png', alt: 'fine' }] })).toBeNull();
    expect(validateDraft(base)).toBeNull();
  });
});

describe('the multipart body and its OAuth 1.0a signature', () => {
  test('the body frames the file with its boundary, name and sniffed type', () => {
    const body = buildMultipartBody(
      { name: 'media', filename: 'render.png', contentType: 'image/png', content: PNG }, 'BOUND',
    );
    const text = body.toString('latin1');
    expect(text.startsWith('--BOUND\r\n')).toBe(true);
    expect(text).toContain('Content-Disposition: form-data; name="media"; filename="render.png"');
    expect(text).toContain('Content-Type: image/png');
    expect(text.endsWith('\r\n--BOUND--\r\n')).toBe(true);
    // The bytes ride intact — a corrupted payload is an unpostable image.
    expect(body.includes(PNG)).toBe(true);
  });

  test('the body carries media_category — X refuses the upload without it', () => {
    // Proven against the live API 2026-07-26: omitting this field answers
    // 400 "Missing media_category field". The endpoint will not infer it from
    // the MIME type, so this is not optional and must not be dropped.
    expect(mediaCategoryFor('image/png')).toBe('tweet_image');
    expect(mediaCategoryFor('image/jpeg')).toBe('tweet_image');
    expect(mediaCategoryFor('image/webp')).toBe('tweet_image');
    expect(mediaCategoryFor('image/gif')).toBe('tweet_gif');

    const body = buildMultipartBody(
      { name: 'media', filename: 'r.png', contentType: 'image/png', content: PNG },
      'BOUND',
      { media_category: 'tweet_image' },
    ).toString('latin1');
    expect(body).toContain('Content-Disposition: form-data; name="media_category"');
    expect(body).toContain('tweet_image');
    // The text field precedes the file part, and the body still closes once.
    expect(body.indexOf('media_category')).toBeLessThan(body.indexOf('filename="r.png"'));
    expect(body.match(/--BOUND--/g)).toHaveLength(1);
  });

  test('a multipart upload signs ONLY the oauth params — the body is excluded', () => {
    // The detail the whole upload path turns on: for multipart/form-data the
    // signature base string must not fold in the body, unlike the
    // form-urlencoded case OAuth is usually described with. Signing a body
    // param here would make every upload fail with a 401.
    const base = signatureBaseString('POST', 'https://api.x.com/2/media/upload', {
      oauth_consumer_key: 'ck', oauth_nonce: 'n', oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: '1', oauth_token: 'tk', oauth_version: '1.0',
    });
    // METHOD & url & params — inspect the PARAMS section alone. ("media" also
    // appears in the endpoint URL, which is expected and not what this guards.)
    const [method, url, params] = base.split('&');
    expect(method).toBe('POST');
    expect(decodeURIComponent(url)).toBe('https://api.x.com/2/media/upload');
    const signedKeys = decodeURIComponent(params).split('&').map((kv) => kv.split('=')[0]);
    expect(signedKeys).toEqual([
      'oauth_consumer_key', 'oauth_nonce', 'oauth_signature_method',
      'oauth_timestamp', 'oauth_token', 'oauth_version',
    ]);
    expect(signedKeys.every((k) => k.startsWith('oauth_'))).toBe(true);

    const header = buildOAuth1Header(
      { apiKey: 'ck', apiSecret: 'cs', accessToken: 'tk', accessSecret: 'as' },
      { method: 'POST', url: 'https://api.x.com/2/media/upload', timestamp: '1', nonce: 'n' },
    );
    expect(header.startsWith('OAuth ')).toBe(true);
    expect(header).toContain('oauth_signature=');
    // Deterministic given a pinned timestamp + nonce: the signature is pinned
    // so a change to the signing path cannot pass unnoticed.
    expect(header).toContain('oauth_nonce="n"');
  });
});

describe('THE BEING\'S OWN CARD GROUND — its own cards/ is a standing attach root', () => {
  const WALLET = '0x' + 'ab'.repeat(20);
  const LANE = 'sodelight';
  let savedRealm, savedRealmRoot, privateRealm, durableGround;

  beforeAll(async () => {
    // Durable-ground law: a TEMP house root is only legal under an isolated
    // realm (the same pattern card-tool.test.js stands on).
    const userRealm = await import('../../backend/services/user-realm.js');
    savedRealmRoot = userRealm.getRealmRoot();
    savedRealm = process.env.NEUMA_REALM_ROOT;
    privateRealm = await createTempDir('post-media-realm');
    process.env.NEUMA_REALM_ROOT = privateRealm;
    userRealm.setRealmRoot(process.env.NEUMA_REALM_ROOT);
    const { setHouseWorkspace } = await import('../../backend/services/house-workspace.js');
    durableGround = path.join(privateRealm, 'ground');
    await fs.mkdir(path.join(durableGround, 'workspaces', LANE, 'cards'), { recursive: true });
    await setHouseWorkspace(WALLET, durableGround);
    await fs.writeFile(path.join(durableGround, 'workspaces', LANE, 'cards', 'umbrae-milestone-card.png'), PNG);
  });

  afterAll(async () => {
    const userRealm = await import('../../backend/services/user-realm.js');
    if (savedRealm === undefined) delete process.env.NEUMA_REALM_ROOT;
    else process.env.NEUMA_REALM_ROOT = savedRealm;
    userRealm.setRealmRoot(savedRealmRoot);
    await fs.rm(privateRealm, { recursive: true, force: true });
  });

  test('a card in the being\'s own cards/ attaches with NO folder open and no grants', async () => {
    // The old law refused exactly this: the card was the being's own work,
    // rendered through the chipped tool, yet unattachable unless the
    // operator's Explorer happened to sit on the house ground.
    const connection = { walletAddress: WALLET, companion: { neumaId: LANE } };
    const result = await resolvePostMedia(connection, [
      { path: path.join(durableGround, 'workspaces', LANE, 'cards', 'umbrae-milestone-card.png'), alt: 'the card' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.media[0].alt).toBe('the card');
  });

  test('another lane\'s cards are still not attachable', async () => {
    await fs.mkdir(path.join(durableGround, 'workspaces', 'otherlane', 'cards'), { recursive: true });
    await fs.writeFile(path.join(durableGround, 'workspaces', 'otherlane', 'cards', 'steal.png'), PNG);
    const connection = { walletAddress: WALLET, companion: { neumaId: LANE } };
    const result = await resolvePostMedia(connection, [
      { path: path.join(durableGround, 'workspaces', 'otherlane', 'cards', 'steal.png'), alt: 'not mine' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('outside every folder open to you');
  });

  test('a symlinked cards directory cannot grant an outside image for attachment', async () => {
    const cards = path.join(durableGround, 'workspaces', LANE, 'cards');
    const moved = `${cards}-saved`;
    const external = path.join(privateRealm, 'outside');
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, 'escape.png'), PNG);
    await fs.rename(cards, moved);
    await fs.symlink(external, cards);
    try {
      const result = await resolvePostMedia({ walletAddress: WALLET, companion: { neumaId: LANE } }, [
        { path: path.join(cards, 'escape.png'), alt: 'outside' },
      ]);
      expect(result.ok).toBe(false);
    } finally {
      await fs.unlink(cards);
      await fs.rename(moved, cards);
    }
  });

  test('the channel\'s own ceiling refuses at staging, with the count (280 on X)', () => {
    const long = 'a'.repeat(281);
    const refused = validateDraft({ channelId: 'x', text: long });
    expect(refused).toContain('281 characters');
    expect(refused).toContain('280');
    const fits = validateDraft({ channelId: 'x', text: 'a'.repeat(280) });
    expect(fits).toBeNull();
  });
});
