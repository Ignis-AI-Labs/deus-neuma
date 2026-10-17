/**
 * Host probe — the parsers proven on fixtures, and the collectors proven
 * LIVE on this machine (RULE 0: the probe's whole claim is that it measures
 * the real rig — so the test reads the real rig and compares).
 */
import { describe, test, expect } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseSsListeners, parseNvidiaDriver, unexpectedListeners, runHostProbe } from '../../backend/services/security/host-probe.js';

const execFileP = promisify(execFile);

describe('host-probe parsers (fixtures)', () => {
  test('parseSsListeners reads real ss output shapes', () => {
    const text = [
      'LISTEN 0      511          0.0.0.0:3333       0.0.0.0:*    users:(("node",pid=123,fd=22))',
      'LISTEN 0      511             [::]:7777          [::]:*    users:(("node",pid=124,fd=23))',
      'LISTEN 0      100        127.0.0.1:631        0.0.0.0:*',
      'garbage line that is not a listener',
    ].join('\n');
    expect(parseSsListeners(text)).toEqual([
      { address: '0.0.0.0', port: 3333 },
      { address: '[::]', port: 7777 },
      { address: '127.0.0.1', port: 631 },
    ]);
  });

  test('unexpectedListeners subtracts the operator\'s named ports, deduplicated', () => {
    const listeners = [
      { address: '0.0.0.0', port: 3333 },
      { address: '0.0.0.0', port: 22 },
      { address: '127.0.0.1', port: 22 },
      { address: '0.0.0.0', port: 22 },
    ];
    expect(unexpectedListeners(listeners, [3333, 7777])).toEqual([
      { address: '0.0.0.0', port: 22 },
      { address: '127.0.0.1', port: 22 },
    ]);
  });

  test('parseNvidiaDriver takes the first csv line', () => {
    expect(parseNvidiaDriver('610.43.03\n610.43.03\n')).toBe('610.43.03');
    expect(parseNvidiaDriver('')).toBeNull();
  });
});

describe('host-probe LIVE collectors (the real rig, no doubles)', () => {
  test('runHostProbe measures this machine\'s kernel and listeners for real', async () => {
    const { stdout: realKernel } = await execFileP('uname', ['-r']);
    const probe = await runHostProbe({ expectedPorts: [3333, 7777, 22, 631] });
    expect(probe.inventory.kernel).toBe(realKernel.trim());
    expect(Array.isArray(probe.inventory.listeners)).toBe(true);
    // ss works on this box — a null would mean the collector went blind.
    expect(probe.errors).not.toContain('ss failed — listeners unmeasured');
    // NVIDIA is present on this rig (AGENTS.md: the substrate lives on it).
    expect(probe.inventory.nvidiaDriver).toMatch(/^\d+\.\d+/);
    // The finding shape, proven on whatever (if anything) is unexpected:
    for (const f of probe.findings) {
      expect(f).toMatchObject({ layer: 'hardware', source: 'host-probe' });
      expect(f).not.toHaveProperty('status'); // scan output, pre-ledger
      expect(f.externalId).toMatch(/^host:listener:/);
    }
  }, 30000);
});
