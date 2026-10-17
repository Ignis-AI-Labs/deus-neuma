// The legal watch's three scanners, each on a REAL repo on real temp disk
// (RULE 0): a real lockfile and real installed package.json files for the
// licence scan, real papers for the posture probe, real git commits for the
// build watch. What is proven is what the Praetor will be handed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { initRepo, commitFiles } from '../helpers/legal-repo-fixture.js';
import { classifyLicense, runLicenseScan } from '../../backend/services/legal/license-scan.js';
import { runPostureProbe } from '../../backend/services/legal/posture-probe.js';
import { runBuildWatch } from '../../backend/services/legal/build-watch.js';
import { pathTokens, areasOfCommit } from '../../backend/services/legal/regulated-areas.js';

let root;
beforeAll(async () => { root = await createTempDir('legal-scanners'); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('the licence classes', () => {
  it('reads SPDX expressions: OR is the licensee\'s choice, AND binds all, exceptions lift', () => {
    expect(classifyLicense('MIT')).toBe('permissive');
    expect(classifyLicense('(MIT OR GPL-3.0-only)')).toBe('permissive');
    expect(classifyLicense('Apache-2.0 AND LGPL-3.0-or-later')).toBe('weak-copyleft');
    expect(classifyLicense('MIT AND (GPL-2.0-only OR AGPL-3.0-only)')).toBe('strong-copyleft');
    expect(classifyLicense('GPL-2.0-only WITH Classpath-exception-2.0')).toBe('weak-copyleft');
    expect(classifyLicense('GPL-3.0-or-later')).toBe('strong-copyleft');
    expect(classifyLicense('AGPL-3.0-only')).toBe('network-copyleft');
    expect(classifyLicense('SSPL-1.0')).toBe('network-copyleft');
    expect(classifyLicense('CC-BY-NC-4.0')).toBe('non-commercial');
    expect(classifyLicense('BUSL-1.1')).toBe('non-commercial');
    expect(classifyLicense('OFL-1.1')).toBe('permissive');
    for (const unread of [undefined, null, '', 'UNLICENSED', 'SEE LICENSE IN LICENSE', 'Some-Custom-Terms', '(MIT AND']) {
      expect(classifyLicense(unread), String(unread)).toBe('unknown');
    }
  });
});

describe('the licence scan', () => {
  it('classifies what SHIPS (dev skipped), reads the installed package when the lockfile is silent, groups a weak family', async () => {
    const repo = path.join(root, 'shipping');
    await fs.mkdir(repo, { recursive: true });
    await fs.writeFile(path.join(repo, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'shipping' },
        'node_modules/ok': { version: '1.0.0', license: 'MIT' },
        'node_modules/copyleft': { version: '2.0.0', license: 'GPL-3.0-only' },
        'node_modules/served': { version: '1.1.0', license: 'AGPL-3.0-only' },
        'node_modules/tooling': { version: '9.9.9', license: 'AGPL-3.0-only', dev: true },
        'node_modules/libvips-a': { version: '8.0.0', license: 'LGPL-3.0-or-later' },
        'node_modules/libvips-b': { version: '8.0.0', license: 'Apache-2.0 AND LGPL-3.0-or-later' },
        'node_modules/quiet': { version: '0.1.0' },
        'node_modules/declared-on-disk': { version: '3.0.0' },
      },
    }));
    await fs.mkdir(path.join(repo, 'node_modules/quiet'), { recursive: true });
    await fs.writeFile(path.join(repo, 'node_modules/quiet/package.json'), '{"name":"quiet"}');
    await fs.writeFile(path.join(repo, 'node_modules/quiet/LICENSE'), '\nCopyright (c) 2010 Quiet Author\n\nPermission is hereby granted');
    await fs.mkdir(path.join(repo, 'node_modules/declared-on-disk'), { recursive: true });
    await fs.writeFile(path.join(repo, 'node_modules/declared-on-disk/package.json'), '{"licenses":[{"type":"MIT"}]}');

    const scan = await runLicenseScan({ id: 'shipping', path: repo });
    expect(scan.error).toBeNull();
    expect(scan.shipped).toBe(7); // the dev-only AGPL tool never ships
    expect(scan.byClass).toEqual({ permissive: 2, 'strong-copyleft': 1, 'network-copyleft': 1, 'weak-copyleft': 2, unknown: 1 });
    const byId = Object.fromEntries(scan.matters.map((m) => [m.externalId, m]));
    expect(Object.keys(byId).sort()).toEqual(['license-family:LGPL-3.0-or-later', 'license:copyleft', 'license:quiet', 'license:served']);
    expect(byId['license:served'].severity).toBe('critical');
    expect(byId['license:copyleft'].severity).toBe('high');
    expect(byId['license:quiet'].summary).toContain('Copyright (c) 2010 Quiet Author');
    expect(byId['license-family:LGPL-3.0-or-later'].affected).toEqual(['libvips-a@8.0.0', 'libvips-b@8.0.0']);
    expect(scan.matters.every((m) => m.area === 'license' && m.source === 'license-scan' && m.repo === 'shipping')).toBe(true);
  });

  it('a repo with no lockfile is not an error; an unreadable one is named', async () => {
    const bare = path.join(root, 'bare');
    await fs.mkdir(bare, { recursive: true });
    expect(await runLicenseScan({ id: 'bare', path: bare })).toMatchObject({ shipped: 0, matters: [], error: null });
    await fs.writeFile(path.join(bare, 'package-lock.json'), '{ not json');
    expect((await runLicenseScan({ id: 'bare', path: bare })).error).toMatch(/lockfile unreadable/);
  });
});

describe('the posture probe', () => {
  it('an installed app with a proprietary licence, no package licence, and no privacy notice — each named', async () => {
    const repo = await initRepo(path.join(root, 'app'));
    await commitFiles(repo, 'the app', {
      LICENSE: 'Copyright (c) 2026 Fixture LLC. All Rights Reserved.\n\nPROPRIETARY AND CONFIDENTIAL\n',
      'package.json': { name: 'app', dependencies: { electron: '1.0.0', express: '1.0.0' } },
      'docs/legal/EULA.md': '# EULA\n',
      'docs/legal/THIRD_PARTY_ATTRIBUTIONS.md': '# Credits\n\nexpress — MIT\n',
      'package-lock.json': { lockfileVersion: 3, packages: {} },
    });
    const probe = await runPostureProbe({ id: 'app', path: repo }, { shippedNames: ['express'] });
    expect(probe.error).toBeNull();
    expect(probe.papers).toMatchObject({ licences: ['LICENSE'], terms: ['docs/legal/EULA.md'], privacy: [], app: true });
    const ids = probe.matters.map((m) => m.externalId);
    expect(ids).toContain('posture:package-licence-missing');
    expect(ids).toContain('posture:no-privacy-policy');
    expect(ids).not.toContain('posture:no-terms');
    // the attributions name the one shipped package — no omission to flag
    expect(ids).not.toContain('posture:attributions-omit-packages');
    expect(probe.matters.find((m) => m.externalId === 'posture:package-licence-missing').summary).toMatch(/UNLICENSED/);
  });

  it('the papers put right clear the findings; two licences that disagree are named', async () => {
    const repo = await initRepo(path.join(root, 'papers'));
    await commitFiles(repo, 'papers', {
      LICENSE: 'Copyright (c) 2026 Fixture LLC. All Rights Reserved.\n',
      'package.json': { name: 'papers', license: 'UNLICENSED', dependencies: { electron: '1.0.0' } },
      'docs/legal/TERMS_OF_SERVICE.md': '# Terms\n',
      'docs/legal/PRIVACY.md': '# Privacy\n',
    });
    expect((await runPostureProbe({ id: 'papers', path: repo })).matters).toEqual([]);

    await commitFiles(repo, 'a stray licence field', { 'package.json': { name: 'papers', license: 'MIT', dependencies: { electron: '1.0.0' } } });
    const mismatch = (await runPostureProbe({ id: 'papers', path: repo })).matters;
    expect(mismatch.map((m) => m.externalId)).toEqual(['posture:licence-mismatch']);
    expect(mismatch[0].summary).toContain('"MIT"');
  });

  it('attributions older than the dependencies are named as stale', async () => {
    const repo = await initRepo(path.join(root, 'stale'));
    await commitFiles(repo, 'credits', {
      LICENSE: 'MIT License\n\nPermission is hereby granted, free of charge',
      'package.json': { name: 'stale', license: 'MIT' },
      'NOTICE.md': 'lodash\n',
    });
    // git dates are second-resolution: the lockfile's commit must be LATER
    await new Promise((r) => setTimeout(r, 1100));
    await commitFiles(repo, 'deps moved', { 'package-lock.json': { lockfileVersion: 3, packages: {} } });
    const ids = (await runPostureProbe({ id: 'stale', path: repo }, { shippedNames: ['lodash'] })).matters.map((m) => m.externalId);
    expect(ids.some((id) => id.startsWith('posture:attributions-stale@'))).toBe(true);
  });
});

describe('the build watch', () => {
  it('matches by whole token, never substring', () => {
    expect(pathTokens('frontend/app/BirthLocation/geo-fix.test.js')).toEqual(['frontend', 'app', 'birth', 'location', 'geo', 'fix', 'test', 'js']);
    const ids = (files, subject = 'chore: tidy') => areasOfCommit({ subject, files }).map((h) => h.area.id);
    expect(ids(['frontend/page.js', 'src/image.js', 'src/message.js'])).toEqual([]); // no "age" hides in page/image/message
    expect(ids(['src/age-gate.js'])).toEqual(['minors-adult']);
    expect(ids(['src/util.js'], 'feat(birth): read the location from the machine')).toEqual(['privacy']);
  });

  it('one matter per touched area, naming its commits; ledgers and tests are not what we build', async () => {
    const repo = await initRepo(path.join(root, 'building'));
    await commitFiles(repo, 'chore: the first files', { 'README.md': '# building\n' });
    // git keeps commit times to the SECOND and --since includes that whole
    // second (inclusive by design: a missed commit is worse than a re-seen one,
    // which the ledger dedups). Step past the first commit's second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const since = new Date().toISOString();
    const geo = await commitFiles(repo, 'feat(birth): read the place from the machine', { 'backend/services/birth-location.js': 'export const at = 1;\n' });
    await commitFiles(repo, 'test: voice cases', { 'test/unit/voice-clone.test.js': 'x\n', 'docs/work/voice.md': 'x\n' });
    const voice = await commitFiles(repo, 'feat: a new speaker', { 'backend/services/tts/speaker.js': 'x\n' });

    const watch = await runBuildWatch({ id: 'building', path: repo }, { since });
    expect(watch.error).toBeNull();
    expect(watch.commits).toBe(3);
    const byArea = Object.fromEntries(watch.matters.map((m) => [m.externalId.split('@')[0], m]));
    expect(Object.keys(byArea).sort()).toEqual(['build:privacy', 'build:voice-likeness']);
    expect(byArea['build:privacy'].externalId).toBe(`build:privacy@${geo.slice(0, 12)}`);
    expect(byArea['build:privacy'].affected).toHaveLength(1);
    expect(byArea['build:privacy'].summary).toMatch(/GDPR/);
    // the tests-and-ledger commit touched no area; only the speaker did
    expect(byArea['build:voice-likeness'].affected).toEqual([expect.stringContaining(voice.slice(0, 9))]);
    expect(watch.matters.every((m) => m.area === 'product' && m.source === 'build-watch')).toBe(true);
  });

  it('a path that is not a repo names its failure', async () => {
    const nowhere = path.join(root, 'not-a-repo');
    await fs.mkdir(nowhere, { recursive: true });
    const watch = await runBuildWatch({ id: 'nowhere', path: nowhere });
    expect(watch.error).toMatch(/git log failed/);
    expect(watch.matters).toEqual([]);
  });
});
