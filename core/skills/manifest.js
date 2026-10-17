// #22 S1 — Skill manifest: parse + validate SKILL.md frontmatter.
//
// A skill is a directory containing at minimum a SKILL.md whose YAML
// frontmatter declares the skill's identity + shape. The CLI runtime
// (cli.js) and any library code (lib/) are implementation; SKILL.md is
// the contract.
//
// This module owns just the contract: read SKILL.md, validate the
// frontmatter against the documented schema, return a typed object the
// registry can store + query. It does NOT execute or sandbox the skill's
// code — that's the runtime's job (S4).
//
// Manifest schema (frontmatter):
//   REQUIRED
//     name        kebab-case identifier, [a-z0-9-]+, unique across registry
//     description one-paragraph hook explaining what the skill does (for the
//                 RPG tree, marketplace listing, prompt-time context)
//   OPTIONAL
//     category     grouping for the tree UI ("memory" | "tools" | etc.)
//     version      skill's own version (orthogonal to platform version)
//     dependencies string[] of other skill names this needs acquired first.
//                  The registry computes the reverse edge (`unlocks`) — never
//                  declared by the skill, to avoid drift.
//     metadata     free-form object for community extensions

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

const NAME_RE = /^[a-z][a-z0-9-]*$/;

// Pure — split SKILL.md text into { frontmatter: string|null, body: string }.
// Returns frontmatter=null when the file has no YAML frontmatter block
// (just a body, or only a body). A frontmatter block opens with a line that
// is exactly `---` and closes with the next line that is exactly `---`.
//
// CRLF normalization (ai6 R2.2): SKILL.md files authored on Windows with
// git autocrlf will arrive with `\r\n` endings. We normalize to LF before
// fence detection so the line comparison stays simple AND the returned
// frontmatter/body strings are platform-independent.
const splitFrontmatter = (rawText) => {
  const text = rawText.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { frontmatter: null, body: text };
  // Locate the closing fence. We search line-by-line so `---` inside the
  // body content can't terminate the block.
  const lines = text.split('\n');
  // lines[0] is the opening fence. Find the next line that's exactly '---'.
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') { closeIdx = i; break; }
  }
  if (closeIdx === -1) return { frontmatter: null, body: text };
  return {
    frontmatter: lines.slice(1, closeIdx).join('\n'),
    body: lines.slice(closeIdx + 1).join('\n'),
  };
};

// Pure — validate + normalize a parsed frontmatter object into the typed
// manifest fields. Throws on schema violations with a clear message naming
// the offending field. Caller adds the filesystem-derived fields (path,
// hasCli, hasLib) on top.
const validateFrontmatter = (parsed) => {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('frontmatter must be a YAML mapping (object)');
  }
  const { name, description, category, version, dependencies, metadata, ...rest } = parsed;

  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`name must be kebab-case matching ${NAME_RE} (got: ${JSON.stringify(name)})`);
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error('description must be a non-empty string');
  }
  if (category !== undefined && typeof category !== 'string') {
    throw new Error('category must be a string when present');
  }
  if (version !== undefined && typeof version !== 'string') {
    throw new Error('version must be a string when present');
  }
  let deps = [];
  if (dependencies !== undefined) {
    if (!Array.isArray(dependencies)) {
      throw new Error('dependencies must be an array of skill names when present');
    }
    for (const d of dependencies) {
      if (typeof d !== 'string' || !NAME_RE.test(d)) {
        throw new Error(`each dependency must be a kebab-case skill name (got: ${JSON.stringify(d)})`);
      }
    }
    if (new Set(dependencies).size !== dependencies.length) {
      throw new Error('dependencies must not contain duplicates');
    }
    if (dependencies.includes(name)) {
      throw new Error(`a skill cannot depend on itself (${name})`);
    }
    deps = [...dependencies];
  }
  if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
    throw new Error('metadata must be an object when present');
  }

  // Reject the reserved `unlocks` field — registry computes it from
  // dependencies, never the skill itself. Catches a community contributor's
  // honest mistake of declaring forward edges that would drift from
  // reality.
  if ('unlocks' in parsed) {
    throw new Error('`unlocks` is registry-computed; remove it from the manifest (declare `dependencies` instead)');
  }

  // ai6 R1.1 + R2.1 — freeze the returned manifest AND every nested
  // mutable structure (dependencies array, metadata object, extras object).
  // The registry stores these and exposes them via get(); without
  // deep-freezing, `registry.get('foo').metadata.author = 'hacked'`
  // silently corrupts the shared manifest that validate/listManifests
  // all read from. Schema evolution happens at AUTHORING time (declaring
  // new frontmatter fields), not at runtime (mutating a parsed manifest),
  // so deep-freezing has no legitimate downside.
  return Object.freeze({
    name,
    description: description.trim(),
    category: category ?? null,
    version: version ?? null,
    dependencies: Object.freeze(deps),
    metadata: metadata ? deepFreeze({ ...metadata }) : null,
    // Reserved field check (anything left over warns the contributor of typos).
    // Don't THROW on unknown fields — it'd ossify the schema against future
    // additions. Stash them under `extras` so a registry-level diagnostic
    // can surface them without rejecting the skill.
    extras: Object.keys(rest).length ? deepFreeze({ ...rest }) : null,
  });
};

// Recursive shallow-copy freeze. Handles plain objects + arrays — the only
// shapes js-yaml v4's SAFE_SCHEMA actually emits (mappings, sequences,
// scalars, Date). The Object.isFrozen short-circuit avoids redundant work
// on already-frozen sub-objects (e.g. nested dependencies we froze first)
// but does NOT make this cycle-safe; a self-referential graph would recurse
// forever. js-yaml output has no cycles, so this is fine in scope. If
// reused on arbitrary input, wrap with a WeakSet visited-guard.
const deepFreeze = (val) => {
  if (val === null || typeof val !== 'object') return val;
  if (Object.isFrozen(val)) return val;
  for (const v of Object.values(val)) deepFreeze(v);
  return Object.freeze(val);
};

/**
 * Load + parse a skill's SKILL.md and inspect its directory shape.
 *
 * impure (filesystem)
 *
 * @param {string} skillDir - absolute path to the skill directory
 * @returns {Promise<{
 *   name: string,
 *   description: string,
 *   category: string|null,
 *   version: string|null,
 *   dependencies: string[],
 *   metadata: object|null,
 *   extras: object|null,
 *   path: string,
 *   hasCli: boolean,
 *   hasLib: boolean,
 *   body: string,
 * }>}
 * @throws {Error} when SKILL.md is missing, has no frontmatter, has
 *   frontmatter that is not valid YAML, or fails schema validation
 */
export const loadManifest = async (skillDir) => {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  let text;
  try { text = await fs.readFile(skillMdPath, 'utf8'); }
  catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`SKILL.md missing in ${skillDir}`, { cause: err });
    }
    throw err;
  }
  const { frontmatter, body } = splitFrontmatter(text);
  if (frontmatter === null) {
    throw new Error(`SKILL.md in ${skillDir} has no YAML frontmatter (must open with --- and close with ---)`);
  }
  let parsed;
  try { parsed = yaml.load(frontmatter); }
  catch (err) {
    throw new Error(`SKILL.md frontmatter in ${skillDir} is not valid YAML: ${err.message}`, { cause: err });
  }
  let validated;
  try { validated = validateFrontmatter(parsed); }
  catch (err) {
    throw new Error(`SKILL.md in ${skillDir}: ${err.message}`, { cause: err });
  }
  // ai6 R1.5 — both presence checks via stat for symmetry, and correctness:
  // a directory named cli.js (unlikely but legal) was passing the previous
  // fs.access check, falsely reporting hasCli=true.
  const [hasCli, hasLib] = await Promise.all([
    fs.stat(path.join(skillDir, 'cli.js')).then((s) => s.isFile()).catch(() => false),
    fs.stat(path.join(skillDir, 'lib')).then((s) => s.isDirectory()).catch(() => false),
  ]);
  // ai6 R1.1 — also freeze the loaded manifest at the loader boundary so
  // the registry's get() handout is immutable by construction.
  return Object.freeze({
    ...validated,
    path: skillDir,
    hasCli,
    hasLib,
    body,
  });
};

// Test-only exports — pure helpers a test wants to drive directly without
// touching the filesystem. The public API stays loadManifest.
export const __test = Object.freeze({ splitFrontmatter, validateFrontmatter });
