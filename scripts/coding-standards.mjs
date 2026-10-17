#!/usr/bin/env node
/** impure — import a reviewed canonical checkout into a NEW directory, or verify the shipped pin. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_ROOT, readStandardsBundle } from '../backend/services/coding-standards/bundle.js';
import { readCanonicalStandards } from '../backend/services/coding-standards/source.js';
import { checkStandardsFreshness, formatFreshness } from '../backend/services/coding-standards/freshness.js';
import { isPermittedPullRequest } from '../backend/services/coding-standards/branch-flow.js';

const importBundle = async (source, output) => {
  const { manifest, files, sourceManifest } = await readCanonicalStandards(source);
  const names = Object.keys(files);
  // Exclusive mkdir makes overwrite refusal atomic, including symlink destinations.
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, 'source-manifest.json'), sourceManifest, { flag: 'wx' });
  for (const name of names) await fs.writeFile(path.join(output, `${name}.md`), files[name], { flag: 'wx' });
  await fs.writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await readStandardsBundle(output);
};

try {
  const [command = 'check', ...args] = process.argv.slice(2);
  if (command === 'check-upstream' && args.filter((arg) => arg !== '--force').length <= 1
    && args.filter((arg) => arg === '--force').length <= 1) {
    const source = args.find((arg) => arg !== '--force');
    const report = await checkStandardsFreshness({
      sourceRoot: source ? path.resolve(source) : fileURLToPath(new URL('../../coding-standards/', import.meta.url)),
      receiptPath: fileURLToPath(new URL('../cache/coding-standards-upstream.json', import.meta.url)),
      force: args.includes('--force'),
    });
    process.stdout.write(`${formatFreshness(report)}\n`);
    if (report.status === 'review_needed') process.exitCode = 2;
  } else if (command === 'check-pr' && args.length === 0) {
    const topology = JSON.parse(await fs.readFile(new URL('./coding-standards-policy.json', import.meta.url), 'utf8'));
    if (!isPermittedPullRequest({ head: process.env.NEUMA_PR_HEAD, base: process.env.NEUMA_PR_BASE }, topology)) {
      throw new Error('PR must flow from a personal /dev branch to dev, or from dev to a declared production branch.');
    }
    process.stdout.write('Pull request branch flow verified. Maintainer review and merge authorization remain required.\n');
  } else if (command === 'import' && args.length === 2) {
    await importBundle(path.resolve(args[0]), path.resolve(args[1]));
    process.stdout.write('Standards imported. Review the pin and policy diff before adoption.\n');
  } else if (command === 'check' && args.length <= 1) {
    const { manifest } = await readStandardsBundle(args[0] ? path.resolve(args[0]) : BUNDLE_ROOT);
    process.stdout.write(`Ignis ${manifest.version}: ${Object.keys(manifest.files).length} standards verified; sha256:${manifest.sourceDigest}\n`);
  } else throw new Error('Usage: node scripts/coding-standards.mjs check [bundle] | check-upstream [source-checkout] [--force] | check-pr | import <source-checkout> <new-output-directory>');
} catch (error) {
  process.stderr.write(`Coding standards check failed: ${error.message}\n`);
  process.exitCode = 1;
}
