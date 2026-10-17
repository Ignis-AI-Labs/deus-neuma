import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  createTrafficMonitor,
  detectTrafficSignals,
  normalizeTrafficEvent,
  normalizeTrafficPath,
} from '../../backend/services/security/traffic-monitor.js';
import {
  createCircuitBreaker,
  isLoopbackSource,
  normalizeSource,
} from '../../backend/services/security/circuit-breaker.js';

const waitFor = async (read, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition did not become true');
};

const alpha = (index) => {
  let value = index;
  let out = '';
  do {
    out = String.fromCharCode(97 + (value % 26)) + out;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return out;
};

describe('security traffic pulse and circuit breaker (real disk)', () => {
  let root;
  let savedDataRoot;
  let breaker;
  let nowMs;

  beforeAll(async () => {
    root = await createTempDir('security-traffic-monitor');
    savedDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = root;
    nowMs = Date.parse('2026-08-12T12:00:00.000Z');
    breaker = createCircuitBreaker({
      path: path.join(root, 'settings', 'breakers.json'),
      now: () => nowMs,
    });
  });

  afterAll(async () => {
    if (savedDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = savedDataRoot;
    await fs.rm(root, { recursive: true, force: true });
  });

  test('normalizes only kernel-style source addresses and strips request secrets', () => {
    expect(normalizeSource('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(normalizeSource('[fe80::1%eth0]')).toBe('fe80::1');
    expect(normalizeSource('198.51.100.7:443')).toBeNull();
    expect(isLoopbackSource('::ffff:127.0.0.9')).toBe(true);
    expect(normalizeTrafficPath('/api/v1/threats/0123456789abcdef?token=never-record-this'))
      .toBe('/api/v1/threats/:id');
    expect(normalizeTrafficEvent({
      source: '198.51.100.7', method: 'get', path: '/x?secret=value', status: 401,
    }, nowMs)).toMatchObject({
      source: '198.51.100.7', sourceClass: 'remote', method: 'GET', path: '/x', statusClass: '4xx',
    });
  });

  test('detects only threshold-backed traffic signals', () => {
    const events = Array.from({ length: 120 }, (_, index) => normalizeTrafficEvent({
      atMs: nowMs,
      source: '198.51.100.8',
      method: 'GET',
      path: `/missing/${alpha(index % 40)}`,
      status: 404,
    }, nowMs));
    expect(detectTrafficSignals(events, nowMs)).toContainEqual(expect.objectContaining({
      type: 'path_scan', severity: 'critical', count: 120,
    }));
    expect(detectTrafficSignals(events.slice(0, 119), nowMs)).toEqual([]);
  });

  test('persists bounded manual rules, preserves loopback recovery, and records the act', async () => {
    const blocked = await breaker.blockSource({
      source: '::ffff:198.51.100.9',
      durationSeconds: 30,
      reason: 'Repeated credential probes reached the authentication boundary',
      actor: 'guardianlane',
    });
    expect(blocked.rule).toMatchObject({ source: '198.51.100.9', automatic: false, actor: 'guardianlane' });
    expect(await breaker.evaluate('198.51.100.9')).toMatchObject({ blocked: true, reason: 'source_blocked' });
    expect(await breaker.evaluate('127.0.0.1')).toMatchObject({ blocked: false });
    expect((await fs.stat(path.join(root, 'settings', 'breakers.json'))).mode & 0o777).toBe(0o600);

    const actFiles = await fs.readdir(path.join(root, 'acts'));
    const actRecord = await fs.readFile(path.join(root, 'acts', actFiles[0]), 'utf8');
    expect(actRecord).toContain('security/security_circuit_breaker');
    expect(actRecord).toContain('198.51.100.9');

    await breaker.unblockSource({
      source: '198.51.100.9',
      reason: 'The credential probe has stopped and the source was reviewed',
      actor: 'guardianlane',
    });
    expect(await breaker.evaluate('198.51.100.9')).toMatchObject({ blocked: false });
  });

  test('automatically contains only a directly observed critical remote pattern', async () => {
    const monitor = createTrafficMonitor({
      now: () => nowMs,
      onCritical: ({ source, signal }) => breaker.autoContain({ source, signal: signal.detail }),
    });
    for (let index = 0; index < 120; index += 1) {
      monitor.record({
        source: '203.0.113.44',
        method: 'GET',
        path: `/probe/${alpha(index % 40)}`,
        status: 404,
      });
    }

    const decision = await waitFor(async () => {
      const current = await breaker.evaluate('203.0.113.44');
      return current.blocked ? current : null;
    });
    expect(decision).toMatchObject({ blocked: true, reason: 'source_blocked' });
    const state = await breaker.load({ fresh: true });
    expect(state.blockedSources).toContainEqual(expect.objectContaining({
      source: '203.0.113.44', automatic: true, actor: 'security-watch',
    }));
    expect(Date.parse(state.blockedSources.find((entry) => entry.source === '203.0.113.44').until) - nowMs)
      .toBe(15 * 60 * 1000);
    expect(monitor.snapshot({ windowSeconds: 60 }).anomalies)
      .toContainEqual(expect.objectContaining({ source: '203.0.113.44', type: 'path_scan' }));
  });

  test('keeps only the latest 5,000 request events', () => {
    const monitor = createTrafficMonitor({ now: () => nowMs, onCritical: () => undefined });
    for (let index = 0; index < 5100; index += 1) {
      monitor.record({ source: '127.0.0.1', method: 'GET', path: `/local/${index}`, status: 200 });
    }
    const snapshot = monitor.snapshot({ windowSeconds: 60, limit: 200 });
    expect(snapshot.totals.requests).toBe(5000);
    expect(snapshot.recent).toHaveLength(200);
  });
});
