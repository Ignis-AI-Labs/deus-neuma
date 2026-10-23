/**
 * The update bar's decisions — version order, which notes a reader is shown, when WHAT'S NEW
 * opens on its own, and what the bar offers — with real inputs and the repo's REAL release notes
 * files, no mocks (RULE 0). launchWhatsNew runs on a real temp directory on disk.
 *
 * The IPC, the preload bridge and the signed feed carrying releaseNotes are proven in real
 * Electron by scripts/prove-update-bar.mjs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { compareVersions, notesText, selectNotes, whatsNewDue, barFor } = require('../../electron/update-notes.cjs');
const { SEEN_FILE, BUNDLED_NOTES, launchWhatsNew } = require('../../electron/update-bar.cjs');

const REPO = path.resolve(import.meta.dirname, '../..');
const realNotes = (v) => fs.readFileSync(path.join(REPO, 'docs/operations', `release-notes-${v}.md`), 'utf8');

describe('compareVersions', () => {
  it('orders x.y.z numerically, never as text', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.1.54', '0.1.55')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.1.54', '0.1.54')).toBe(0);
  });

  it('sorts anything that is not x.y.z below every version', () => {
    expect(compareVersions(null, '0.0.1')).toBeLessThan(0);
    expect(compareVersions('0.1.54', 'latest')).toBeGreaterThan(0);
    expect(compareVersions('0.1.54-beta', '0.0.1')).toBeLessThan(0);
    expect(compareVersions(undefined, '')).toBe(0);
  });
});

describe('notesText', () => {
  it('takes a generic feed\'s string and a provider\'s { version, note } list', () => {
    expect(notesText('  ## New in 0.1.56\n\n- A thing.  ')).toBe('## New in 0.1.56\n\n- A thing.');
    expect(notesText([{ version: '0.1.56', note: 'one' }, { version: '0.1.55', note: 'two' }])).toBe('one\n\ntwo');
  });

  it('reads nothing as null — absent, empty, or not text', () => {
    expect(notesText(undefined)).toBeNull();
    expect(notesText('   ')).toBeNull();
    expect(notesText(42)).toBeNull();
    expect(notesText([{ note: null }])).toBeNull();
  });
});

describe('selectNotes — on the real cumulative notes files', () => {
  const notes39 = realNotes('0.1.39');

  it('shows only the sections newer than what the reader ran, newest first', () => {
    const shown = selectNotes(notes39, { after: '0.1.36', upTo: '0.1.39' });
    expect(shown.map((s) => s.version)).toEqual(['0.1.39', '0.1.38', '0.1.37']);
    expect(shown[0].body).toMatch(/setup wizard's artwork arrives intact/);
    // a section ends at the next heading: the standing description never rides along
    for (const s of shown) expect(s.body).not.toMatch(/^## /m);
    expect(shown.at(-1).body).not.toMatch(/What you need/);
  });

  it('never shows a section beyond the version on offer', () => {
    expect(selectNotes(notes39, { after: '0.1.33', upTo: '0.1.36' }).map((s) => s.version)).toEqual(['0.1.36', '0.1.34']);
  });

  it('with nothing known about the reader, shows the newest section only', () => {
    expect(selectNotes(notes39, { after: null, upTo: '0.1.39' }).map((s) => s.version)).toEqual(['0.1.39']);
  });

  it('every shipped version from 0.1.49 on names its own section', () => {
    for (const v of ['0.1.49', '0.1.54']) {
      const shown = selectNotes(realNotes(v), { after: null, upTo: v });
      expect(shown.map((s) => s.version)).toEqual([v]);
      expect(shown[0].body.length).toBeGreaterThan(80);
    }
  });

  it('a 0.1.36 install offered 0.1.54 reads every section between, not the ones it already ran', () => {
    const versions = selectNotes(realNotes('0.1.54'), { after: '0.1.36', upTo: '0.1.54' }).map((s) => s.version);
    expect(versions[0]).toBe('0.1.54');
    expect(versions).toContain('0.1.49');
    expect(versions).not.toContain('0.1.36');
  });

  it('a notes text with no "New in" sections is one section; no text is none', () => {
    expect(selectNotes('Fixes a crash at start.', { after: '0.1.1', upTo: '0.1.2' })).toEqual([{ version: '0.1.2', body: 'Fixes a crash at start.' }]);
    expect(selectNotes(null, { after: '0.1.1', upTo: '0.1.2' })).toEqual([]);
    expect(selectNotes(notes39, { after: '0.1.39', upTo: '0.1.39' })).toEqual([]);
  });
});

describe('whatsNewDue', () => {
  it('opens once on a version newer than the one last seen', () => {
    expect(whatsNewDue({ current: '0.1.56', lastSeen: '0.1.55', installedBefore: true })).toBe(true);
    expect(whatsNewDue({ current: '0.1.56', lastSeen: '0.1.56', installedBefore: true })).toBe(false);
    expect(whatsNewDue({ current: '0.1.55', lastSeen: '0.1.56', installedBefore: true })).toBe(false);
  });

  it('a fresh install opens nothing; an install from before the record opens it', () => {
    expect(whatsNewDue({ current: '0.1.56', lastSeen: null, installedBefore: false })).toBe(false);
    expect(whatsNewDue({ current: '0.1.56', lastSeen: null, installedBefore: true })).toBe(true);
    expect(whatsNewDue({ current: 'dev', lastSeen: null, installedBefore: true })).toBe(false);
  });
});

describe('barFor', () => {
  const notes = '## New in 0.1.57\n\n- B.\n\n## New in 0.1.56\n\n- A.\n\n## What you need\n\n- A PC.';

  it('a downloaded update asks for a restart, with the notes the reader has not seen', () => {
    const bar = barFor({ form: 'self', ready: true, availableVersion: '0.1.57', notes }, { current: '0.1.55', dismissed: null });
    expect(bar).toEqual({ version: '0.1.57', action: 'restart', notes: [{ version: '0.1.57', body: '- B.' }, { version: '0.1.56', body: '- A.' }] });
    expect(Object.isFrozen(bar)).toBe(true);
  });

  it('a system-package install offered a version asks for the downloads page', () => {
    expect(barFor({ form: 'notify', ready: false, availableVersion: '0.1.57', notes: null }, { current: '0.1.56', dismissed: null }))
      .toEqual({ version: '0.1.57', action: 'download', notes: [] });
  });

  it('a self install shows nothing until the download is done', () => {
    expect(barFor({ form: 'self', ready: false, availableVersion: '0.1.57', notes }, { current: '0.1.56', dismissed: null })).toBeNull();
  });

  it('later hides that version only; a newer one shows again', () => {
    const offer = { form: 'notify', ready: false, availableVersion: '0.1.57', notes: null };
    expect(barFor(offer, { current: '0.1.56', dismissed: '0.1.57' })).toBeNull();
    expect(barFor({ ...offer, availableVersion: '0.1.58' }, { current: '0.1.56', dismissed: '0.1.57' })?.version).toBe('0.1.58');
  });

  it('never offers the running version, an older one, or nothing', () => {
    expect(barFor({ form: 'self', ready: true, availableVersion: '0.1.56', notes }, { current: '0.1.56', dismissed: null })).toBeNull();
    expect(barFor({ form: 'self', ready: true, availableVersion: '0.1.50', notes }, { current: '0.1.56', dismissed: null })).toBeNull();
    expect(barFor({ form: 'dev', ready: false, availableVersion: null, notes: null }, { current: '0.1.56', dismissed: null })).toBeNull();
  });
});

describe('launchWhatsNew — on a real directory', () => {
  const dirs = [];
  const scratch = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whats-new-'));
    dirs.push(root);
    const userData = path.join(root, 'userData');
    const appPath = path.join(root, 'app');
    fs.mkdirSync(path.join(appPath, path.dirname(BUNDLED_NOTES)), { recursive: true });
    fs.mkdirSync(userData, { recursive: true });
    return { userData, appPath };
  };
  const seen = (userData) => JSON.parse(fs.readFileSync(path.join(userData, SEEN_FILE), 'utf8')).lastSeenVersion;
  const log = { warn: () => {} };
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  it('an update since the last seen version opens its notes, and records nothing until read', () => {
    const { userData, appPath } = scratch();
    fs.writeFileSync(path.join(userData, SEEN_FILE), JSON.stringify({ lastSeenVersion: '0.1.36' }));
    fs.copyFileSync(path.join(REPO, 'docs/operations/release-notes-0.1.39.md'), path.join(appPath, BUNDLED_NOTES));
    const shown = launchWhatsNew({ userData, appPath, current: '0.1.39', log });
    expect(shown.version).toBe('0.1.39');
    expect(shown.notes.map((n) => n.version)).toEqual(['0.1.39', '0.1.38', '0.1.37']);
    expect(seen(userData)).toBe('0.1.36');
  });

  it('a fresh install opens nothing and records the version it started on', () => {
    const { userData, appPath } = scratch();
    fs.writeFileSync(path.join(appPath, BUNDLED_NOTES), realNotes('0.1.39'));
    expect(launchWhatsNew({ userData, appPath, current: '0.1.39', log })).toBeNull();
    expect(seen(userData)).toBe('0.1.39');
  });

  it('an install that asked the feed before the record existed sees this version\'s section', () => {
    const { userData, appPath } = scratch();
    fs.writeFileSync(path.join(userData, '.updaterId'), 'an install id');
    fs.writeFileSync(path.join(appPath, BUNDLED_NOTES), realNotes('0.1.39'));
    expect(launchWhatsNew({ userData, appPath, current: '0.1.39', log }).notes.map((n) => n.version)).toEqual(['0.1.39']);
  });

  it('a version that carries no notes opens nothing and asks no more', () => {
    const { userData, appPath } = scratch();
    fs.writeFileSync(path.join(userData, SEEN_FILE), JSON.stringify({ lastSeenVersion: '0.1.55' }));
    expect(launchWhatsNew({ userData, appPath, current: '0.1.56', log })).toBeNull();
    expect(seen(userData)).toBe('0.1.56');
  });

  it('a damaged record reads as none', () => {
    const { userData, appPath } = scratch();
    fs.writeFileSync(path.join(userData, SEEN_FILE), '{ not json');
    expect(launchWhatsNew({ userData, appPath, current: '0.1.56', log })).toBeNull();
    expect(seen(userData)).toBe('0.1.56');
  });
});
