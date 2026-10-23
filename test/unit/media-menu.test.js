// media-menu — one menu for every image and clip: the browser's own video
// options kept, the gallery and the folder added, and nothing offered that
// cannot apply. Pure functions, real inputs.
import { describe, test, expect } from 'vitest';
import {
  mediaMenuItems, speedMenuItems, speedOfItem, forgeImageIdOf, downloadNameOf, galleryLandingOf, SPEEDS,
} from '../../frontend/app/RelinkShell/media-menu.js';

const ID = '3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f';
const ARTFILE = `/srv/house/lanes/orla/art/images/${ID}.mp4`;
const ids = (items) => items.map((i) => i.id ?? '—');
const PLAYER = Object.freeze({ paused: false, muted: false, loop: true, controls: true, rate: 1, pip: true, pipOn: false });

describe('a forge clip on a card (the owner\'s right-click, 2026-10-23)', () => {
  const clip = { kind: 'video', src: 'blob:x', path: ARTFILE };
  const items = mediaMenuItems(clip, { player: PLAYER, fullscreen: true, canCopyImage: true });

  test('keeps every option the browser\'s own menu held, and adds the gallery and the folder', () => {
    expect(ids(items)).toEqual([
      'full-screen', 'pip', '—',
      'play', 'mute', 'loop', 'controls', 'speed-page', '—',
      'open-gallery', 'show-in-files', '—',
      'download', 'copy-path',
    ]);
  });

  test('the player items say what they will do now, and settings show whether they are on', () => {
    const by = Object.fromEntries(items.filter((i) => i.id).map((i) => [i.id, i]));
    expect(by.play.label).toBe('Pause');
    expect(by.mute.label).toBe('Mute');
    expect(by.loop.checked).toBe(true);
    expect(by.controls.checked).toBe(true);
    expect(by['speed-page']).toMatchObject({ stay: true });
    expect(by['speed-page'].label).toMatch(/Playback speed: Normal/);
    expect(by['open-gallery'].label).toBe('Open in gallery');
    expect(by['show-in-files'].label).toBe('Show in files');
  });

  test('a paused, muted clip in picture in picture offers the way back', () => {
    const quiet = mediaMenuItems(clip, { player: { ...PLAYER, paused: true, muted: true, loop: false, pipOn: true, rate: 1.5 }, fullscreen: true });
    const by = Object.fromEntries(quiet.filter((i) => i.id).map((i) => [i.id, i]));
    expect(by.play.label).toBe('Play');
    expect(by.mute.label).toBe('Unmute');
    expect(by.loop.checked).toBe(false);
    expect(by.pip.label).toBe('Leave picture in picture');
    expect(by['speed-page'].label).toMatch(/1\.5×/);
  });

  test('a clip never offers Copy image — the clipboard holds pictures, not clips', () => {
    expect(ids(items)).not.toContain('copy-image');
  });
});

describe('items that cannot apply are absent, not greyed', () => {
  test('no picture in picture where the browser forbids it, no full screen where the page cannot', () => {
    const items = mediaMenuItems({ kind: 'video', src: 'blob:x' }, { player: { ...PLAYER, pip: false }, fullscreen: false });
    expect(ids(items)).not.toContain('pip');
    expect(ids(items)).not.toContain('full-screen');
  });

  test('a pasted picture (in the record only, no file) offers the loupe, the download and the clipboard', () => {
    const items = mediaMenuItems({ kind: 'image', src: 'data:image/png;base64,AA==' }, { canCopyImage: true });
    expect(ids(items)).toEqual(['full-screen', '—', 'download', 'copy-image']);
  });

  test('a relayed remote picture has no gallery to go to', () => {
    const items = mediaMenuItems({ kind: 'image', src: 'blob:remote' }, { canCopyImage: true });
    expect(ids(items)).not.toContain('open-gallery');
    expect(ids(items)).not.toContain('show-in-files');
    expect(ids(items)).not.toContain('copy-path');
  });

  test('a forge render known only by its id opens in the gallery but names no folder', () => {
    const items = mediaMenuItems({ kind: 'image', src: 'blob:x', imageId: ID }, {});
    expect(ids(items)).toEqual(['full-screen', '—', 'open-gallery', '—', 'download']);
  });

  test('inside the gallery the gallery is never offered — its folder still is', () => {
    const items = mediaMenuItems({ kind: 'image', src: '/api/v1/gallery/file?x', path: '/srv/renders/a.png' }, { inGallery: true });
    expect(ids(items)).not.toContain('open-gallery');
    expect(ids(items)).toContain('show-in-files');
  });

  test('a clip that is only a tile (no player under it) offers no player items', () => {
    const items = mediaMenuItems({ kind: 'video', src: '/api/v1/gallery/file?x', path: '/srv/renders/a.mp4' }, { inGallery: true, fullscreen: true });
    expect(ids(items)).toEqual(['show-in-files', '—', 'download', 'copy-path']);
  });

  test('a relative or poisoned path is not a place on disk', () => {
    expect(ids(mediaMenuItems({ kind: 'image', src: 'blob:x', path: 'art/a.png' }))).not.toContain('show-in-files');
    expect(ids(mediaMenuItems({ kind: 'image', src: 'blob:x', path: '/a\0b.png' }))).not.toContain('copy-path');
  });

  test('media with nothing to show and nowhere to go raises no items at all', () => {
    expect(mediaMenuItems({ kind: 'image' })).toEqual([]);
  });
});

describe('the playback-speed page', () => {
  test('the way back first, then the browser\'s speeds with the current one marked', () => {
    const page = speedMenuItems(0.75);
    expect(page[0]).toMatchObject({ id: 'speed-back', stay: true });
    expect(page.filter((i) => i.id?.startsWith('speed:')).map((i) => i.label))
      .toEqual(['0.25×', '0.5×', '0.75×', 'Normal', '1.25×', '1.5×', '1.75×', '2×']);
    expect(page.filter((i) => i.checked).map((i) => i.id)).toEqual(['speed:0.75']);
  });

  test('only an offered speed is honoured', () => {
    expect(speedOfItem('speed:1.5')).toBe(1.5);
    expect(speedOfItem('speed:16')).toBeNull();
    expect(speedOfItem('speed:')).toBeNull();
    expect(speedOfItem('download')).toBeNull();
    expect(SPEEDS).toContain(1);
  });
});

describe('what the menu knows about a piece of media', () => {
  test('a forge URL names its render', () => {
    expect(forgeImageIdOf(`/api/v1/image-forge/images/${ID}?laneId=orla`)).toBe(ID);
    expect(forgeImageIdOf(`/api/v1/image-forge/images/${ID}`)).toBe(ID);
    expect(forgeImageIdOf('/api/v1/social-channels/tiktok/relay?u=x')).toBeNull();
    expect(forgeImageIdOf(`/api/v1/image-forge/images/${ID}/reviews`)).toBeNull();
    expect(forgeImageIdOf(null)).toBeNull();
  });

  test('a download keeps the file\'s own name, else names the render, always with an extension', () => {
    expect(downloadNameOf({ kind: 'video', path: ARTFILE })).toBe(`${ID}.mp4`);
    expect(downloadNameOf({ kind: 'image', imageId: ID, mime: 'image/webp' })).toBe(`${ID}.webp`);
    expect(downloadNameOf({ kind: 'video', imageId: ID })).toBe(`${ID}.mp4`);
    expect(downloadNameOf({ kind: 'image', name: 'share-card.png' })).toBe('share-card.png');
    expect(downloadNameOf({ kind: 'image' })).toBe('image.png');
  });

  test('the gallery is asked for the render by id and by path — the id read from a stored file\'s name', () => {
    expect(galleryLandingOf({ path: ARTFILE })).toEqual({ imageId: ID, path: ARTFILE });
    expect(galleryLandingOf({ imageId: ID })).toEqual({ imageId: ID });
    expect(galleryLandingOf({ path: '/srv/renders/ComfyUI_0001_.png' })).toEqual({ path: '/srv/renders/ComfyUI_0001_.png' });
    expect(galleryLandingOf({ path: 'relative.png' })).toBeNull();
  });
});
