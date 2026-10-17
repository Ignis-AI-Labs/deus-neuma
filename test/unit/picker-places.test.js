// picker-places — the FolderPicker rail + list core, pure (no mocks: real
// inputs, real outputs).
import { describe, it, expect } from 'vitest';
import { railSections, activeRailPath, visibleEntries } from '../../frontend/app/RelinkShell/picker/picker-places.js';

const DRIVES = [
  { path: '/', label: '/' },
  { path: '/home', label: 'home' },
  { path: '/home/founder', label: 'HOME' },
  { path: '/mnt/data', label: 'data' },
];

describe('railSections — four standings, every item says where it lives', () => {
  const sections = railSections({
    home: '/home/founder',
    drives: DRIVES,
    favorites: ['/workspace/repos/neuma'],
    recents: ['/workspace/repos/neuma', '/workspace/repos/project-vudusil'],
  });
  const byKey = Object.fromEntries(sections.map((s) => [s.key, s]));

  it('PLACES holds home and the filesystem root, named plainly', () => {
    expect(byKey.places.items.map((i) => [i.name, i.path])).toEqual([['Home', '/home/founder'], ['Filesystem', '/']]);
  });

  it('DRIVES drops what PLACES already holds — /home and the home folder no longer collide', () => {
    expect(byKey.drives.items.map((i) => [i.name, i.sub])).toEqual([['home', '/home'], ['data', '/mnt/data']]);
  });

  it('PINNED names the folder and its parent; RECENT skips what is pinned', () => {
    expect(byKey.pinned.items).toEqual([{ path: '/workspace/repos/neuma', name: 'neuma', sub: '/workspace/repos' }]);
    expect(byKey.recent.items.map((i) => i.path)).toEqual(['/workspace/repos/project-vudusil']);
  });

  it('empty sections are dropped, order holds', () => {
    expect(railSections({ home: '/h', drives: [], favorites: [], recents: [] }).map((s) => s.key)).toEqual(['places']);
    expect(sections.map((s) => s.key)).toEqual(['places', 'pinned', 'drives', 'recent']);
  });

  it('a Windows drive root is the Filesystem place', () => {
    const win = railSections({ home: 'C:\\Users\\founder', drives: [{ path: 'C:\\' }, { path: 'D:\\' }] });
    expect(win[0].items.map((i) => i.name)).toEqual(['Home', 'Filesystem']);
    expect(win[1].items.map((i) => i.path)).toEqual(['D:\\']);
  });
});

describe('activeRailPath — the deepest place that holds the cwd', () => {
  const paths = ['/home/founder', '/', '/mnt/data', '/mnt/data/repos'];

  it('lights the deepest containing place', () => {
    expect(activeRailPath('/mnt/data/repos/x', paths)).toBe('/mnt/data/repos');
    expect(activeRailPath('/mnt/data', paths)).toBe('/mnt/data');
    expect(activeRailPath('/tmp', paths)).toBe('/');
  });

  it('a sibling that shares a prefix is not an ancestor', () => {
    expect(activeRailPath('/mnt/data-archive', ['/mnt/data'])).toBeNull();
  });

  it('no cwd, no light', () => {
    expect(activeRailPath(null, paths)).toBeNull();
  });
});

describe('visibleEntries — hidden gate, then the name filter', () => {
  const entries = [
    { name: 'Backups', hidden: false },
    { name: 'repos', hidden: false },
    { name: '.cache', hidden: true },
  ];

  it('hides dotfiles unless asked', () => {
    expect(visibleEntries(entries, { showHidden: false, query: '' }).map((e) => e.name)).toEqual(['Backups', 'repos']);
    expect(visibleEntries(entries, { showHidden: true, query: '' })).toHaveLength(3);
  });

  it('filters case-insensitively, trimming the query', () => {
    expect(visibleEntries(entries, { showHidden: false, query: ' back ' }).map((e) => e.name)).toEqual(['Backups']);
  });

  it('null entries (loading) read as none', () => {
    expect(visibleEntries(null, { showHidden: false, query: '' })).toEqual([]);
  });
});
