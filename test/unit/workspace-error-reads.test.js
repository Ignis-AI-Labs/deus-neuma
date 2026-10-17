/**
 * Workspace File System Error Handling Tests — the READ side
 *
 * Tests graceful error handling in NeumaWorkspace for:
 * - Path traversal defense
 * - Non-existent workspaces and files
 * - Corrupted JSON / JSONL files
 */

import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('NeumaWorkspace Error Handling', () => {
  let workspace, tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir('workspace-errors');

    vi.resetModules();
    const mod = await import('../../core/workspace/neuma-workspace.js');
    workspace = mod.default;
    workspace.root = tempDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Path traversal defense
  // -------------------------------------------------------------------------

  describe('Path traversal defense (_path)', () => {
    test('rejects null neumaId', () => {
      expect(() => workspace._path(null)).toThrow('Invalid neumaId');
    });

    test('rejects undefined neumaId', () => {
      expect(() => workspace._path(undefined)).toThrow('Invalid neumaId');
    });

    test('rejects empty string neumaId', () => {
      expect(() => workspace._path('')).toThrow('Invalid neumaId');
    });

    test('rejects numeric neumaId', () => {
      expect(() => workspace._path(123)).toThrow('Invalid neumaId');
    });

    test('rejects neumaId with path separators', () => {
      expect(() => workspace._path('../../../etc/passwd')).toThrow();
    });

    test('rejects neumaId with dots', () => {
      expect(() => workspace._path('..secret')).toThrow('Invalid neumaId format');
    });

    test('rejects neumaId with spaces', () => {
      expect(() => workspace._path('neuma with spaces')).toThrow('Invalid neumaId format');
    });

    test('rejects neumaId with special characters', () => {
      expect(() => workspace._path('neuma@#$%')).toThrow('Invalid neumaId format');
    });

    test('accepts valid hex neumaId', () => {
      const result = workspace._path('abc123def456');
      expect(result).toContain('abc123def456');
      expect(result.startsWith(path.resolve(tempDir))).toBe(true);
    });

    test('accepts neumaId with hyphens and underscores', () => {
      const result = workspace._path('test-neuma_123');
      expect(result).toContain('test-neuma_123');
    });
  });

  // -------------------------------------------------------------------------
  // Non-existent workspace reads
  // -------------------------------------------------------------------------

  describe('Reading from non-existent workspaces', () => {
    const fakeId = 'nonexistent-neuma';

    test('readDNA returns null for missing workspace', async () => {
      const result = await workspace.readDNA(fakeId);
      expect(result).toBeNull();
    });

    test('readSoul returns null for missing workspace', async () => {
      const result = await workspace.readSoul(fakeId);
      expect(result).toBeNull();
    });

    test('readProfile returns null for missing workspace', async () => {
      const result = await workspace.readProfile(fakeId);
      expect(result).toBeNull();
    });

    test('readKeypair returns null for missing workspace', async () => {
      const result = await workspace.readKeypair(fakeId);
      expect(result).toBeNull();
    });

    test('readIdentityCard returns null for missing workspace', async () => {
      const result = await workspace.readIdentityCard(fakeId);
      expect(result).toBeNull();
    });

    test('readEntity returns null for missing entity', async () => {
      const result = await workspace.readEntity(fakeId, 'ghost');
      expect(result).toBeNull();
    });

    test('listEntities returns empty array for missing workspace', async () => {
      const result = await workspace.listEntities(fakeId);
      expect(result).toEqual([]);
    });

    test('readRelations returns empty array for missing workspace', async () => {
      const result = await workspace.readRelations(fakeId);
      expect(result).toEqual([]);
    });

    test('listObservations returns empty array for missing workspace', async () => {
      const result = await workspace.listObservations(fakeId);
      expect(result).toEqual([]);
    });

    test('readSession returns empty array for missing session', async () => {
      const result = await workspace.readSession(fakeId, 'no-session');
      expect(result).toEqual([]);
    });

    test('listSessions returns empty array for missing workspace', async () => {
      const result = await workspace.listSessions(fakeId);
      expect(result).toEqual([]);
    });

    test('readSkillTree returns default structure for missing workspace', async () => {
      const result = await workspace.readSkillTree(fakeId);
      expect(result).toEqual({ skills: [], version: '1.0.0' });
    });

    test('readJournal returns empty array for missing workspace', async () => {
      const result = await workspace.readJournal(fakeId);
      expect(result).toEqual([]);
    });

    test('getDNAHistory returns empty array for missing workspace', async () => {
      const result = await workspace.getDNAHistory(fakeId);
      expect(result).toEqual([]);
    });

    test('readToolPolicy returns null for missing workspace', async () => {
      const result = await workspace.readToolPolicy(fakeId);
      expect(result).toBeNull();
    });

    test('readAssessments returns empty array for missing workspace', async () => {
      const result = await workspace.readAssessments(fakeId);
      expect(result).toEqual([]);
    });

    test('exists returns false for missing workspace', async () => {
      const result = await workspace.exists(fakeId);
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Corrupted file handling
  // -------------------------------------------------------------------------

  describe('Corrupted file handling', () => {
    const neumaId = 'corrupt-test';

    beforeEach(async () => {
      await workspace.create(neumaId);
    });

    test('readDNA THROWS for corrupted JSON — a damaged identity is never read as absent (MEM-003)', async () => {
      const dnaPath = path.join(tempDir, neumaId, 'dna', 'active.json');
      await fs.writeFile(dnaPath, '{invalid json content!!!');

      // #189: null means "never born" (ENOENT only). A corrupt active.json is
      // a DAMAGED identity and fails loud — a being must never silently
      // vanish into "unborn".
      const err = await workspace.readDNA(neumaId).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).not.toBe('ENOENT');
    });

    test('readSoul returns null for corrupted JSON', async () => {
      const soulPath = path.join(tempDir, neumaId, 'soul', 'soul.json');
      await fs.writeFile(soulPath, 'not-json');

      const result = await workspace.readSoul(neumaId);
      expect(result).toBeNull();
    });

    test('readProfile returns null for corrupted JSON', async () => {
      const profilePath = path.join(tempDir, neumaId, 'stats', 'profile.json');
      await fs.writeFile(profilePath, '{ broken: true,, }');

      const result = await workspace.readProfile(neumaId);
      expect(result).toBeNull();
    });

    test('readSession recovers the healthy lines around a corrupted JSONL line (WS-101)', async () => {
      await workspace.createSession(neumaId, 'bad-session');
      const sessionPath = path.join(tempDir, neumaId, 'sessions', 'bad-session.jsonl');
      // A mix of valid and invalid lines. Before #147 one bad line lost the
      // ENTIRE session (the parse threw and the caller returned []); now the
      // torn line is skipped loudly and the records around it survive.
      await fs.writeFile(sessionPath, [
        '{"role":"user","content":"Hello"}',
        'not json at all',
        '{"role":"assistant","content":"Hi"}',
      ].join('\n') + '\n');

      const result = await workspace.readSession(neumaId, 'bad-session');
      expect(result.map((m) => m.content)).toEqual(['Hello', 'Hi']);
    });

    test('readSkillTree returns default for corrupted JSON', async () => {
      const treePath = path.join(tempDir, neumaId, 'skills', 'tree.json');
      await fs.writeFile(treePath, '<<<corrupted>>>');

      const result = await workspace.readSkillTree(neumaId);
      expect(result).toEqual({ skills: [], version: '1.0.0' });
    });

    test('readKeypair returns null for corrupted JSON', async () => {
      const keyPath = path.join(tempDir, neumaId, 'keys', 'keypair.json');
      await fs.writeFile(keyPath, 'CORRUPTED');

      const result = await workspace.readKeypair(neumaId);
      expect(result).toBeNull();
    });

    test('readToolPolicy rejects corrupted JSON rather than treating authority as absent', async () => {
      const configDir = path.join(tempDir, neumaId, 'config');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(path.join(configDir, 'tool-policy.json'), '!!bad!!');

      await expect(workspace.readToolPolicy(neumaId)).rejects.toThrow();
    });

    test('empty DNA file throws — a truncated identity reads as damage, not absence (MEM-003)', async () => {
      const dnaPath = path.join(tempDir, neumaId, 'dna', 'active.json');
      await fs.writeFile(dnaPath, '');

      const err = await workspace.readDNA(neumaId).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).not.toBe('ENOENT');
    });
  });
});
