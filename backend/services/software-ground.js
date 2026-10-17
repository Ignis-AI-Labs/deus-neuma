/**
 * SOFTWARE GROUND — is the open folder a software project? The coding hands
 * (branch state, sync, the shell) and the coding standards are the cost of
 * SOFTWARE work; they ride from round 0 only where that work can happen (Founder
 * 2026-10-14: […] — an empty or document folder paid ~2,000 tokens of
 * coding schemas and standards on every request, measured by
 * scripts/prompt-cost-probe.mjs). Elsewhere they stay one tool_search away.
 *
 * A project is named by its markers: version control, or a build/package
 * manifest of a mainstream toolchain. lstat only — a marker is never read,
 * so a hostile folder costs a handful of stats.
 */
import fs from 'fs/promises';
import path from 'path';

export const SOFTWARE_MARKERS = Object.freeze([
  '.git', 'package.json', 'deno.json', 'tsconfig.json', 'pyproject.toml', 'setup.py', 'requirements.txt',
  'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'CMakeLists.txt', 'Makefile',
  'composer.json', 'Gemfile', 'mix.exs', 'Package.swift', 'pubspec.yaml',
]);

/**
 * impure (lstat) — whether a ground carries a software project's marker.
 * @param {string|null} ground
 * @returns {Promise<boolean>}
 */
export const isSoftwareGround = async (ground) => {
  if (typeof ground !== 'string' || ground === '') return false;
  const found = await Promise.all(SOFTWARE_MARKERS.map((name) => fs.lstat(path.join(ground, name)).then(() => true, () => false)));
  return found.some(Boolean);
};
