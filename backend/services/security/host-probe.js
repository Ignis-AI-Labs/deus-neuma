// Host probe — the HARDWARE layer of the CSO's watch: the machine the house
// runs on, measured as it is.
//
// Two products:
//   1. INVENTORY — kernel release, GPU driver, and every listening socket
//      with its bind scope, owning process and platform owner. The versions
//      are what the CSO checks hardware advisories (NVIDIA bulletins, kernel
//      CVEs) against; they ride every scan state so the officer always holds
//      the current numbers.
//   2. EXPOSURE FINDINGS — a listener weighed by WHO CAN REACH IT:
//        loopback (127/8, ::1, %lo)   inventory only, never a finding. Only
//                                     local processes reach it, and editors
//                                     and apps churn random loopback ports —
//                                     303 ledger entries in the 2026-10-19
//                                     audit, 280 of them stale, none useful.
//        tailnet (100.64/10, tailscale's fd7a:115c:a1e0::/48)   low: only
//                                     the operator's own tailnet reaches it.
//        network (0.0.0.0, *, [::], a LAN or public address)   HIGH: every
//                                     device that routes here can reach it,
//                                     so it must reach the operator's ear.
//      A port the operator named in the watch list is never a finding. A
//      port the platform owns (platform-ports.js) is named by its owner, not
//      called "unexpected" — but still weighed by scope: NEUMA binds its own
//      ports to loopback, so one reachable from the network is news.
//
// Every collector is a real command on the real machine — a probe that
// cannot run says so in the error field; it never reports a machine it did
// not measure.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { readPlatformPorts, portOwner } from './platform-ports.js';
import { createLogger } from '../logger.js';

const log = createLogger('HostProbe');
const execFileP = promisify(execFile);
const COMMAND_TIMEOUT_MS = 10_000;

const SCOPE_SEVERITY = Object.freeze({ tailnet: 'low', network: 'high' });
const SCOPE_REACH = Object.freeze({
  tailnet: 'from the tailnet only',
  network: 'from the LAN or the internet',
});

// pure — `ss -tlnpH` lines → [{address, port, process, pid}]. Lines look like:
//   LISTEN 0 511 127.0.0.1:47317 0.0.0.0:* users:(("electron",pid=281196,fd=54))
// A socket another user owns carries no users:(…) — process and pid are null.
export const parseSsListeners = (text) => {
  const listeners = [];
  for (const line of String(text || '').split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4 || fields[0] !== 'LISTEN') continue;
    const local = fields[3];
    const at = local.lastIndexOf(':');
    if (at === -1) continue;
    const port = Number(local.slice(at + 1));
    if (!Number.isInteger(port) || port <= 0) continue;
    const owner = line.match(/users:\(\("([^"]*)",pid=(\d+)/);
    listeners.push({
      address: local.slice(0, at),
      port,
      process: owner ? owner[1] : null,
      pid: owner ? Number(owner[2]) : null,
    });
  }
  return listeners;
};

// pure — dotted IPv4 → its four octets, or null.
const ipv4Octets = (host) => {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  return octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255) ? octets : null;
};

/**
 * pure — who can reach a socket bound to this address.
 * @param {string} address - as ss prints it: `0.0.0.0`, `*`, `[::1]`,
 *   `127.0.0.53%lo`, `[fd7a:…]`, `100.64.12.34`
 * @returns {'loopback'|'tailnet'|'network'}
 */
export const bindScope = (address) => {
  const [rawHost, iface = ''] = String(address).split('%');
  if (iface === 'lo') return 'loopback';
  if (iface.startsWith('tailscale')) return 'tailnet';
  const host = rawHost.replace(/^\[|\]$/g, '').toLowerCase();
  const v4 = ipv4Octets(host.replace(/^::ffff:/, ''));
  if (v4) {
    if (v4[0] === 127) return 'loopback';
    if (v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127) return 'tailnet';
    return 'network';
  }
  if (host === '::1') return 'loopback';
  if (host.startsWith('fd7a:115c:a1e0:')) return 'tailnet';
  return 'network';
};

// pure — one exposure group → its ledger finding. The id is scope + port, never
// the exact address, so a service's IPv4 and IPv6 twins are one entry.
const exposureFinding = ({ scope, port, surfaces, processes }, owner) => {
  const who = processes.length
    ? `process ${processes.join(', ')}`
    : `a process this user cannot see (a system service — \`sudo ss -ltnp 'sport = :${port}'\` names it)`;
  const ask = owner
    ? 'NEUMA binds its own ports to loopback by default; confirm this wider bind was meant, or set the service back to 127.0.0.1.'
    : 'If it is meant to be there, name the port in the watch list; otherwise stop the service or bind it to 127.0.0.1.';
  return {
    layer: 'hardware',
    source: 'host-probe',
    externalId: `host:listener:${scope}:${port}`,
    title: owner
      ? `platform port ${port} (${owner}) is reachable ${SCOPE_REACH[scope]}`
      : `unexpected listener on port ${port}, reachable ${SCOPE_REACH[scope]}`,
    severity: SCOPE_SEVERITY[scope],
    summary: `The host answers on ${surfaces.join(', ')} — ${who} — reachable ${SCOPE_REACH[scope]}. A host firewall may still block it; this probe reads binds, not firewall rules. ${ask}`,
    surfaces,
    scope,
    owner,
    process: processes.join(', ') || null,
  };
};

/**
 * pure — listeners → exposure findings: loopback and the operator's named
 * ports dropped, the rest grouped by (scope, port) and weighed by scope.
 * @param {Array<{address: string, port: number, process?: string|null}>} listeners
 * @param {{expectedPorts?: number[], platformPorts?: ReadonlyArray<{from: number, to: number, owner: string}>}} [opts]
 */
export const listenerFindings = (listeners, { expectedPorts = [], platformPorts = [] } = {}) => {
  const expected = new Set(expectedPorts);
  const groups = new Map();
  for (const { address, port, process } of listeners) {
    const scope = bindScope(address);
    if (scope === 'loopback' || expected.has(port)) continue;
    const key = `${scope}:${port}`;
    const group = groups.get(key) || { scope, port, surfaces: [], processes: [] };
    const surface = `${address}:${port}`;
    if (!group.surfaces.includes(surface)) group.surfaces.push(surface);
    if (process && !group.processes.includes(process)) group.processes.push(process);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => exposureFinding(group, portOwner(platformPorts, group.port)));
};

// pure — nvidia-smi csv answer → version string or null.
export const parseNvidiaDriver = (text) => {
  const first = String(text || '').split('\n')[0]?.trim();
  return first || null;
};

// impure — one collector's answer, or null when the machine cannot say
// (nvidia-smi absent on a driverless box is a fact, not a failure).
const run = async (cmd, args) => {
  try {
    const { stdout } = await execFileP(cmd, args, { timeout: COMMAND_TIMEOUT_MS });
    return stdout;
  } catch {
    return null;
  }
};

// impure — the platform's own ports. A registry that cannot be read only
// costs the owner labels (finding ids never carry them), so the probe goes
// on and the miss is logged rather than made a blind spot.
const platformPortsOrEmpty = () => {
  try {
    return readPlatformPorts();
  } catch (err) {
    log.warn('platform port registry unreadable — listeners carry no owner labels this run', { error: err.message });
    return [];
  }
};

/**
 * Measure the host. Never throws.
 *
 * impure — spawns uname / nvidia-smi / ss
 * @param {{expectedPorts?: number[], platformPorts?: ReadonlyArray<{from: number, to: number, owner: string}>}} [opts]
 *   platformPorts — defaults to the live registry (platform-ports.js)
 * @returns {Promise<{inventory: {kernel: string|null, nvidiaDriver: string|null, listeners: Array}, findings: Array<Object>, errors: string[]}>}
 */
export const runHostProbe = async ({ expectedPorts = [], platformPorts = platformPortsOrEmpty() } = {}) => {
  const [kernelRaw, nvidiaRaw, ssRaw] = await Promise.all([
    run('uname', ['-r']),
    run('nvidia-smi', ['--query-gpu=driver_version', '--format=csv,noheader']),
    run('ss', ['-tlnpH']),
  ]);
  const errors = [];
  if (kernelRaw === null) errors.push('uname failed — kernel unknown');
  if (ssRaw === null) errors.push('ss failed — listeners unmeasured');

  const listeners = ssRaw === null ? [] : parseSsListeners(ssRaw);
  const inventory = {
    kernel: kernelRaw?.trim() || null,
    nvidiaDriver: nvidiaRaw === null ? null : parseNvidiaDriver(nvidiaRaw),
    listeners: listeners.map((l) => ({ ...l, scope: bindScope(l.address), owner: portOwner(platformPorts, l.port) })),
  };

  return { inventory, findings: listenerFindings(listeners, { expectedPorts, platformPorts }), errors };
};
