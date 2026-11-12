/**
 * THE ACCESSIBILITY SCAN (AGENTS.md's accessibility rule, Design note, 2026-11-12: […]). axe-core over a real
 * page in a real browser — the Playwright end-to-end lane and the vitest
 * real-Chromium lane alike — judged against the screen's own frozen baseline
 * (test/a11y-baseline/<screen>.json) the way the lint judges a file
 * (scripts/a11y-lint-law.mjs): a rule's count may shrink, never grow, and a
 * rule the screen never broke is a new finding.
 *
 *   A11Y_WRITE_BASELINE=1  — enrol a screen that has no baseline yet, or
 *                            ratchet an existing one DOWN (never up).
 *
 * One file per screen, so parallel workers never write the same file.
 * impure — the browser, the baseline files.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { judge, ratchetDown } from '../../scripts/a11y-lint-law.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../a11y-baseline');
/** WCAG 2.1 A and AA — what the rule holds the desk to. */
export const A11Y_TAGS = Object.freeze(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);

/**
 * axe over the page, or one part of it. impure.
 * @param {import('playwright-core').Page} page
 * @param {{include?: string, exclude?: string[]}} [scope]
 * @returns {Promise<{counts: Record<string, number>, violations: object[]}>} counts — nodes per rule
 */
export const axeScan = async (page, { include = null, exclude = [] } = {}) => {
  let builder = new AxeBuilder({ page }).withTags([...A11Y_TAGS]);
  if (include) builder = builder.include(include);
  for (const e of exclude) builder = builder.exclude(e);
  const { violations } = await builder.analyze();
  const counts = Object.fromEntries(violations.map((v) => [v.id, v.nodes.length]).sort(([a], [b]) => a.localeCompare(b)));
  return { counts, violations };
};

const fileOf = (screen) => path.join(DIR, `${screen.replace(/[^a-z0-9-]/gi, '-')}.json`);

/**
 * Scan one screen and judge it against its baseline. impure.
 * @returns {Promise<{grown: object[], shrunk: object[], counts: Record<string, number>, enrolled: boolean, detail: string}>}
 *   grown — the new findings (the caller fails on any); detail — each one's rule, help and first targets
 */
export const a11yCheck = async (page, screen, scope = {}) => {
  const { counts, violations } = await axeScan(page, scope);
  const file = fileOf(screen);
  const saved = await fs.readFile(file, 'utf8').then(JSON.parse, () => null);
  const writing = process.env.A11Y_WRITE_BASELINE === '1';
  if (!saved && writing) {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(counts, null, 2)}\n`);
    return { grown: [], shrunk: [], counts, enrolled: true, detail: '' };
  }
  const baseline = { [screen]: saved || {} };
  const { grown, shrunk } = judge({ [screen]: counts }, baseline, [screen]);
  if (writing && shrunk.length) await fs.writeFile(file, `${JSON.stringify(ratchetDown(baseline, { [screen]: counts }, [screen])[screen] || {}, null, 2)}\n`);
  const detail = grown.map((g) => {
    const v = violations.find((x) => x.id === g.rule);
    return `${g.rule} ${g.was} → ${g.now}: ${v?.help || ''} — ${(v?.nodes || []).slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`;
  }).join('\n');
  return { grown, shrunk, counts, enrolled: false, detail: saved ? detail : `${screen} has no accessibility baseline — enrol it with A11Y_WRITE_BASELINE=1\n${detail}` };
};
