// #22 S4a — Plugin install: ingest a Claude-format plugin as NEUMA skills.
//
// Study, don't integrate: we READ the Claude Code plugin shape
// (`.claude-plugin/plugin.json` + `commands/*.md` + optional `skills/`) and
// REWRITE it into NEUMA's own contract (one directory per skill under the
// skills root, each with a SKILL.md). The adapter runs once at install time;
// the runtime never knows the skill came from a plugin except through the
// provenance stamped in `metadata.plugin`.
//
// A command file (`commands/sc-plan.md`: YAML `description` frontmatter +
// a markdown instruction body) maps 1:1 onto a NEUMA skill: the filename is
// the name, the description is the hook, the body is what the neuma receives
// when it summons the skill. Native `skills/<dir>/SKILL.md` entries in a
// plugin are already in our contract and are copied through whole (their
// lib/, cli.js, resources included).

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { loadManifest } from './manifest.js';

const NAME_RE = /^[a-z][a-z0-9-]*$/;

/** Max plugin-declared description length carried into a skill manifest. */
const DESCRIPTION_CAP = 600;

// Pure — lenient key: value parse for the Claude command dialect. Real
// command files carry descriptions with bare `: ` inside (e.g. […]), which strict YAML rejects as a plain scalar but
// Claude Code's own parser accepts. One line per key, remainder taken raw.
const parseLenientFrontmatter = (raw) => {
  const out = {};
  for (const line of raw.split('\n')) {
    const m = /^([A-Za-z][\w-]*):\s?(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return Object.keys(out).length ? out : null;
};

// Pure — split a command .md into { frontmatter: object|null, body }.
// Same fence rule as manifest.js: a block opening with exactly `---` and
// closing with the next exactly-`---` line. Strict YAML first; the lenient
// dialect parse is the fallback so real Claude commands install unmangled.
export const splitCommandMd = (text) => {
  const normalized = String(text).replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { frontmatter: null, body: normalized };
  const lines = normalized.split('\n');
  const closeIdx = lines.indexOf('---', 1);
  if (closeIdx === -1) return { frontmatter: null, body: normalized };
  const raw = lines.slice(1, closeIdx).join('\n');
  let frontmatter = null;
  if (raw.trim()) {
    try { frontmatter = yaml.load(raw) ?? null; }
    catch { frontmatter = parseLenientFrontmatter(raw); }
  }
  return {
    frontmatter,
    body: lines.slice(closeIdx + 1).join('\n'),
  };
};

// Pure — derive the skill identity from one command file.
// Returns { name, description, body } or throws with the reason.
export const commandToSkill = (filename, text) => {
  const name = path.basename(filename, '.md').toLowerCase();
  if (!NAME_RE.test(name)) {
    throw new Error(`command filename '${filename}' is not a valid kebab-case skill name`);
  }
  const { frontmatter, body } = splitCommandMd(text);
  const description = typeof frontmatter?.description === 'string'
    ? frontmatter.description.trim().slice(0, DESCRIPTION_CAP)
    : '';
  if (!description) {
    throw new Error(`command '${filename}' has no description frontmatter`);
  }
  if (!body.trim()) {
    throw new Error(`command '${filename}' has an empty body — nothing to summon`);
  }
  return Object.freeze({ name, description, body });
};

// THE SHIPPED FINGERPRINT. Every skill a plugin installs carries the digest
// of what shipped (metadata.digest), so the next boot can tell an unchanged
// copy of ours from one the shipped pack has moved past — whether or not
// anyone remembered to bump a version (Design note, 2026-10-12: the beings must be
// […]). Pure.
const digestOf = (hash) => hash.digest('hex').slice(0, 16);
export const digestText = (text) => digestOf(crypto.createHash('sha256').update(String(text)));

// impure — the fingerprint of a native skill: every file it ships, by
// relative path and bytes, in a fixed order.
export const digestSkillDir = async (dir) => {
  const hash = crypto.createHash('sha256');
  const walk = async (rel) => {
    const entries = (await fs.readdir(path.join(dir, rel), { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(relPath);
      else if (entry.isFile()) hash.update(relPath).update('\0').update(await fs.readFile(path.join(dir, relPath))).update('\0');
    }
  };
  await walk('');
  return digestOf(hash);
};

// Pure — compose the SKILL.md content for a command-derived skill.
// Frontmatter is emitted through js-yaml so descriptions with quotes,
// colons, or newlines survive the round-trip into manifest.js.
export const composeSkillMd = ({ name, description, body }, plugin, digest = null) => {
  const frontmatter = yaml.dump({
    name,
    description,
    category: plugin.name,
    ...(plugin.version ? { version: plugin.version } : {}),
    metadata: {
      plugin: plugin.name,
      format: 'claude-command',
      ...(plugin.source ? { source: plugin.source } : {}),
      ...(digest ? { digest } : {}),
    },
  }, { lineWidth: -1 });
  return `---\n${frontmatter}---\n${body}`;
};

// impure — a native skill copied through whole gains provenance too: which
// pack shipped it, and what shipped. Without it no copy of a native skill
// could ever be told from one its operator wrote, and none was ever upgraded
// (2026-10-12). Its key is `pack`, not `plugin`: an older seeder (a packaged
// release, a frozen bench checkout on the same machine) reads `plugin` as ours
// and weighs it by VERSION — it would roll a native skill back to its own
// bundled copy. Under `pack` those seeders leave it be, as they always have.
const stampNativeSkill = async (target, plugin, digest) => {
  const file = path.join(target, 'SKILL.md');
  const { frontmatter, body } = splitCommandMd(await fs.readFile(file, 'utf8'));
  const stamped = { ...(frontmatter || {}), metadata: { ...(frontmatter?.metadata || {}), pack: plugin.name, digest } };
  await fs.writeFile(file, `---\n${yaml.dump(stamped, { lineWidth: -1 })}---\n${body}`);
};

// impure — read + validate the plugin manifest. A directory without
// `.claude-plugin/plugin.json` is not a plugin (a bare skills dir installs
// through the registry root directly, no adapter needed).
export const readPluginManifest = async (pluginDir) => {
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(err.code === 'ENOENT'
      ? `not a plugin: ${manifestPath} missing`
      : `plugin manifest unreadable: ${err.message}`, { cause: err });
  }
  if (typeof parsed?.name !== 'string' || !NAME_RE.test(parsed.name)) {
    throw new Error(`plugin manifest name must be kebab-case (got: ${JSON.stringify(parsed?.name)})`);
  }
  return Object.freeze({
    name: parsed.name,
    description: typeof parsed.description === 'string' ? parsed.description : '',
    version: typeof parsed.version === 'string' ? parsed.version : null,
    source: pluginDir,
  });
};

// impure — list a subdirectory's entries, tolerating its absence.
const _entriesOf = async (dir) => {
  try { return await fs.readdir(dir, { withFileTypes: true }); }
  catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

/**
 * What a plugin would install, without installing: each skill's name, its
 * category, and the fingerprint of what ships — what the seeder weighs an
 * installed copy against. An entry that cannot load is left to the install
 * to report. impure (reads the plugin).
 *
 * @param {string} pluginDir
 * @returns {Promise<{plugin: object, entries: Array<{name: string, category: ?string, digest: string}>}>}
 */
export const shippedEntries = async (pluginDir) => {
  const plugin = await readPluginManifest(pluginDir);
  const entries = [];
  for (const entry of await _entriesOf(path.join(pluginDir, 'commands'))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    try {
      const text = await fs.readFile(path.join(pluginDir, 'commands', entry.name), 'utf8');
      entries.push({ name: commandToSkill(entry.name, text).name, category: plugin.name, digest: digestText(text) });
    } catch { /* the install reports it */ }
  }
  for (const entry of await _entriesOf(path.join(pluginDir, 'skills'))) {
    if (!entry.isDirectory()) continue;
    const source = path.join(pluginDir, 'skills', entry.name);
    try {
      const manifest = await loadManifest(source);
      entries.push({ name: manifest.name, category: manifest.category, digest: await digestSkillDir(source) });
    } catch { /* the install reports it */ }
  }
  return Object.freeze({ plugin, entries });
};

/**
 * Install a Claude-format plugin's commands + native skills into a NEUMA
 * skills root. Idempotent-by-refusal: an existing skill directory is never
 * overwritten unless `force` — collisions land in `skipped` with the reason,
 * the rest install, and the report says exactly what happened (no silent
 * partial success). A forced install REPLACES the skill's directory whole:
 * files the new version no longer ships must not linger beside it. `only`
 * narrows the install to the named skills, so upgrading one skill never
 * rewrites its pack-mates (an operator's own collision among them).
 *
 * impure (filesystem)
 *
 * @param {string} pluginDir - plugin source (has .claude-plugin/plugin.json)
 * @param {string} skillsRoot - registry root the skills install into
 * @param {{force?: boolean, only?: string[]}} [opts]
 * @returns {Promise<{plugin: object, installed: Array<{name, kind, digest}>, skipped: Array<{entry, reason}>}>}
 */
export const installPlugin = async (pluginDir, skillsRoot, opts = {}) => {
  const plugin = await readPluginManifest(pluginDir);
  await fs.mkdir(skillsRoot, { recursive: true });

  const wanted = (name) => !opts.only || opts.only.includes(name);
  const installed = [];
  const skipped = [];

  const targetFor = async (name) => {
    const target = path.join(skillsRoot, name);
    const exists = await fs.stat(target).then(() => true).catch(() => false);
    if (exists && !opts.force) {
      throw new Error(`skill '${name}' already installed (use force to overwrite)`);
    }
    if (exists) await fs.rm(target, { recursive: true, force: true });
    return target;
  };

  // Commands → command-derived skills
  for (const entry of await _entriesOf(path.join(pluginDir, 'commands'))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    if (!wanted(path.basename(entry.name, '.md').toLowerCase())) continue;
    try {
      const text = await fs.readFile(path.join(pluginDir, 'commands', entry.name), 'utf8');
      const skill = commandToSkill(entry.name, text);
      const digest = digestText(text);
      const target = await targetFor(skill.name);
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, 'SKILL.md'), composeSkillMd(skill, plugin, digest));
      installed.push({ name: skill.name, kind: 'command', digest });
    } catch (err) {
      skipped.push({ entry: `commands/${entry.name}`, reason: err.message });
    }
  }

  // Native skills → copied through whole (already in our contract), then stamped
  for (const entry of await _entriesOf(path.join(pluginDir, 'skills'))) {
    if (!entry.isDirectory()) continue;
    const source = path.join(pluginDir, 'skills', entry.name);
    try {
      // Validate against OUR contract before copying — a skill that can't
      // load must not be planted where the registry will trip on it forever.
      const manifest = await loadManifest(source);
      if (!wanted(manifest.name)) continue;
      const digest = await digestSkillDir(source);
      const target = await targetFor(manifest.name);
      await fs.cp(source, target, { recursive: true, force: true });
      await stampNativeSkill(target, plugin, digest);
      installed.push({ name: manifest.name, kind: 'skill', digest });
    } catch (err) {
      if (!wanted(entry.name)) continue; // not asked for — not this install's to report
      skipped.push({ entry: `skills/${entry.name}`, reason: err.message });
    }
  }

  if (installed.length === 0 && skipped.length === 0 && !opts.only) {
    throw new Error(`plugin '${plugin.name}' has no commands/ or skills/ to install`);
  }
  return Object.freeze({ plugin, installed, skipped });
};
