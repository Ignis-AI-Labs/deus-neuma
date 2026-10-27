// changelog-rules — the commit-msg gate's verdict and the fragment grammar (AGENTS.md Rule 11).
import { describe, test, expect } from 'vitest';
import { changelogVerdict, parseFragment, parseSectionBody, renderGroups } from '../../scripts/changelog-rules.js';

describe('changelogVerdict', () => {
  const product = ['frontend/app/RelinkShell/UpdateBar.jsx'];

  test('a product feat with no line is refused, with the way through', () => {
    const v = changelogVerdict({ message: 'feat(update): a bar', staged: product });
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/changelog\.d\/<slug>\.md/);
    expect(v.why).toMatch(/Changelog: none/);
  });

  test('a fragment, a CHANGELOG.md edit, or "Changelog: none" carries it', () => {
    expect(changelogVerdict({ message: 'fix: x', staged: [...product, 'changelog.d/update-bar.md'] }).ok).toBe(true);
    expect(changelogVerdict({ message: 'fix: x', staged: [...product, 'CHANGELOG.md'] }).ok).toBe(true);
    expect(changelogVerdict({ message: 'fix: x\n\nChangelog: none — internal rename\n', staged: product }).ok).toBe(true);
  });

  test('not user-facing: other kinds, internal scopes, tests-only, docs-only', () => {
    expect(changelogVerdict({ message: 'refactor(core): split', staged: ['core/a.js'] }).ok).toBe(true);
    expect(changelogVerdict({ message: 'build(v0.1.56): bump', staged: ['package.json'] }).ok).toBe(true);
    expect(changelogVerdict({ message: 'fix(test): pin', staged: ['backend/x.js'] }).ok).toBe(true);
    expect(changelogVerdict({ message: 'fix: flaky', staged: ['test/unit/a.test.js', 'backend/a.test.js'] }).ok).toBe(true);
    expect(changelogVerdict({ message: 'feat: runbook', staged: ['docs/operations/release-runbook.md'] }).ok).toBe(true);
  });

  test('a breaking-change mark and a scope still count as user-facing', () => {
    expect(changelogVerdict({ message: 'feat(social)!: new card', staged: ['backend/services/social/a.js'] }).ok).toBe(false);
  });
});

describe('fragments and sections', () => {
  test('a fragment names its section and its lines', () => {
    expect(parseFragment('Fixed\n- One press sets the model up once.\n- Another\n  wrapped line.\n')).toEqual({
      section: 'Fixed', lines: ['- One press sets the model up once.', '- Another\n  wrapped line.'],
    });
  });

  test('a fragment with an unknown section or no bullets is refused', () => {
    expect(parseFragment('Improved\n- x').error).toMatch(/first line/);
    expect(parseFragment('Added\nno bullet').error).toMatch(/start with/);
  });

  test('a section body round-trips through its groups, prose dropped', () => {
    const body = 'Work since 0.1.54.\n\n### Added\n\n- A bar.\n- Notes\n  wrap.\n\n### Fixed\n\n- A test.\n';
    const { groups, prose } = parseSectionBody(body);
    expect(prose).toEqual(['Work since 0.1.54.']);
    expect(groups.Added).toEqual(['- A bar.', '- Notes\n  wrap.']);
    expect(renderGroups(groups)).toBe('### Added\n\n- A bar.\n- Notes\n  wrap.\n\n### Fixed\n\n- A test.');
  });
});
