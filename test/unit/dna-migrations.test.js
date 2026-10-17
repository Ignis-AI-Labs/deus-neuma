import { describe, it, expect } from 'vitest';
import {
  parseSemver, compareSemver, registerMigration, buildMigrationChain,
  migrateDNA, CURRENT_DNA_VERSION,
} from '../../core/identity/dna-migrations.js';

describe('dna-migrations.js', () => {
  describe('parseSemver()', () => {
    it('parses valid semver', () => {
      expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
    });

    it('returns [0,0,0] for null', () => {
      expect(parseSemver(null)).toEqual([0, 0, 0]);
    });

    it('returns [0,0,0] for empty string', () => {
      expect(parseSemver('')).toEqual([0, 0, 0]);
    });

    it('handles partial versions', () => {
      expect(parseSemver('2.1')).toEqual([2, 1, 0]);
    });
  });

  describe('compareSemver()', () => {
    it('returns 0 for equal versions', () => {
      expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    });

    it('returns -1 when a < b', () => {
      expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
      expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
      expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
    });

    it('returns 1 when a > b', () => {
      expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
      expect(compareSemver('1.1.0', '1.0.0')).toBe(1);
    });
  });

  describe('buildMigrationChain()', () => {
    it('returns empty array when from >= to', () => {
      expect(buildMigrationChain('1.0.0', '1.0.0')).toEqual([]);
      expect(buildMigrationChain('2.0.0', '1.0.0')).toEqual([]);
    });
  });

  describe('migrateDNA()', () => {
    it('returns unmigrated when at current version', () => {
      const dna = { version: CURRENT_DNA_VERSION, name: 'test' };
      const result = migrateDNA(dna);
      expect(result.migrated).toBe(false);
      expect(result.steps).toBe(0);
      expect(result.dna).toBe(dna); // Same reference — not copied
    });

    it('defaults missing version to 1.0.0', () => {
      const dna = { name: 'test' };
      const result = migrateDNA(dna);
      expect(result.fromVersion).toBe('1.0.0');
    });

    it('returns frozen result', () => {
      const dna = { version: CURRENT_DNA_VERSION };
      const result = migrateDNA(dna);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it('does not mutate input DNA', () => {
      // Register a no-op migration so we exercise the migration path
      // (#124 made the no-chain branch throw, so we must register a real
      // path to test the non-mutation invariant).
      registerMigration('0.9.0', '1.0.0', (d) => ({ ...d }));
      const dna = { version: '0.9.0', name: 'original' };
      const copy = { ...dna };
      migrateDNA(dna, '1.0.0');
      expect(dna).toEqual(copy);
    });

    // #124 / DATA-004 — refuse to silently relabel DNA when no migration
    // chain exists. The prior behavior was: stamp the target version onto
    // unchanged data and call it […], which would
    // invisibly corrupt every being's DNA on a target bump without a
    // registered migration. Now it throws and the caller must decide.
    it('throws when DNA is older than target but no migration chain is registered (#124)', () => {
      const dna = { version: '0.1.0', name: 'old' };
      expect(() => migrateDNA(dna, '1.0.0')).toThrow(/no migration registered from 0\.1\.0 to 1\.0\.0/);
    });

    it('error message names the missing registerMigration call so the operator knows the fix', () => {
      const dna = { version: '2.0.0', name: 'future' };
      let err;
      try { migrateDNA(dna, '2.1.0'); } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.message).toMatch(/registerMigration\('2\.0\.0', '2\.1\.0', fn\)/);
    });

    it('a registered chain still works (no regression on the migration happy path)', () => {
      registerMigration('3.0.0', '3.1.0', (d) => ({ ...d, added: true }));
      const result = migrateDNA({ version: '3.0.0', name: 'x' }, '3.1.0');
      expect(result.migrated).toBe(true);
      expect(result.dna.version).toBe('3.1.0');
      expect(result.dna.added).toBe(true);
      expect(result.dna.name).toBe('x');
      expect(result.steps).toBe(1);
    });

    it('DNA at or above target is still a no-op (no false throw on already-current beings)', () => {
      // The LIVING beings' DNA is at CURRENT_DNA_VERSION; this guard is what
      // prevents the new throw from regressing them.
      const dna = { version: '1.0.0', name: 'current' };
      const result = migrateDNA(dna, '1.0.0');
      expect(result.migrated).toBe(false);
      expect(result.dna).toBe(dna); // same object, not stamped
    });
  });
});
