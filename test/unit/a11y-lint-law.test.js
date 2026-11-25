/**
 * THE ACCESSIBILITY LINT (scripts/a11y-lint-law.mjs, scripts/check-a11y.mjs;
 * AGENTS.md's accessibility rule, 2026-11-12). The pure law with real inputs,
 * and the real ESLint with the real jsx-a11y plugin over real JSX — no mock:
 * a screen that adds an unlabelled control or a click-only <div> is a new
 * finding; the baseline only ever falls.
 */
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import { a11yLintConfig, countFindings, judge, ratchetDown, totalOf } from '../../scripts/a11y-lint-law.mjs';

const lint = async (code, file = '/repo/frontend/app/Thing.jsx') => {
  const eslint = new ESLint({ cwd: '/repo', overrideConfigFile: true, overrideConfig: a11yLintConfig(jsxA11y) });
  return eslint.lintText(code, { filePath: file });
};
const rel = (abs) => abs.replace('/repo/', '');

describe('the real lint over real JSX', () => {
  it('a click-only <div>, an image with no alt and an autofocus are findings; a labelled button is not', async () => {
    const bad = await lint('export const A = () => (<><div onClick={() => 1}>go</div><img src="x.png" /><input autoFocus /></>);');
    expect(Object.keys(countFindings(bad, rel)['frontend/app/Thing.jsx']).sort()).toEqual([
      'jsx-a11y/alt-text', 'jsx-a11y/click-events-have-key-events', 'jsx-a11y/no-autofocus', 'jsx-a11y/no-static-element-interactions',
    ]);
    const good = await lint('export const B = () => (<button type="button" aria-label="close" onClick={() => 1}>×</button>);');
    expect(countFindings(good, rel)).toEqual({});
  });

  it('a disable comment naming a rule this lint does not load is no finding of ours', async () => {
    const out = await lint('// eslint-disable-next-line react-hooks/exhaustive-deps\nexport const C = () => <p>ok</p>;');
    expect(out[0].messages.some((m) => m.ruleId === 'react-hooks/exhaustive-deps')).toBe(true);
    expect(countFindings(out, rel)).toEqual({});
  });
});

describe('the baseline law', () => {
  const BASE = { 'frontend/a.jsx': { 'jsx-a11y/no-autofocus': 2 }, 'frontend/b.jsx': { 'jsx-a11y/alt-text': 1 } };

  it('a count above the baseline, or a rule the file never broke, is a new finding; below is a ratchet-down', () => {
    const now = { 'frontend/a.jsx': { 'jsx-a11y/no-autofocus': 3, 'jsx-a11y/alt-text': 1 } };
    const { grown, shrunk } = judge(now, BASE, ['frontend/a.jsx', 'frontend/b.jsx']);
    expect(grown).toEqual([
      { file: 'frontend/a.jsx', rule: 'jsx-a11y/no-autofocus', was: 2, now: 3 },
      { file: 'frontend/a.jsx', rule: 'jsx-a11y/alt-text', was: 0, now: 1 },
    ]);
    expect(shrunk).toEqual([{ file: 'frontend/b.jsx', rule: 'jsx-a11y/alt-text', was: 1, now: 0 }]);
  });

  it('only the files read are judged — a staged run never fails on a file it did not read', () => {
    expect(judge({}, BASE, ['frontend/c.jsx'])).toEqual({ grown: [], shrunk: [] });
  });

  it('the ratchet only falls: a fix lowers it, a new finding never raises it, an unread file keeps its count', () => {
    const now = { 'frontend/a.jsx': { 'jsx-a11y/no-autofocus': 5 }, 'frontend/z.jsx': { 'jsx-a11y/alt-text': 9 } };
    expect(ratchetDown(BASE, now, ['frontend/a.jsx', 'frontend/b.jsx', 'frontend/z.jsx'])).toEqual({ 'frontend/a.jsx': { 'jsx-a11y/no-autofocus': 2 } });
    expect(ratchetDown(BASE, {}, ['frontend/a.jsx'])).toEqual({ 'frontend/b.jsx': { 'jsx-a11y/alt-text': 1 } });
    expect(totalOf(BASE)).toBe(3);
  });
});
