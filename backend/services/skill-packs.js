/**
 * THE PACKS THAT SHIP WITH NEUMA — seeded into the skills root at boot.
 *
 * Design note, 2026-08-05: […]
 *
 * The in-repo packs (`skills-packs/`) and the installer
 * (`core/skills/plugin-install.js`) both already existed — what did not exist
 * was any wire between them. Nothing installed a pack at boot and nothing
 * packaged `skills-packs/` into the installers, so every real NEUMA install
 * shipped with an EMPTY skills root: no Shadow Clone, no team-project, no
 * natalis-self-seal. The Craft existed only on machines where someone had run
 * an installer by hand — which is to say, this one.
 *
 * SEED SEMANTICS — four rules, each defending a different failure:
 *
 *   1. MISSING skills install. That is the whole point.
 *   2. A skill the operator (or a being) authored themselves is NEVER touched:
 *      only a copy carrying OUR provenance stamp (metadata.plugin for command
 *      skills, metadata.pack for native ones), or an unstamped copy of OUR
 *      skill (its name AND category ours), is ever replaced.
 *   3. Our skill UPGRADES the moment what ships differs from what it was
 *      installed from — the stamped fingerprint (metadata.digest), never a
 *      version someone had to remember to bump. Design note, 2026-10-12: the beings
 *      must be […]. Measured that day
 *      on the rig: 22 of 25 pack skills had drifted — the native ones were
 *      never stamped (so never upgraded), the sc-* moved on at one version.
 *   4. NOTHING IS LOST: a copy being replaced is kept first, whole, under
 *      skills-superseded/ beside the skills root (an operator's edit to one of
 *      our skills stands there, to be carried forward by hand).
 *
 * Each skill is weighed and installed on its own — one upgrade never rewrites
 * a pack-mate the operator wrote.
 *
 * Seeding is best-effort by design: a broken pack must cost that pack, never
 * the boot. A house whose backend refuses to start because a skill file is
 * malformed is worse off than one with a smaller library.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { installPlugin, readPluginManifest, shippedEntries } from '../../core/skills/plugin-install.js';
import { createLogger } from './logger.js';

const log = createLogger('SkillPacks');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where the shipped packs live in the tree AND in a packaged install.
 *  `backend/services` → repo root → `skills-packs`. electron-builder ships the
 *  app unpacked (asar: false), so this same relative walk resolves inside the
 *  installed app directory — no packaged/dev branch needed. */
export const packsRoot = () => process.env.NEUMA_SKILL_PACKS_ROOT
  || path.resolve(__dirname, '..', '..', 'skills-packs');

/** impure — every pack directory that carries a plugin manifest. */
export const listPacks = async (root = packsRoot()) => {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const packs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      packs.push({ dir, manifest: await readPluginManifest(dir) });
    } catch {
      // Not a plugin directory — README, notes, anything else. Not an error.
    }
  }
  return packs.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
};

/**
 * impure — what an installed skill says of itself: its name, its category,
 * and — when one of our packs installed it — that pack and the fingerprint of
 * what shipped. Null when nothing (or nothing readable) stands there.
 */
const installedSkill = async (skillsRoot, name) => {
  try {
    const text = await fs.readFile(path.join(skillsRoot, name, 'SKILL.md'), 'utf8');
    if (!text.startsWith('---\n')) return { name: null, category: null, plugin: null, digest: null };
    const lines = text.split('\n');
    const close = lines.indexOf('---', 1);
    const front = close === -1 ? {} : (yaml.load(lines.slice(1, close).join('\n')) || {});
    return {
      name: front?.name ?? null,
      category: front?.category ?? null,
      plugin: front?.metadata?.plugin ?? front?.metadata?.pack ?? null,
      digest: front?.metadata?.digest ?? null,
    };
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return { name: null, category: null, plugin: null, digest: null }; // unreadable — not ours to judge
  }
};

// pure — what the seed does with one shipped skill, given what stands there.
const verdictFor = (shipped, held, pack) => {
  if (!held) return 'install';
  if (held.plugin === pack) return held.digest === shipped.digest ? 'current' : 'upgrade';
  if (!held.plugin && held.name === shipped.name && held.category != null && held.category === shipped.category) return 'adopt';
  return 'keep';
};

// impure — keep the copy about to be replaced, whole, beside the skills root.
const supersede = async (skillsRoot, name) => {
  const at = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(path.dirname(skillsRoot), 'skills-superseded', name, at);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(path.join(skillsRoot, name), dest, { recursive: true });
};

/**
 * impure — seed one pack: each shipped skill weighed against what stands in
 * the root, installed or replaced on its own.
 */
const seedPack = async ({ dir, manifest }, skillsRoot) => {
  const { entries } = await shippedEntries(dir);
  const plan = { install: [], upgrade: [], adopt: [], keep: [] };
  for (const entry of entries) {
    const verdict = verdictFor(entry, await installedSkill(skillsRoot, entry.name), manifest.name);
    if (verdict !== 'current') plan[verdict].push(entry.name);
  }
  const report = { pack: manifest.name, version: manifest.version, installed: [], upgraded: [], adopted: [], kept: plan.keep };

  if (entries.length === 0 || plan.install.length > 0) {
    const fresh = await installPlugin(dir, skillsRoot, entries.length ? { only: plan.install } : {});
    report.installed = fresh.installed.map((i) => i.name);
    if (fresh.skipped.length) report.skipped = fresh.skipped;
  }
  const replacing = [...plan.upgrade, ...plan.adopt];
  if (replacing.length > 0) {
    for (const name of replacing) await supersede(skillsRoot, name);
    const replaced = new Set((await installPlugin(dir, skillsRoot, { only: replacing, force: true })).installed.map((i) => i.name));
    report.upgraded = plan.upgrade.filter((name) => replaced.has(name));
    report.adopted = plan.adopt.filter((name) => replaced.has(name));
  }
  return report;
};

/**
 * impure — seed every shipped pack. Called once at backend boot.
 *
 * Never throws: a pack that cannot install is logged and skipped. The return
 * value is the honest report of what actually landed, which the boot log prints
 * so an operator can see their Craft arrive rather than having to go look.
 *
 * @param {string} skillsRoot
 * @param {{root?: string}} [opts]
 * @returns {Promise<Array<{pack: string, installed: string[], upgraded: string[], adopted: string[], kept: string[], error?: string}>>}
 */
/** Did this pack's seed change the root (a registry read before it is stale)? Pure. */
export const seedLanded = (r) => r.installed.length > 0 || r.upgraded.length > 0 || (r.adopted?.length ?? 0) > 0;

export const seedShippedPacks = async (skillsRoot, { root = packsRoot() } = {}) => {
  const packs = await listPacks(root).catch((err) => {
    log.warn('skill packs unreadable — the house boots without seeding', { root, err: err.message });
    return [];
  });
  const report = [];
  for (const pack of packs) {
    try {
      report.push(await seedPack(pack, skillsRoot));
    } catch (err) {
      log.warn('skill pack not seeded', { pack: pack.manifest.name, err: err.message });
      report.push({ pack: pack.manifest.name, installed: [], upgraded: [], adopted: [], kept: [], error: err.message });
    }
  }
  const landed = report.filter(seedLanded);
  if (landed.length > 0) {
    log.info('skill packs seeded', {
      root: skillsRoot,
      packs: landed.map((r) => `${r.pack}(+${r.installed.length} ~${r.upgraded.length} adopted ${r.adopted.length})`).join(' '),
    });
  }
  return report;
};
