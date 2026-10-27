// The pure halves of COMPANY SOURCES: a company's repos list as its kit
// records it (branding/company-repos.js through kit-shape's company block),
// and the reading law `company_updates` draws with (company-updates-text.js).
// Real inputs, real outputs — nothing stands in for anything.
import { describe, test, expect } from 'vitest';
import { companyOf, companyRefusals } from '../../backend/services/branding/kit-shape.js';
import {
  SECRET_HELD, safeText, changelogGained, patchForBeing, pageMark, pageStates, renderUpdates,
} from '../../backend/services/marketing/company-updates-text.js';
import {
  repoState, sourcesTally, typedRepoRefusal, withTicked,
} from '../../frontend/app/RelinkShell/brandkits/company-sources-view.js';

// Built at run time so this file never carries a key-shaped string itself.
const FAKE_KEY = `sk-${'ant-'}${'q'.repeat(32)}`;

describe('the repos a company block records', () => {
  test('a path, a remote, or both — each with a short role; normalized on the way out', () => {
    const block = { repos: [
      { path: '/srv/acme/app', role: ' the app ' },
      { remote: 'https://github.com/acme/site', role: 'the website' },
      { path: 'relative/dir' },
    ] };
    expect(companyOf({ company: block }, 'acme').repos).toEqual([
      { path: '/srv/acme/app', remote: null, role: 'the app' },
      { path: null, remote: 'https://github.com/acme/site', role: 'the website' },
    ]);
    expect(companyOf({}, 'acme').repos).toEqual([]);
  });

  test('refusals name each fault in words', () => {
    expect(companyRefusals({ repos: [{ path: '/srv/a', remote: 'https://x.example/a', role: 'the app' }] }, 'acme')).toEqual([]);
    const out = companyRefusals({ repos: [
      { path: 'srv/a' }, { path: '/srv/../etc' }, { path: '/srv/b/' }, {}, { remote: 'git@host:x' },
      { path: '/srv/c', extra: 1 }, { path: '/srv/d', role: 'x'.repeat(61) }, { path: '/srv/e' }, { path: '/srv/e' },
    ] }, 'acme');
    expect(out.join('\n')).toMatch(/repos\[0\]\.path must be a full folder path/);
    expect(out.join('\n')).toMatch(/repos\[1\]\.path/);
    expect(out.join('\n')).toMatch(/repos\[2\]\.path/);
    expect(out.join('\n')).toMatch(/repos\[3\] needs a path on this machine, a remote web address, or both/);
    expect(out.join('\n')).toMatch(/repos\[4\]\.remote must be a web address/);
    expect(out.join('\n')).toMatch(/repos\[5\]\.extra is not a repo field/);
    expect(out.join('\n')).toMatch(/repos\[6\]\.role must be a few words/);
    expect(out.join('\n')).toMatch(/repos\[8\] repeats a repo already listed/);
    expect(companyRefusals({ repos: 'nope' }, 'acme')).toEqual(['company.repos must be a list of {path, remote, role}']);
    expect(companyRefusals({ repos: Array.from({ length: 13 }, (_, i) => ({ path: `/r/${i}` })) }, 'acme')[0]).toMatch(/at most 12/);
  });
});

describe('the reading law of company_updates', () => {
  test('a secret-shaped line is held back, the rest kept, the cap said', () => {
    const out = safeText(`Added\n- a line\nTOKEN ${FAKE_KEY}\n- another`, 1000);
    expect(out.held).toBe(1);
    expect(out.text).not.toContain(FAKE_KEY);
    expect(out.text).toContain(SECRET_HELD);
    expect(out.text).toContain('- another');
    expect(safeText('x'.repeat(50), 10)).toMatchObject({ capped: true, text: expect.stringContaining('cut at 10 characters') });
  });

  test('CHANGELOG: [Unreleased] when its text changed, and every new section', () => {
    const before = '# Changelog\n\n## [Unreleased]\n- old\n\n## [0.1.0]\n- first\n';
    const after = '# Changelog\n\n## [Unreleased]\n- old\n- new\n\n## [0.2.0]\n- second\n\n## [0.1.0]\n- first\n';
    expect(changelogGained(before, after)).toEqual([
      { heading: '[Unreleased]', body: '- old\n- new' },
      { heading: '[0.2.0]', body: '- second' },
    ]);
    expect(changelogGained(after, after)).toEqual([]);
    expect(changelogGained(null, '## [Unreleased]\n- a\n').map((s) => s.heading)).toEqual(['[Unreleased]']);
  });

  test('a patch keeps only the files a being may read; walled ones go whole, stat line too', () => {
    const patch = [
      'commit abc', '', 'subject', '',
      ' .env       | 1 +', ' src/app.js | 2 +-', ' 2 files changed', '',
      'diff --git a/.env b/.env', '+KEY=1', 'diff --git a/src/app.js b/src/app.js', '+const a = 1;', '',
    ].join('\n');
    const cut = patchForBeing(patch, (f) => f !== '.env');
    expect(cut.withheld).toBe(1);
    expect(cut.text).toContain('src/app.js');
    expect(cut.text).not.toContain('KEY=1');
    expect(cut.text).not.toMatch(/\.env\s+\|/);
  });

  test('pages: new, changed or the same against the last report\'s marks', () => {
    const a = pageMark('Hello   world');
    expect(a).toBe(pageMark('Hello world'));
    expect(pageStates({ 'https://a.example/': a }, [
      { url: 'https://a.example/', mark: a }, { url: 'https://a.example/x', mark: 'm' },
    ]).map((p) => p.state)).toEqual(['same', 'new']);
    expect(pageStates({ 'https://a.example/': a }, [{ url: 'https://a.example/', mark: 'other' }])[0].state).toBe('changed');
  });

  test('the answer cites every line and never claims an unread repo has no changes', () => {
    const text = renderUpdates({
      company: { name: 'Acme' },
      window: { since: '2026-10-01T00:00:00.000Z', why: 'the date you gave' },
      repos: [
        { path: '/r/app', remote: null, role: 'the app', base: 'aaaaaaaaaaaa', head: 'bbbbbbbbbbbb', total: 1,
          commits: [{ sha: 'cccccccccccc', at: '2026-10-02T00:00:00Z', subject: 'feat: a thing' }],
          fragments: [{ file: 'changelog.d/a.md', sha: 'cccccccccccc', text: 'Added\n- a thing' }], changelog: [], notes: [] },
        { path: '/r/site', remote: null, role: 'the website', unread: 'your operator has not let you read it' },
      ],
      site: null, marked: null, held: 0,
    }, 'TOKEN1');
    expect(text).toContain('### the app — /r/app');
    expect(text).toContain('ccccccccc · 2026-10-02 · feat: a thing');
    expect(text).toContain('/r/app: changelog.d/a.md (added in ccccccccc)');
    expect(text).toContain('NOT READ: your operator has not let you read it');
    expect(text).toContain('BEGIN EXTERNAL CONTENT TOKEN1');
    expect(text).toContain('call again with markReported: true');
  });
});

describe('the SITE & CODE display model', () => {
  const cmo = { laneId: 'aurel' };
  test('each repo says what it is to the CMO', () => {
    expect(repoState({ path: null, remote: 'https://x' }, cmo).key).toBe('remote');
    expect(repoState({ path: '/a', onDisk: false }, cmo).key).toBe('missing');
    expect(repoState({ path: '/a', granted: true, onDisk: true }, cmo).label).toBe('THE CMO CAN READ');
    expect(repoState({ path: '/a', granted: false, onDisk: true }, null).key).toBe('no-cmo');
    expect(repoState({ path: '/a', granted: false, onDisk: true }, cmo).label).toBe('NOT LENT');
    expect(sourcesTally({ repos: [{ path: '/a', granted: true }, { path: null, remote: 'https://x' }] })).toEqual({ repos: 2, readable: 1, here: 1 });
  });
  test('a typed repo is refused in words; only ticked proposals are added', () => {
    expect(typedRepoRefusal({ path: '', remote: '' }, [])).toMatch(/NAME THE FOLDER/);
    expect(typedRepoRefusal({ path: 'rel', remote: '' }, [])).toMatch(/FULL PATH/);
    expect(typedRepoRefusal({ path: '/a', remote: '' }, [{ path: '/a' }])).toMatch(/LISTED ALREADY/);
    expect(typedRepoRefusal({ path: '/a', remote: 'https://x' }, [])).toBeNull();
    expect(withTicked([{ path: '/a', role: 'the app', granted: true }], [
      { path: '/b', remote: null, role: 'the website', ticked: true }, { path: '/c', remote: null, role: '', ticked: false },
    ])).toEqual([{ path: '/a', role: 'the app' }, { path: '/b', role: 'the website' }]);
  });
});
