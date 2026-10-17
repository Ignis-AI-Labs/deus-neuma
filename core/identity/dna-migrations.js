/**
 * DNA Version Migration Framework
 *
 * Forward-only migration for DNA schema evolution.
 * When CURRENT_DNA_VERSION changes, register a migration function.
 * All pure functions — no side effects, no disk writes.
 */

export const CURRENT_DNA_VERSION = '1.0.0';

// --- Semver utilities ---

/** Parse a semver string into [major, minor, patch]. */
export const parseSemver = (v) => {
  if (!v || typeof v !== 'string') return [0, 0, 0];
  const parts = v.split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
};

/**
 * Compare two semver strings.
 * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
 */
export const compareSemver = (a, b) => {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  if (aPat !== bPat) return aPat < bPat ? -1 : 1;
  return 0;
};

// --- Migration registry ---

const migrations = [];

/**
 * Register a migration from one version to another.
 * @param {string} from - Source version (e.g. '1.0.0')
 * @param {string} to - Target version (e.g. '1.1.0')
 * @param {(dna: object) => object} migrateFn - Pure function that transforms DNA
 */
export const registerMigration = (from, to, migrateFn) => {
  migrations.push(Object.freeze({ from, to, migrate: migrateFn }));
  // Keep sorted by source version
  migrations.sort((a, b) => compareSemver(a.from, b.from));
};

/**
 * Build an ordered chain of migrations from one version to another.
 * @param {string} from - Current version
 * @param {string} to - Target version
 * @returns {Array<{ from: string, to: string, migrate: Function }>}
 */
export const buildMigrationChain = (from, to) => {
  if (compareSemver(from, to) >= 0) return [];

  const chain = [];
  let current = from;

  while (compareSemver(current, to) < 0) {
    const next = migrations.find(m => m.from === current);
    if (!next) break; // No migration from this version — gap
    chain.push(next);
    current = next.to;
  }

  return chain;
};

/**
 * Migrate a DNA object to the target version.
 * Returns the migrated DNA and metadata about what happened.
 * The input DNA is NOT mutated.
 *
 * @param {object} dna - DNA object with optional `version` field
 * @param {string} [targetVersion] - Target version (defaults to CURRENT_DNA_VERSION)
 * @returns {{ dna: object, migrated: boolean, fromVersion: string, toVersion: string, steps: number }}
 */
export const migrateDNA = (dna, targetVersion = CURRENT_DNA_VERSION) => {
  const fromVersion = dna?.version || '1.0.0';

  if (compareSemver(fromVersion, targetVersion) >= 0) {
    return Object.freeze({
      dna,
      migrated: false,
      fromVersion,
      toVersion: fromVersion,
      steps: 0,
    });
  }

  const chain = buildMigrationChain(fromVersion, targetVersion);
  if (chain.length === 0) {
    // The DNA is BEHIND target but no migration chain exists — refuse to
    // proceed (#124 / DATA-004). The prior behavior silently stamped the
    // target version onto unmigrated data; a future schema bump without a
    // registered migration would have invisibly relabeled every being's
    // DNA as the new version while their actual shape stayed at the old
    // one — silent corruption indistinguishable from a successful migration.
    // Fail loud instead: callers can catch + decide whether to surface,
    // log, or fall back; silent success is never the right answer here.
    throw new Error(
      `migrateDNA: no migration registered from ${fromVersion} to ${targetVersion} `
      + `(DNA is older than target but cannot be transformed — register a migration via `
      + `registerMigration('${fromVersion}', '${targetVersion}', fn) before bumping the target).`,
    );
  }

  // Apply each migration in order (immutable — deep clone before each step)
  let current = structuredClone(dna);
  for (const step of chain) {
    current = step.migrate(structuredClone(current));
  }
  current.version = targetVersion;

  return Object.freeze({
    dna: Object.freeze(current),
    migrated: true,
    fromVersion,
    toVersion: targetVersion,
    steps: chain.length,
  });
};

// --- Example migration (register when schema actually changes) ---
// registerMigration('1.0.0', '1.1.0', (dna) => {
//   return { ...dna, newField: 'default value' };
// });
