/**
 * tailscale — the thin hand on the Tailscale CLI.
 *
 * Everything here shells out to the `tailscale` binary with a list argv, no
 * shell, and a timeout, exactly as Faber does. The binary is found on PATH
 * first, then at the well-known install paths — including the Windows
 * install reached from WSL2 through interop, which is how Corwin's box runs.
 *
 * `serve` is what makes remote access possible without changing the bind:
 *   tailscale serve --bg --https=443 http://127.0.0.1:<port>
 * gives the machine's MagicDNS name a real certificate and proxies to the
 * loopback port the backend already listens on. Faber found live that
 * `serve` PROMPTS and hangs when the tailnet has no certificate domains, so
 * the status is read first and that case is answered in words instead.
 *
 * impure throughout (child processes); the parsers are pure and exported
 * for the tests.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { createLogger } from '../logger.js';

const execFileP = promisify(execFile);
const log = createLogger('Tailscale');

const STATUS_TIMEOUT_MS = 8000;
const SERVE_TIMEOUT_MS = 60000; // first-run certificate provisioning
const DETAIL_MAX = 300;

const KNOWN_PATHS = Object.freeze([
  '/usr/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/mnt/c/Program Files/Tailscale/tailscale.exe',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
]);

const trimDetail = (text) => String(text ?? '').replace(/\r/g, '').trim().slice(0, DETAIL_MAX);

/**
 * Run the CLI. Never throws: a failure comes back as { ok: false, detail }.
 * impure.
 * @param {string} binary
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, stdout: string, detail: string }>}
 */
const run = async (binary, args, timeoutMs) => {
  try {
    const { stdout } = await execFileP(binary, args, {
      timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout).replace(/\r/g, ''), detail: '' };
  } catch (err) {
    return { ok: false, stdout: '', detail: trimDetail(err?.stderr || err?.message) };
  }
};

/**
 * The first usable binary: PATH, then the known install paths. impure (fs).
 * @returns {Promise<string | null>}
 */
export const findTailscaleBinary = async () => {
  const onPath = await run('tailscale', ['version'], STATUS_TIMEOUT_MS);
  if (onPath.ok) return 'tailscale';
  for (const candidate of KNOWN_PATHS) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // not installed here — try the next
    }
  }
  return null;
};

/**
 * The facts the desk needs from `tailscale status --json`. Pure.
 * @param {unknown} json
 * @returns {{ backendState: string | null, dnsName: string | null, certDomains: string[], tailnetIps: string[] }}
 */
export const parseStatus = (json) => {
  const status = json && typeof json === 'object' ? json : {};
  const self = status.Self && typeof status.Self === 'object' ? status.Self : {};
  const dnsName = typeof self.DNSName === 'string' ? self.DNSName.replace(/\.$/, '').toLowerCase() : '';
  return Object.freeze({
    backendState: typeof status.BackendState === 'string' ? status.BackendState : null,
    dnsName: dnsName || null,
    certDomains: Array.isArray(status.CertDomains) ? status.CertDomains.filter((d) => typeof d === 'string') : [],
    tailnetIps: Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs.filter((ip) => typeof ip === 'string') : [],
  });
};

/**
 * Is the loopback port being served? `tailscale serve status` names the
 * proxy target; localhost and 127.0.0.1 are the same door. Pure.
 * @param {string} text
 * @param {number} port
 * @returns {boolean}
 */
export const isServing = (text, port) =>
  String(text ?? '').replace(/localhost/g, '127.0.0.1').includes(`127.0.0.1:${port}`);

/**
 * Installed? Running? What is this machine called on the tailnet? impure.
 * @returns {Promise<{ installed: boolean, binary: string | null, backendState: string | null, dnsName: string | null, certDomains: string[], tailnetIps: string[], detail: string }>}
 */
export const tailscaleStatus = async () => {
  const binary = await findTailscaleBinary();
  if (!binary) {
    return { installed: false, binary: null, backendState: null, dnsName: null, certDomains: [], tailnetIps: [], detail: '' };
  }
  const result = await run(binary, ['status', '--json'], STATUS_TIMEOUT_MS);
  if (!result.ok) {
    return { installed: true, binary, backendState: null, dnsName: null, certDomains: [], tailnetIps: [], detail: result.detail };
  }
  try {
    return { installed: true, binary, ...parseStatus(JSON.parse(result.stdout)), detail: '' };
  } catch (err) {
    log.warn('tailscale status was not JSON', { error: err.message });
    return { installed: true, binary, backendState: null, dnsName: null, certDomains: [], tailnetIps: [], detail: 'tailscale status was not readable' };
  }
};

/**
 * @param {string} binary
 * @param {number} port
 * @returns {Promise<{ serving: boolean, detail: string }>}
 */
export const serveStatus = async (binary, port) => {
  const result = await run(binary, ['serve', 'status'], STATUS_TIMEOUT_MS);
  return { serving: result.ok && isServing(result.stdout, port), detail: result.detail };
};

/**
 * Put HTTPS on the MagicDNS name, proxied to the loopback port. impure.
 * @param {string} binary
 * @param {number} port
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export const enableServe = async (binary, port) => {
  const status = await run(binary, ['status', '--json'], STATUS_TIMEOUT_MS);
  const certDomains = status.ok ? parseStatus(JSON.parse(status.stdout)).certDomains : [];
  if (certDomains.length === 0) {
    return {
      ok: false,
      detail: 'Tailscale has no HTTPS certificate domain for this machine. Turn on HTTPS certificates and MagicDNS in the tailnet admin console, then try again.',
    };
  }
  const modern = await run(binary, ['serve', '--bg', '--https=443', `http://127.0.0.1:${port}`], SERVE_TIMEOUT_MS);
  if (modern.ok) return { ok: true, detail: '' };
  const legacy = await run(binary, ['serve', '--bg', String(port)], SERVE_TIMEOUT_MS);
  return legacy.ok ? { ok: true, detail: '' } : { ok: false, detail: modern.detail || legacy.detail };
};

/**
 * Take HTTPS off again. impure.
 * @param {string} binary
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export const disableServe = async (binary) => {
  const modern = await run(binary, ['serve', '--https=443', 'off'], STATUS_TIMEOUT_MS);
  if (modern.ok) return { ok: true, detail: '' };
  const reset = await run(binary, ['serve', 'reset'], STATUS_TIMEOUT_MS);
  return reset.ok ? { ok: true, detail: '' } : { ok: false, detail: modern.detail || reset.detail };
};
