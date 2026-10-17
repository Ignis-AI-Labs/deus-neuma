/**
 * media/keep — an image the operator shared in chat becomes a real file in
 * the house media library, through the REAL intent sweep (the ACTS tier and
 * the mode gate live there), the REAL workspace session record, and the REAL
 * library door. Temp roots only; no mocks (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { viaIntent } from '../helpers/intent-path.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const NEUMA_ID = 'keeper';
// Real image bytes — the library sniffs the magic header, never the name.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(96, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(96, 3)]);

describe('media/keep (real sweep + real session record + real library)', () => {
  let house, realm, origRoot, prevRealm, prevLibrary, prevKey;
  const connection = (sessionId) => ({ companion: { name: 'Keeper', neumaId: NEUMA_ID }, sessionId, toolMode: 'ask' });
  const share = async (sessionId, images) => {
    await workspace.createSession(NEUMA_ID, sessionId);
    await workspace.appendTurnPoint(NEUMA_ID, sessionId, { role: 'user', content: 'post this', images });
  };

  beforeAll(async () => {
    house = await createTempDir('media-keep-house');
    realm = await createTempDir('media-keep-realm');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    prevRealm = getRealmRoot();
    setRealmRoot(realm);
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
    prevLibrary = process.env.NEUMA_MEDIA_LIBRARY_PATH;
    process.env.NEUMA_MEDIA_LIBRARY_PATH = path.join(house, 'media-library');
    await workspace.create(NEUMA_ID);
  });

  afterAll(async () => {
    setWorkspacesRoot(origRoot);
    setRealmRoot(prevRealm);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevLibrary === undefined) delete process.env.NEUMA_MEDIA_LIBRARY_PATH; else process.env.NEUMA_MEDIA_LIBRARY_PATH = prevLibrary;
    await fs.rm(house, { recursive: true, force: true });
    await fs.rm(realm, { recursive: true, force: true });
  });

  test('keeps the named shared image as a real file and hands back its path', async () => {
    await share('chat-a', [PNG.toString('base64'), `data:image/jpeg;base64,${JPEG.toString('base64')}`]);
    const [receipt] = await viaIntent(connection('chat-a'), 'media/keep', { image: 2, alt: 'a PnL screenshot' });
    expect(receipt.status).toBe('ok');
    const abs = receipt.content.match(/path: (\S+)/)[1];
    expect(abs.startsWith(process.env.NEUMA_MEDIA_LIBRARY_PATH)).toBe(true);
    expect(await fs.readFile(abs)).toEqual(JPEG);
    const manifest = JSON.parse(await fs.readFile(path.join(process.env.NEUMA_MEDIA_LIBRARY_PATH, 'manifest.json'), 'utf8'));
    expect(manifest.at(-1)).toMatchObject({ contentType: 'image/jpeg', alt: 'a PnL screenshot', savedBy: 'Keeper' });
  });

  test('refuses honestly: no such image, no shared image, bytes that are not an image', async () => {
    await share('chat-b', [PNG.toString('base64')]);
    const [past] = await viaIntent(connection('chat-b'), 'media/keep', { image: 3 });
    expect(past.status).not.toBe('ok');
    expect(JSON.stringify(past)).toMatch(/holds 1 image — there is no image 3/);

    await workspace.createSession(NEUMA_ID, 'chat-c');
    const [none] = await viaIntent(connection('chat-c'), 'media/keep', {});
    expect(JSON.stringify(none)).toMatch(/no image has been shared/);

    await share('chat-d', [Buffer.from('not an image at all').toString('base64')]);
    const [bogus] = await viaIntent(connection('chat-d'), 'media/keep', {});
    expect(JSON.stringify(bogus)).toMatch(/not a JPEG, PNG, GIF or WEBP/);
  });
});
