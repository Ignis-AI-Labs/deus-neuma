/**
 * Workspace File System Error Handling Tests — the WRITE side
 *
 * Tests graceful error handling in NeumaWorkspace for:
 * - Export/import roundtrip integrity
 * - Session compaction edge cases
 * - Concurrent write isolation
 * - Entity name sanitization
 * - Workspace existence checks
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
  // Write then read roundtrip
  // -------------------------------------------------------------------------

  describe('Write-read roundtrip integrity', () => {
    const neumaId = 'roundtrip-test';

    beforeEach(async () => {
      await workspace.create(neumaId);
    });

    test('DNA write and read preserves all fields', async () => {
      const dna = {
        neumaId,
        identity: { name: 'Echo', nature: 'Curious', purpose: 'To learn' },
        sovereignty: { owner: neumaId, generation: 1.0 },
      };
      await workspace.writeDNA(neumaId, dna);
      const result = await workspace.readDNA(neumaId);

      expect(result.neumaId).toBe(neumaId);
      expect(result.identity.name).toBe('Echo');
      expect(result.sovereignty.generation).toBe(1.0);
    });

    test('DNA write archives previous version', async () => {
      const v1 = { neumaId, identity: { name: 'Echo' }, sovereignty: { generation: 1.0 } };
      const v2 = { neumaId, identity: { name: 'Echo Evolved' }, sovereignty: { generation: 2.0 } };

      await workspace.writeDNA(neumaId, v1);
      await workspace.writeDNA(neumaId, v2);

      const current = await workspace.readDNA(neumaId);
      expect(current.identity.name).toBe('Echo Evolved');

      const history = await workspace.getDNAHistory(neumaId);
      expect(history.length).toBe(1);
      expect(history[0].dna.identity.name).toBe('Echo');
    });

    test('session append and read preserves message order', async () => {
      await workspace.createSession(neumaId, 'test-session');
      const messages = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Second message' },
        { role: 'user', content: 'Third message' },
      ];

      for (const msg of messages) {
        await workspace.appendMessage(neumaId, 'test-session', msg);
      }

      const result = await workspace.readSession(neumaId, 'test-session');
      expect(result).toHaveLength(3);
      expect(result[0].content).toBe('First message');
      expect(result[1].content).toBe('Second message');
      expect(result[2].content).toBe('Third message');

      // Each message should have a timestamp added
      result.forEach(msg => expect(msg.timestamp).toBeTruthy());
    });

    test('observation add generates unique IDs', async () => {
      const obs1 = await workspace.addObservation(neumaId, { type: 'test', content: 'obs 1' });
      const obs2 = await workspace.addObservation(neumaId, { type: 'test', content: 'obs 2' });

      expect(obs1.id).not.toBe(obs2.id);
      expect(obs1.id).toHaveLength(16); // 8 bytes hex = 16 chars
    });

    test('journal entries are ordered by append time', async () => {
      await workspace.addJournalEntry(neumaId, { type: 'birth', content: 'I am born', significance: 1.0 });
      await workspace.addJournalEntry(neumaId, { type: 'growth', content: 'I grow', significance: 0.5 });

      const journal = await workspace.readJournal(neumaId);
      expect(journal).toHaveLength(2);
      expect(journal[0].type).toBe('birth');
      expect(journal[1].type).toBe('growth');
    });

    test('export-import roundtrip preserves workspace', async () => {
      // Seed workspace
      await workspace.writeDNA(neumaId, { neumaId, identity: { name: 'Echo' } });
      await workspace.writeSoul(neumaId, { values: ['growth'], philosophy: 'I learn' });
      await workspace.writeProfile(neumaId, { calibrated: true, attributes: {} });
      await workspace.writeSkillTree(neumaId, { skills: [{ id: 'empathy' }], version: '1.0.0' });
      await workspace.writeEntity(neumaId, { name: 'TestEntity', type: 'concept' });
      await workspace.writeRelations(neumaId, [{ from: 'a', to: 'b', type: 'knows' }]);
      await workspace.addObservation(neumaId, { type: 'test', content: 'observed' });
      await workspace.addJournalEntry(neumaId, { type: 'test', content: 'entry' });

      // Export
      const bundle = await workspace.exportWorkspace(neumaId);
      expect(bundle.neumaId).toBe(neumaId);
      expect(bundle.dna.identity.name).toBe('Echo');
      expect(bundle.soul.values).toContain('growth');

      // Import into a new workspace
      const newId = 'imported-neuma';
      await workspace.importWorkspace(newId, bundle);

      const importedDNA = await workspace.readDNA(newId);
      expect(importedDNA.identity.name).toBe('Echo');

      const importedSoul = await workspace.readSoul(newId);
      expect(importedSoul.philosophy).toBe('I learn');

      const importedSkills = await workspace.readSkillTree(newId);
      expect(importedSkills.skills).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Session compaction edge cases
  // -------------------------------------------------------------------------

  describe('Session compaction', () => {
    const neumaId = 'compact-test';

    beforeEach(async () => {
      await workspace.create(neumaId);
    });

    test('does not compact when below threshold', async () => {
      await workspace.createSession(neumaId, 'short');
      for (let i = 0; i < 10; i++) {
        await workspace.appendMessage(neumaId, 'short', { role: 'user', content: `msg-${i}` });
      }

      const compacted = await workspace.compactSession(neumaId, 'short', { threshold: 100 });
      expect(compacted).toBe(false);

      // Messages unchanged
      const msgs = await workspace.readSession(neumaId, 'short');
      expect(msgs).toHaveLength(10);
    });

    test('compacts when above threshold — keeps recent messages', async () => {
      await workspace.createSession(neumaId, 'long');
      for (let i = 0; i < 50; i++) {
        await workspace.appendMessage(neumaId, 'long', {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `message-${i}`,
        });
      }

      const compacted = await workspace.compactSession(neumaId, 'long', { threshold: 30, keepRecent: 10 });
      expect(compacted).toBe(true);

      const msgs = await workspace.readSession(neumaId, 'long');
      // Should be: 1 summary + 10 recent = 11
      expect(msgs).toHaveLength(11);
      expect(msgs[0].compacted).toBe(true);
      expect(msgs[0].content).toContain('[SESSION SUMMARY]');

      // Last 10 original messages preserved
      expect(msgs[1].content).toBe('message-40');
      expect(msgs[10].content).toBe('message-49');
    });

    test('compaction writes atomically (temp file + rename)', async () => {
      await workspace.createSession(neumaId, 'atomic');
      for (let i = 0; i < 40; i++) {
        await workspace.appendMessage(neumaId, 'atomic', { role: 'user', content: `msg-${i}` });
      }

      await workspace.compactSession(neumaId, 'atomic', { threshold: 20, keepRecent: 5 });

      // Temp file should not remain
      const sessionDir = path.join(tempDir, neumaId, 'sessions');
      const files = await fs.readdir(sessionDir);
      expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0);
      expect(files.filter(f => f === 'atomic.jsonl')).toHaveLength(1);
    });

    test('compaction on empty session does not compact', async () => {
      await workspace.createSession(neumaId, 'empty');
      const compacted = await workspace.compactSession(neumaId, 'empty');
      expect(compacted).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent write safety
  // -------------------------------------------------------------------------

  describe('Concurrent write safety', () => {
    const neumaId = 'concurrent-test';

    beforeEach(async () => {
      await workspace.create(neumaId);
    });

    test('concurrent appendMessage to same session preserves all messages', async () => {
      await workspace.createSession(neumaId, 'concurrent');

      // Write 20 messages concurrently to the same session
      const writes = Array.from({ length: 20 }, (_, i) =>
        workspace.appendMessage(neumaId, 'concurrent', {
          role: 'user',
          content: `concurrent-msg-${i}`,
        })
      );
      await Promise.all(writes);

      const msgs = await workspace.readSession(neumaId, 'concurrent');
      expect(msgs).toHaveLength(20);

      // All messages present (order may vary due to concurrency)
      const contents = msgs.map(m => m.content).sort();
      for (let i = 0; i < 20; i++) {
        expect(contents).toContain(`concurrent-msg-${i}`);
      }
    });

    test('concurrent observation writes produce unique files', async () => {
      const writes = Array.from({ length: 10 }, (_, i) =>
        workspace.addObservation(neumaId, { type: 'test', content: `obs-${i}` })
      );
      const results = await Promise.all(writes);

      // All should have unique IDs
      const ids = new Set(results.map(r => r.id));
      expect(ids.size).toBe(10);

      // All should be readable
      const observations = await workspace.listObservations(neumaId);
      expect(observations).toHaveLength(10);
    });

    test('concurrent journal entries all persist', async () => {
      const writes = Array.from({ length: 15 }, (_, i) =>
        workspace.addJournalEntry(neumaId, {
          type: 'growth',
          content: `entry-${i}`,
          significance: 0.5,
        })
      );
      await Promise.all(writes);

      const journal = await workspace.readJournal(neumaId);
      expect(journal).toHaveLength(15);
    });

    test('concurrent workspace creation for different neuma succeeds', async () => {
      const ids = Array.from({ length: 5 }, (_, i) => `concurrent-neuma-${i}`);
      await Promise.all(ids.map(id => workspace.create(id)));

      for (const id of ids) {
        const exists = await workspace.exists(id);
        expect(exists).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Entity name sanitization
  // -------------------------------------------------------------------------

  describe('Entity name sanitization', () => {
    const neumaId = 'entity-sanitize';

    beforeEach(async () => {
      await workspace.create(neumaId);
    });

    test('entity names with special chars are sanitized to underscores', async () => {
      await workspace.writeEntity(neumaId, { name: 'entity@with#special!chars', type: 'concept' });

      // Read back using the same name (should be sanitized consistently)
      const result = await workspace.readEntity(neumaId, 'entity@with#special!chars');
      expect(result).toBeTruthy();
      expect(result.name).toBe('entity@with#special!chars');
    });

    test('entity with slash in name is sanitized (no path injection)', async () => {
      await workspace.writeEntity(neumaId, { name: '../../etc/passwd', type: 'attack' });

      // The file gets created with sanitized name, not as path traversal
      const result = await workspace.readEntity(neumaId, '../../etc/passwd');
      expect(result).toBeTruthy();
      expect(result.type).toBe('attack');

      // Verify the file was created in the entities dir, not escaped
      const entitiesDir = path.join(tempDir, neumaId, 'memory', 'entities');
      const files = await fs.readdir(entitiesDir);
      expect(files.length).toBe(1);
      // File name should be sanitized — slashes and dots replaced with underscores
      expect(files[0]).not.toContain('/');
    });
  });

  // -------------------------------------------------------------------------
  // Workspace existence checks
  // -------------------------------------------------------------------------

  describe('Workspace existence', () => {
    test('exists returns true for created workspace', async () => {
      const id = 'exists-test';
      await workspace.create(id);
      expect(await workspace.exists(id)).toBe(true);
    });

    test('exists returns false for never-created workspace', async () => {
      expect(await workspace.exists('never-existed')).toBe(false);
    });

    test('create is idempotent — calling twice does not error', async () => {
      const id = 'idempotent-create';
      await workspace.create(id);
      await workspace.create(id); // Should not throw

      const exists = await workspace.exists(id);
      expect(exists).toBe(true);
    });
  });
});
