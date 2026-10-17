// Host probe — the HARDWARE layer of the CSO's watch: the machine the house
// runs on, measured as it is.
//
// Two products:
//   1. INVENTORY — kernel release, GPU driver. These versions are what the
//      CSO checks hardware advisories (NVIDIA bulletins, kernel CVEs)
//      against; they ride every scan state so the officer always holds the
//      current numbers.
//   2. DRIFT FINDINGS — anything answering on a port the operator never
//      named. An unexpected listener is a hardware-layer threat entry until
//      a human claims it.
//
// Every collector is a real command on the real machine — a probe that
// cannot run says so in the error field; it never reports a machine it did
// not measure.

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);
const COMMAND_TIMEOUT_MS = 10_000;

// pure — `ss -tlnH` lines → [{address, port}]. Lines look like:
//   LISTEN 0 511 0.0.0.0:3333 0.0.0.0:*    users:(("node",pid=…))
export const parseSsListeners = (text) => {
  const listeners = [];
  for (const line of String(text || '').split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4 || fields[0] !== 'LISTEN') continue;
    const local = fields[3];
    const at = local.lastIndexOf(':');
    if (at === -1) continue;
    const port = Number(local.slice(at + 1));
    if (Number.isInteger(port) && port > 0) {
      listeners.push({ address: local.slice(0, at), port });
    }
  }
  return listeners;
};

// pure — listeners minus the operator's named ports, deduplicated.
export const unexpectedListeners = (listeners, expectedPorts) => {
  const expected = new Set(expectedPorts);
  const seen = new Set();
  return listeners.filter(({ address, port }) => {
    if (expected.has(port)) return false;
    const key = `${address}:${port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

/**
 * Measure the host. Never throws.
 *
 * impure — spawns uname / nvidia-smi / ss
 * @param {{expectedPorts?: number[]}} [opts]
 * @returns {Promise<{inventory: {kernel: string|null, nvidiaDriver: string|null, listeners: Array}, findings: Array<Object>, errors: string[]}>}
 */
export const runHostProbe = async ({ expectedPorts = [] } = {}) => {
  const [kernelRaw, nvidiaRaw, ssRaw] = await Promise.all([
    run('uname', ['-r']),
    run('nvidia-smi', ['--query-gpu=driver_version', '--format=csv,noheader']),
    run('ss', ['-tlnH']),
  ]);
  const errors = [];
  if (kernelRaw === null) errors.push('uname failed — kernel unknown');
  if (ssRaw === null) errors.push('ss failed — listeners unmeasured');

  const inventory = {
    kernel: kernelRaw?.trim() || null,
    nvidiaDriver: nvidiaRaw === null ? null : parseNvidiaDriver(nvidiaRaw),
    listeners: ssRaw === null ? [] : parseSsListeners(ssRaw),
  };

  const findings = unexpectedListeners(inventory.listeners, expectedPorts).map(({ address, port }) => ({
    layer: 'hardware',
    source: 'host-probe',
    externalId: `host:listener:${address}:${port}`,
    title: `unexpected listener on ${address}:${port}`,
    severity: 'medium',
    summary: `The host answers on ${address}:${port}, which the operator's watch list does not name. Identify the process (ss -tlnp) and either claim the port in the watch list or close it.`,
    surfaces: [`${address}:${port}`],
  }));

  return { inventory, findings, errors };
};
