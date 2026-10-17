// #22 S1 — Skill registry: scan, index, query.
//
// A registry is an in-memory index over a set of skill directories. It is
// built once from disk, then queried as a pure data structure. Discovery is
// shallow + explicit: caller passes ONE root path (`<repo>/.claude/skills`,
// `~/.config/neuma/skills`, etc.) and the registry yields every direct
// subdirectory that has a valid SKILL.md. No globbing, no recursion — a
// skill is exactly one directory under a root, period.
//
// The registry's core job is the GRAPH layer: given a set of manifests, it
// computes the reverse edges (which skills does this one unlock?), exposes
// dependency + unlock queries, and flags integrity problems (dangling deps,
// cycles, duplicate names across roots / community).
//
// What this slice does NOT do (deferred):
//   - Per-neuma acquisition tracking (S2)
//   - Transitive `available-next-to-this-neuma` queries (S3 — depends on S2)
//   - Runtime invocation / prompt-assembly integration (S4)

import fs from 'fs/promises';
import path from 'path';
import { loadManifest } from './manifest.js';

/**
 * Scan one root directory for skills. Returns the registry object —
 * see the documented method surface at the bottom of this file.
 *
 * Failure mode: a skill directory whose SKILL.md is missing or invalid is
 * NOT silently skipped (that would let typos disappear). It's captured
 * under `errors`, the rest of the registry loads, and `validate()` returns
 * the structural problems together so the operator sees the whole picture
 * in one read.
 *
 * impure (filesystem)
 *
 * @param {string} rootDir - absolute path containing zero or more skill subdirs
 * @returns {Promise<Registry>}
 */
export const scanRegistry = async (rootDir) => {
  const manifests = new Map();         // name -> manifest
  const errors = [];                   // { dir, error } load failures

  let entries;
  try { entries = await fs.readdir(rootDir, { withFileTypes: true }); }
  catch (err) {
    if (err.code === 'ENOENT') {
      return buildRegistry(rootDir, manifests, errors);
    }
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(rootDir, entry.name);
    try {
      const m = await loadManifest(dir);
      if (manifests.has(m.name)) {
        errors.push({
          dir,
          error: `duplicate skill name '${m.name}' (also at ${manifests.get(m.name).path})`,
        });
        continue;
      }
      manifests.set(m.name, m);
    } catch (err) {
      errors.push({ dir, error: err.message });
    }
  }

  return buildRegistry(rootDir, manifests, errors);
};

// Compute the reverse-edge map: name -> array of skill names that DEPEND on
// it (i.e. that this skill UNLOCKS). Pure given the manifests map.
const computeUnlocks = (manifests) => {
  const unlocks = new Map();
  for (const m of manifests.values()) unlocks.set(m.name, []);
  for (const m of manifests.values()) {
    for (const dep of m.dependencies) {
      // Skip dangling deps here — validate() reports them separately
      if (unlocks.has(dep)) unlocks.get(dep).push(m.name);
    }
  }
  return unlocks;
};

// Detect dependency cycles via DFS. Returns an array of cycles, each a
// list of skill names in walk order. Pure given the manifests map.
const detectCycles = (manifests) => {
  const cycles = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...manifests.keys()].map((n) => [n, WHITE]));
  const stack = [];

  const visit = (name) => {
    if (!manifests.has(name)) return; // dangling dep — not a cycle
    const c = color.get(name);
    if (c === BLACK) return;
    if (c === GRAY) {
      // back-edge — cycle from where `name` first appears in `stack` to top
      const start = stack.indexOf(name);
      cycles.push(stack.slice(start).concat(name));
      return;
    }
    color.set(name, GRAY);
    stack.push(name);
    for (const dep of manifests.get(name).dependencies) visit(dep);
    stack.pop();
    color.set(name, BLACK);
  };

  for (const name of manifests.keys()) visit(name);
  return cycles;
};

// Pure — assemble the query interface around the loaded manifests + errors.
const buildRegistry = (rootDir, manifests, errors) => {
  const unlocks = computeUnlocks(manifests);

  // Frozen snapshot of names so list()/etc. can't be mutated by callers
  const sortedNames = [...manifests.keys()].sort();

  /**
   * Validate the registry: dangling dependencies + cycles + carried-over
   * load errors. Returns a list of structured findings; empty array means
   * the registry is internally consistent.
   *
   * Each finding shape:
   *   { severity: 'error' | 'warn', kind, detail }
   *
   * Kinds + severities:
   *   error: load-failed, dangling-dependency, dependency-cycle
   *   warn:  unknown-fields (schema-evolution-friendly; not a rejection)
   */
  const validate = () => {
    const findings = errors.map((e) => ({
      severity: 'error', kind: 'load-failed', detail: `${e.dir}: ${e.error}`,
    }));
    for (const m of manifests.values()) {
      for (const dep of m.dependencies) {
        if (!manifests.has(dep)) {
          findings.push({
            severity: 'error', kind: 'dangling-dependency',
            detail: `skill '${m.name}' depends on unknown skill '${dep}'`,
          });
        }
      }
      if (m.extras) {
        findings.push({
          severity: 'warn', kind: 'unknown-fields',
          detail: `skill '${m.name}' has unknown frontmatter fields: ${Object.keys(m.extras).join(', ')}`,
        });
      }
    }
    for (const cycle of detectCycles(manifests)) {
      findings.push({
        severity: 'error', kind: 'dependency-cycle',
        detail: `cycle: ${cycle.join(' -> ')}`,
      });
    }
    return findings;
  };

  return Object.freeze({
    /** Absolute path of the scanned root directory. */
    rootDir,

    /** Total skill count loaded (excludes load failures). */
    size: manifests.size,

    /** True iff a skill with that name is in the registry. */
    has: (name) => manifests.has(name),

    /** Manifest object or undefined. Do not mutate the returned object. */
    get: (name) => manifests.get(name),

    /** Sorted snapshot array of all skill names. */
    list: () => [...sortedNames],

    /** Array of manifests (sorted by name). */
    listManifests: () => sortedNames.map((n) => manifests.get(n)),

    /**
     * Skills that DEPEND on `name` (the reverse edges this skill unlocks).
     * Returns empty array if `name` is unknown or has no dependents.
     */
    unlocksFor: (name) => unlocks.has(name) ? [...unlocks.get(name)] : [],

    /**
     * Skills this one DECLARES it depends on. Equivalent to
     * `get(name)?.dependencies ?? []` — convenience symmetry with
     * unlocksFor.
     */
    dependenciesOf: (name) => manifests.has(name) ? [...manifests.get(name).dependencies] : [],

    /** Structured findings. Empty when the registry is fully consistent. */
    validate,
  });
};

/**
 * @typedef {Object} Registry
 * @property {string} rootDir
 * @property {number} size
 * @property {(name: string) => boolean} has
 * @property {(name: string) => object|undefined} get
 * @property {() => string[]} list
 * @property {() => object[]} listManifests
 * @property {(name: string) => string[]} unlocksFor
 * @property {(name: string) => string[]} dependenciesOf
 * @property {() => Array<{severity:string, kind:string, detail:string}>} validate
 */
