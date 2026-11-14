#!/usr/bin/env node
/**
 * check-a11y — the ACCESSIBILITY LINT (AGENTS.md, the accessibility rule; Founder
 * 2026-11-12: […]).
 * eslint-plugin-jsx-a11y's recommended rules over every tracked frontend
 * .jsx, read from the INDEX (what is committed or staged — never another
 * session's unstaged edit), judged against scripts/a11y-baseline.json the way
 * the size law judges lines: a count may shrink, never grow.
 *
 *   node scripts/check-a11y.mjs                    judge every tracked .jsx
 *   node scripts/check-a11y.mjs --staged           judge staged .jsx only (the pre-commit gate)
 *   node scripts/check-a11y.mjs --write-baseline   ratchet the baseline DOWN to what is found (never up)
 *   node scripts/check-a11y.mjs --init             write the first baseline (refused when one exists)
 *
 * A new finding is fixed, not baselined; raising the baseline is a hand edit
 * Founder signs. impure — git, ESLint, the baseline file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import { a11yLintConfig, countFindings, judge, ratchetDown, totalOf } from './a11y-lint-law.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(root, 'scripts', 'a11y-baseline.json');
const args = new Set(process.argv.slice(2));
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const isJsx = (f) => f.startsWith('frontend/') && f.endsWith('.jsx');

const files = (args.has('--staged')
  ? git('diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR')
  : git('ls-files', '-z', '--', 'frontend')).split('\0').filter(isJsx);

const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: a11yLintConfig(jsxA11y) });

const results = [];
for (const file of files) {
  results.push(...await eslint.lintText(git('show', `:${file}`), { filePath: path.join(root, file) }));
}
const current = countFindings(results, (abs) => path.relative(root, abs));
const where = new Map(results.flatMap((r) => r.messages.filter((m) => m.ruleId?.startsWith('jsx-a11y/'))
  .map((m) => [`${path.relative(root, r.filePath)}|${m.ruleId}`, `${m.line}:${m.column} ${m.message}`])));

if (args.has('--init')) {
  if (fs.existsSync(BASELINE)) { console.error('a11y: a baseline exists — ratchet it with --write-baseline'); process.exit(1); }
  fs.writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`a11y: baseline written — ${totalOf(current)} finding(s) in ${Object.keys(current).length} of ${files.length} file(s)`);
  process.exit(0);
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const { grown, shrunk } = judge(current, baseline, files);

if (args.has('--write-baseline')) {
  const next = ratchetDown(baseline, current, files);
  fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`a11y: baseline ratcheted down ${totalOf(baseline)} → ${totalOf(next)}${grown.length ? ` — ${grown.length} new finding(s) still fail` : ''}`);
  process.exit(grown.length ? 1 : 0);
}

for (const g of grown) {
  console.error(`${g.file}: ${g.rule} ${g.was} → ${g.now}  (${where.get(`${g.file}|${g.rule}`) || ''})`);
}
const note = shrunk.length ? `, ${shrunk.length} ratchet-down(s) available (--write-baseline)` : '';
console.log(`a11y: ${files.length} file(s) judged — ${grown.length} new finding(s)${note}; baseline ${totalOf(baseline)}`);
process.exit(grown.length ? 1 : 0);
