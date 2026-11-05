/**
 * Host probe — the parsers and the exposure weighing proven on `ss -tlnpH`
 * text captured from this rig (2026-10-19), the platform port registry read
 * from its real owning modules, and the collectors proven LIVE on this
 * machine (RULE 0: the probe's whole claim is that it measures the real rig —
 * so the test reads the real rig and compares).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTempDir } from '../helpers/temp-fs.js';
import { loadConfig } from '../../backend/config.js';
import {
  parseSsListeners, parseNvidiaDriver, bindScope, listenerFindings, runHostProbe,
} from '../../backend/services/security/host-probe.js';
import { buildPortRegistry, portOwner, readPlatformPorts } from '../../backend/services/security/platform-ports.js';

const execFileP = promisify(execFile);

// Captured verbatim from `ss -tlnpH` on this rig, 2026-10-19 (a subset): the
// three tailnet/wildcard binds the audit named, a %lo bind, 127/8 binds with
// and without an owner, and an IPv6 loopback.
const CAPTURED_SS = [
  'LISTEN 0      4096                 100.64.12.34:64870 0.0.0.0:*                                         ',
  'LISTEN 0      10                         0.0.0.0:27500 0.0.0.0:*                                         ',
  'LISTEN 0      511                      127.0.0.1:41343 0.0.0.0:* users:(("llmster",pid=268001,fd=42))    ',
  'LISTEN 0      511                      127.0.0.1:47317 0.0.0.0:* users:(("electron",pid=281196,fd=54))   ',
  'LISTEN 0      4096                    127.0.0.54:53    0.0.0.0:*                                         ',
  'LISTEN 0      4096                 127.0.0.53%lo:53    0.0.0.0:*                                         ',
  'LISTEN 0      512                      127.0.0.1:8089  0.0.0.0:* users:(("3",pid=13237,fd=58))           ',
  'LISTEN 0      50                               *:1716        *:* users:(("kdeconnectd",pid=4041,fd=17))  ',
  'LISTEN 0      4096   [fd7a:115c:a1e0::ab:cd]:50266    [::]:*                                         ',
  'LISTEN 0      4096                         [::1]:631      [::]:*                                         ',
].join('\n');

describe('host-probe parsers (captured ss text)', () => {
  test('parseSsListeners reads address, port and the owning process when ss can see it', () => {
    const listeners = parseSsListeners(`${CAPTURED_SS}\ngarbage line that is not a listener`);
    expect(listeners).toHaveLength(10);
    expect(listeners[0]).toEqual({ address: '100.64.12.34', port: 64870, process: null, pid: null });
    expect(listeners[3]).toEqual({ address: '127.0.0.1', port: 47317, process: 'electron', pid: 281196 });
    expect(listeners[5]).toEqual({ address: '127.0.0.53%lo', port: 53, process: null, pid: null });
    expect(listeners[7]).toEqual({ address: '*', port: 1716, process: 'kdeconnectd', pid: 4041 });
    expect(listeners[8]).toMatchObject({ address: '[fd7a:115c:a1e0::ab:cd]', port: 50266 });
  });

  test('bindScope: loopback, tailnet, or reachable from the network', () => {
    for (const a of ['127.0.0.1', '127.0.0.54', '127.0.0.53%lo', '[::1]', '[::ffff:127.0.0.1]']) expect(bindScope(a)).toBe('loopback');
    for (const a of ['100.64.12.34', '100.64.0.1', '100.127.255.254', '[fd7a:115c:a1e0::ab:cd]', '0.0.0.0%tailscale0']) expect(bindScope(a)).toBe('tailnet');
    for (const a of ['0.0.0.0', '*', '[::]', '192.168.1.20', '100.128.0.1', '100.63.0.1', '[fe80::1]%wlp3s0', '[2001:db8::1]']) expect(bindScope(a)).toBe('network');
  });

  test('parseNvidiaDriver takes the first csv line', () => {
    expect(parseNvidiaDriver('610.43.03\n610.43.03\n')).toBe('610.43.03');
    expect(parseNvidiaDriver('')).toBeNull();
  });
});

describe('host-probe exposure weighing (captured ss text)', () => {
  test('loopback is inventory only; wildcard is HIGH; tailnet is low; ids are scope + port', () => {
    const findings = listenerFindings(parseSsListeners(CAPTURED_SS));
    const byId = Object.fromEntries(findings.map((f) => [f.externalId, f]));
    expect(Object.keys(byId).sort()).toEqual([
      'host:listener:network:1716', 'host:listener:network:27500',
      'host:listener:tailnet:50266', 'host:listener:tailnet:64870',
    ]);
    expect(byId['host:listener:network:27500']).toMatchObject({ severity: 'high', layer: 'hardware', source: 'host-probe', scope: 'network' });
    expect(byId['host:listener:tailnet:64870'].severity).toBe('low');
    // ss names the owner when it can; otherwise the summary says how to find it.
    expect(byId['host:listener:network:1716'].summary).toContain('process kdeconnectd');
    expect(byId['host:listener:network:27500'].summary).toContain("sudo ss -ltnp 'sport = :27500'");
    for (const f of findings) expect(f).not.toHaveProperty('status'); // scan output, pre-ledger
  });

  test('a service\'s IPv4 and IPv6 wildcard twins are ONE finding', () => {
    const twins = [
      'LISTEN 0      511          0.0.0.0:9000       0.0.0.0:*    users:(("node",pid=123,fd=22))',
      'LISTEN 0      511             [::]:9000          [::]:*    users:(("node",pid=123,fd=23))',
    ].join('\n');
    const findings = listenerFindings(parseSsListeners(twins));
    expect(findings).toHaveLength(1);
    expect(findings[0].externalId).toBe('host:listener:network:9000');
    expect(findings[0].surfaces).toEqual(['0.0.0.0:9000', '[::]:9000']);
  });

  test('the operator\'s named ports are never findings; platform ports are named, not "unexpected"', () => {
    const registry = buildPortRegistry({ llmFallbacks: [27500] });
    const findings = listenerFindings(parseSsListeners(CAPTURED_SS), { expectedPorts: [1716], platformPorts: registry });
    expect(findings.map((f) => f.externalId)).not.toContain('host:listener:network:1716');
    const platform = findings.find((f) => f.externalId === 'host:listener:network:27500');
    expect(platform.title).toBe('platform port 27500 (local LLM server port) is reachable from the LAN or the internet');
    expect(platform.title).not.toMatch(/unexpected/);
    expect(platform.severity).toBe('high'); // the platform binds loopback; a wide bind is still news
  });
});

describe('platform port registry (the owning modules, read for real)', () => {
  let claimDir;
  const saved = {};
  beforeEach(async () => {
    claimDir = await createTempDir('platform-ports');
    saved.claim = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = claimDir;
  });
  afterEach(() => {
    if (saved.claim === undefined) delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
    else process.env.NEUMA_SUBSTRATE_CLAIM_DIR = saved.claim;
  });

  test('agent lanes, LLM fallbacks, sidecars, this desk and a live substrate claim all carry owners', async () => {
    loadConfig({ PORT: '47317', FRONTEND_PORT: '7777' });
    // A live pid (this test's own) holding the claim, the way llama-server's launcher writes it.
    await fs.writeFile(path.join(claimDir, 'substrate-claim.json'), JSON.stringify({ pid: process.pid, port: 18089 }));
    const registry = readPlatformPorts({});
    expect(portOwner(registry, 18089)).toBe(`house llama-server (pid ${process.pid})`);
    expect(portOwner(registry, 47317)).toBe('this NEUMA backend');
    expect(portOwner(registry, 7777)).toBe('NEUMA frontend');
    expect(portOwner(registry, 8089)).toBe('configured llama-server');
    expect(portOwner(registry, 11434)).toBe('local LLM server port');
    expect(portOwner(registry, 7865)).toBe('whisper sidecar');
    expect(portOwner(registry, 8190)).toBe('image-forge (ComfyUI) sidecar');
    expect(portOwner(registry, 47405)).toBe('agent lane (claude)');
    expect(portOwner(registry, 47899)).toBe('agent lane (agent)');
    expect(portOwner(registry, 27500)).toBeNull();
  });
});

describe('host-probe LIVE collectors (the real rig, no doubles)', () => {
  test('runHostProbe measures this machine\'s kernel and listeners for real', async () => {
    const { stdout: realKernel } = await execFileP('uname', ['-r']);
    const probe = await runHostProbe({ expectedPorts: [3333, 7777] });
    expect(probe.inventory.kernel).toBe(realKernel.trim());
    // ss works on this box — a null would mean the collector went blind.
    expect(probe.errors).not.toContain('ss failed — listeners unmeasured');
    expect(probe.inventory.listeners.length).toBeGreaterThan(0);
    for (const l of probe.inventory.listeners) expect(['loopback', 'tailnet', 'network']).toContain(l.scope);
    // The driver is read wherever nvidia-smi answers (the operator's rig: AGENTS.md, the substrate
    // lives on it); a machine with no NVIDIA card (a CI runner) reads none, never a made-up value.
    const smi = await execFileP('nvidia-smi', ['--query-gpu=driver_version', '--format=csv,noheader']).then(() => true, () => false);
    if (smi) expect(probe.inventory.nvidiaDriver).toMatch(/^\d+\.\d+/);
    else expect(probe.inventory.nvidiaDriver ?? null).toBeNull();
    for (const f of probe.findings) {
      expect(f).toMatchObject({ layer: 'hardware', source: 'host-probe' });
      expect(f.externalId).toMatch(/^host:listener:(tailnet|network):\d+$/);
    }
    // Every port bound ONLY to loopback is inventory, never a finding.
    const widePorts = new Set(probe.inventory.listeners.filter((l) => l.scope !== 'loopback').map((l) => l.port));
    const loopbackOnly = probe.inventory.listeners.filter((l) => !widePorts.has(l.port)).map((l) => l.port);
    expect(loopbackOnly.length).toBeGreaterThan(0);
    const findingPorts = new Set(probe.findings.map((f) => Number(f.externalId.split(':').pop())));
    for (const port of loopbackOnly) expect(findingPorts.has(port)).toBe(false);
  }, 30000);
});
