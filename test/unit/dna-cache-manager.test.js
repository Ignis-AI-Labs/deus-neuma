import { describe, test, expect, beforeEach } from 'vitest';
import { once } from 'node:events';
import { setTimeout } from 'node:timers';
import { DNACacheManager } from '../../core/identity/dna-cache-manager.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

describe('DNACacheManager', () => {
  let cacheManager, tempDir;

  beforeEach(async () => {
    tempDir = await createTempDir('dna-cache');

    cacheManager = new DNACacheManager({
      cacheDir: tempDir,
      syncInterval: 999999, // Don't auto-sync during tests
      maxCacheAge: 1000, // 1 second for testing staleness
    });

    // Wait for initialization (which sets dir to read-only 0o555)
    await new Promise(resolve => setTimeout(resolve, 100));

    // Restore write permissions so tests can create files in the cache dir
    await fs.chmod(tempDir, 0o755);
  });

  describe('verifyIntegrity', () => {
    test('returns true for valid cache data', async () => {
      const dna = { identity: { name: 'TestNeuma' } };
      const hash = createHash('sha256').update(JSON.stringify(dna)).digest('hex');

      const isValid = await cacheManager.verifyIntegrity('TestNeuma', {
        dna,
        hash,
        timestamp: Date.now(),
      });

      expect(isValid).toBe(true);
    });

    test('returns false for tampered data', async () => {
      const dna = { identity: { name: 'TestNeuma' } };
      const hash = createHash('sha256').update(JSON.stringify(dna)).digest('hex');

      // Tamper with the DNA after hashing
      dna.identity.name = 'Hacked';

      const isValid = await cacheManager.verifyIntegrity('TestNeuma', {
        dna,
        hash,
        timestamp: Date.now(),
      });

      expect(isValid).toBe(false);
    });

    test('returns false for null cache data', async () => {
      const isValid = await cacheManager.verifyIntegrity('Test', null);
      expect(isValid).toBe(false);
    });

    test('returns false for cache data without dna field', async () => {
      const isValid = await cacheManager.verifyIntegrity('Test', { hash: 'abc' });
      expect(isValid).toBe(false);
    });

    test('returns false when server integrity hash mismatches', async () => {
      const dna = { identity: { name: 'MismatchTest' } };
      const hash = createHash('sha256').update(JSON.stringify(dna)).digest('hex');

      // Set a different hash in the integrity map (simulating server-provided hash)
      cacheManager.integrityMap.set('MismatchTest', {
        hash: 'different-server-hash',
        timestamp: Date.now(),
        verified: true,
      });

      const isValid = await cacheManager.verifyIntegrity('MismatchTest', {
        dna,
        hash,
        timestamp: Date.now(),
      });

      expect(isValid).toBe(false);
    });
  });

  describe('isCacheStale', () => {
    test('returns true when timestamp is missing', () => {
      expect(cacheManager.isCacheStale({})).toBe(true);
    });

    test('returns true when cache exceeds maxCacheAge', () => {
      const oldTimestamp = Date.now() - 5000; // 5 seconds ago, maxCacheAge is 1s
      expect(cacheManager.isCacheStale({ timestamp: oldTimestamp })).toBe(true);
    });

    test('returns false for fresh cache', () => {
      expect(cacheManager.isCacheStale({ timestamp: Date.now() })).toBe(false);
    });
  });

  describe('reportTampering', () => {
    test('writes to tamper log', async () => {
      await cacheManager.reportTampering('TamperNeuma', {
        expected: 'hash-a',
        calculated: 'hash-b',
        action: 'test',
      });

      const logPath = path.join(tempDir, 'tamper.log');
      const content = await fs.readFile(logPath, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.neumaName).toBe('TamperNeuma');
      expect(entry.severity).toBe('HIGH');
    });

    test('emits tampering event', async () => {
      const emitted = once(cacheManager, 'tampering');

      await cacheManager.reportTampering('EventTest', { action: 'test' });

      const [event] = await emitted;
      expect(event).toMatchObject({ neumaName: 'EventTest', details: { action: 'test' }, severity: 'HIGH' });
      const persisted = JSON.parse((await fs.readFile(path.join(tempDir, 'tamper.log'), 'utf8')).trim());
      expect(event).toEqual(persisted);
    });
  });

  describe('clearCache', () => {
    test('removes cache file and integrity entry', async () => {
      // Create a cache file
      const cachePath = path.join(tempDir, 'ClearTest-dna-cache.json');
      await fs.writeFile(cachePath, JSON.stringify({ dna: {}, hash: 'test' }));
      cacheManager.integrityMap.set('ClearTest', { hash: 'test' });

      await cacheManager.clearCache('ClearTest');

      // File should be gone
      await expect(fs.access(cachePath)).rejects.toThrow();
      expect(cacheManager.integrityMap.has('ClearTest')).toBe(false);
    });

    test('does not throw for non-existent cache', async () => {
      await expect(cacheManager.clearCache('NonExistent')).resolves.toBeUndefined();
    });
  });

  describe('handleServerUpdate', () => {
    test('writes cache and updates integrity map', async () => {
      const dna = { identity: { name: 'UpdateNeuma' } };
      const hash = createHash('sha256').update(JSON.stringify(dna)).digest('hex');

      await cacheManager.handleServerUpdate({
        neumaId: 'update-id',
        dna,
        hash,
        timestamp: Date.now(),
      });

      // Integrity map should be updated
      const integrity = cacheManager.integrityMap.get('UpdateNeuma');
      expect(integrity).toBeTruthy();
      expect(integrity.hash).toBe(hash);
      const persisted = JSON.parse(await fs.readFile(path.join(tempDir, 'UpdateNeuma-dna-cache.json'), 'utf8'));
      expect(persisted.dna).toEqual(dna);
      expect(persisted.hash).toBe(hash);
    });
  });
});
