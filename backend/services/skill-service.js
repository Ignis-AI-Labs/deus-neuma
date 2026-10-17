// Skill service — the runtime's window onto the skills root (#22 S4).
//
// One skills root per installation: NEUMA_SKILLS_ROOT, defaulting to
// ~/.neuma/skills — the same NEUMA-branded, app-name-independent home the
// Electron shell roots the being's data under. Plugins install into it
// (core/skills/plugin-install.js); the registry scans it; the portal reads
// the menu + bodies from here at summon time.
//
// The registry is rebuilt lazily and invalidated on install — a skills root
// changes only when something installs into it, so there is no TTL churn.

import os from 'os';
import path from 'path';
import { scanRegistry } from '../../core/skills/registry.js';
import { installPlugin } from '../../core/skills/plugin-install.js';
import { createLogger } from './logger.js';

const log = createLogger('Skills');

export const defaultSkillsRoot = () =>
  process.env.NEUMA_SKILLS_ROOT || path.join(os.homedir(), '.neuma', 'skills');

/**
 * Build a skill service over one skills root. Exposed as a factory so tests
 * run against real temp roots; production uses the default singleton below.
 */
export const createSkillService = (root = defaultSkillsRoot()) => {
  let registryPromise = null;

  const registry = () => {
    if (!registryPromise) registryPromise = scanRegistry(root);
    return registryPromise;
  };

  return Object.freeze({
    root,

    /** Menu entries for prompt advertisement + the skills API. The graph
     *  edges (dependencies as authored, unlocks as computed reverse edges)
     *  ride along for the tree UI; menu consumers ignore them. */
    async listSkills() {
      const reg = await registry();
      return reg.listManifests().map((m) => ({
        name: m.name,
        description: m.description,
        category: m.category,
        version: m.version,
        plugin: m.metadata?.plugin || null,
        dependencies: [...m.dependencies],
        unlocks: reg.unlocksFor(m.name),
      }));
    },

    /** Full manifest (body included) or undefined. */
    async getSkill(name) {
      const reg = await registry();
      return reg.get(name);
    },

    /** Structured registry findings (load failures, dangling deps, cycles). */
    async validate() {
      const reg = await registry();
      return reg.validate();
    },

    /** Install a Claude-format plugin directory; registry rebuilds after. */
    async installPluginFromPath(pluginDir, opts = {}) {
      const report = await installPlugin(pluginDir, root, opts);
      registryPromise = null; // next read sees the new skills
      log.info('Plugin installed', {
        plugin: report.plugin.name,
        installed: report.installed.length,
        skipped: report.skipped.length,
      });
      return report;
    },

    /** Force the next read to rescan (skills edited on disk out-of-band). */
    refresh() { registryPromise = null; },
  });
};

// Singleton over the configured root — what the portal and routes use.
export const skillService = createSkillService();
