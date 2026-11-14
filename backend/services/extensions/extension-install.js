/**
 * ADDING AN EXTENSION — third-party code, so it earns its place before it runs:
 *
 *   1. The security check must be able to run. Its online half (the OSV
 *      vulnerability database) is a switch the person controls; while it is
 *      off nothing is downloaded at all — an extension is never added unchecked.
 *   2. npm installs the exact pinned version into a fresh folder of its own,
 *      with install scripts OFF (--ignore-scripts): a package's install script
 *      is the commonest way a poisoned package runs its payload, and nothing in
 *      this list needs one.
 *   3. The installed copy is confirmed: the version is the pinned one and the
 *      entry file is where the catalog says.
 *   4. Every package in what was installed — the extension and everything it
 *      pulled in — is checked against OSV. A high or critical known flaw, or a
 *      package OSV knows to be malicious, refuses the extension and the folder
 *      is deleted. Lesser findings are kept and shown.
 *   5. Only then does the folder take its place, and that folder — the copy
 *      that was checked — is what runs. Never `npx`, which would fetch again.
 *
 * The daily security watch checks every installed extension again
 * (recheckInstalledExtensions); a new high or critical finding blocks it until
 * it is updated or removed.
 *
 * impure — npm, the network (npm registry, OSV), the data root.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { boundedExec } from '../bounded-exec.js';
import { isConnectionOn } from '../connections/connection-switches.js';
import { runAdvisoryScan } from '../security/advisory-scan.js';
import { extensionById } from './extension-catalog.js';
import { extensionsDir, extensionDir, readInstalled, updateInstalled, forgetKeys } from './extension-store.js';

/** Findings at these levels refuse an extension (and block an installed one). */
export const BLOCKING_SEVERITIES = Object.freeze(['critical', 'high']);
export const NPM_TIMEOUT_MS = 5 * 60_000;

export class ExtensionRefused extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.detail = detail;
  }
}

const WIN = process.platform === 'win32';
// npm is a .cmd on Windows, which Node will not spawn without a shell; cmd.exe runs it.
// Every argument is fixed or from the catalog — nothing a person or a being typed.
const npm = (args, timeoutMs) => (WIN
  ? boundedExec('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { timeoutMs })
  : boundedExec('npm', args, { timeoutMs }));

const tail = (text, n = 600) => {
  const t = String(text || '').trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
};

/**
 * What a check means for an extension. Pure.
 * @param {{ ok: boolean, off?: boolean, error?: string|null, checked: number, hits: Array<{externalId: string, severity: string, title: string}> }} scan
 * @returns {{ ok: true, findings: object[] } | { ok: false, why: string, findings: object[] }}
 */
export const judgeScan = (scan) => {
  const findings = (scan?.hits ?? []).map((h) => ({ id: h.externalId, severity: String(h.severity || 'unknown').toLowerCase(), title: h.title, packages: (h.affected ?? []).map((a) => `${a.package}@${a.version}`) }));
  if (scan?.off) {
    return { ok: false, findings, why: 'the security check cannot run while the Security watch\'s online check is off (Settings → Security → Connections). An extension never runs unchecked.' };
  }
  if (!scan?.ok) return { ok: false, findings, why: `the security check did not finish (${scan?.error || 'no answer'}), so the extension was not trusted` };
  const blocking = findings.filter((f) => BLOCKING_SEVERITIES.includes(f.severity));
  if (blocking.length > 0) {
    return { ok: false, findings, why: `the security check found ${blocking.length} high or critical known flaw(s): ${blocking.slice(0, 5).map((f) => `${f.id} in ${f.packages.join(', ')}`).join('; ')}` };
  }
  return { ok: true, findings };
};

const checkRecord = (scan, verdict) => ({
  at: new Date().toISOString(), checked: scan?.checked ?? 0, verdict: verdict.ok ? 'passed' : 'refused',
  ...(verdict.ok ? {} : { why: verdict.why }), findings: verdict.findings,
});

/**
 * Install one catalog entry (or, for tests and for the refusal proof, any entry of the same shape).
 * impure.
 * @returns {Promise<object>} the installed record
 * @throws {ExtensionRefused} with the plain reason, and nothing left on disk
 */
export const installEntry = async (entry) => {
  if (!isConnectionOn('security-watch')) {
    throw new ExtensionRefused('the security check cannot run while the Security watch\'s online check is off (Settings → Security → Connections). Nothing was downloaded: an extension never runs unchecked.');
  }
  await fs.mkdir(extensionsDir(), { recursive: true, mode: 0o700 });
  const staging = path.join(extensionsDir(), `.${entry.id}-${randomBytes(6).toString('hex')}`);
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    // `overrides`: a library lifted to its patched release, same major only (extension-catalog.js).
    await fs.writeFile(path.join(staging, 'package.json'), `${JSON.stringify({
      name: `neuma-extension-${entry.id}`, private: true, ...(entry.overrides ? { overrides: entry.overrides } : {}),
    }, null, 2)}\n`);
    const installed = await npm(['install', '--prefix', staging, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund',
      '--save-exact', '--package-lock=true', `${entry.package}@${entry.version}`], NPM_TIMEOUT_MS);
    if (!installed.ok) {
      throw new ExtensionRefused(installed.timedOut ? 'npm did not finish installing it in time' : `npm could not install it: ${tail(installed.stderr) || `exit ${installed.code}`}`);
    }
    const own = JSON.parse(await fs.readFile(path.join(staging, 'node_modules', entry.package, 'package.json'), 'utf8').catch(() => '{}'));
    if (own.version !== entry.version) throw new ExtensionRefused(`npm installed ${entry.package}@${own.version ?? 'nothing'}, not the pinned ${entry.version}`);
    if (entry.bin && !(await fs.stat(path.join(staging, 'node_modules', entry.package, entry.bin)).catch(() => null))?.isFile()) {
      throw new ExtensionRefused(`${entry.package}@${entry.version} has no entry file at ${entry.bin}`);
    }
    const scan = await runAdvisoryScan({ id: `extension:${entry.id}`, path: staging });
    const verdict = judgeScan(scan);
    if (!verdict.ok) throw new ExtensionRefused(`${entry.name} was not added: ${verdict.why}`, { check: checkRecord(scan, verdict) });
    await fs.rm(extensionDir(entry.id), { recursive: true, force: true });
    await fs.rename(staging, extensionDir(entry.id));
    return updateInstalled(entry.id, (prior) => ({
      id: entry.id, package: entry.package, version: entry.version, installedAt: new Date().toISOString(),
      enabled: prior?.enabled ?? true, blocked: false, tools: null, check: checkRecord(scan, verdict),
    }));
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
};

/** impure — install a catalog extension by id. */
export const installExtension = async (id) => {
  const entry = extensionById(id);
  if (!entry) throw new ExtensionRefused(`no extension ${id} in the catalog`);
  if (entry.held) throw new ExtensionRefused(`${entry.name} is held back: ${entry.held}`);
  return installEntry(entry);
};

/** impure — remove an extension: its folder, its record and its keys. */
export const removeExtension = async (id) => {
  const had = Boolean((await readInstalled())[id]);
  await fs.rm(extensionDir(id), { recursive: true, force: true });
  await updateInstalled(id, null);
  await forgetKeys(id);
  return had;
};

/**
 * Check one installed extension again; a high or critical finding blocks it,
 * a clean check unblocks it. impure.
 * @returns {Promise<{ repo: string, scan: object, record: object|null }>}
 */
export const recheckExtension = async (id) => {
  const scan = await runAdvisoryScan({ id: `extension:${id}`, path: extensionDir(id) });
  const verdict = judgeScan(scan);
  // A check that could not run changes nothing: not knowing is not "clean", nor "flawed".
  const decided = scan.ok === true;
  const record = await updateInstalled(id, (prior) => (prior ? {
    ...prior,
    check: decided ? checkRecord(scan, verdict) : { ...(prior.check ?? {}), lastAttempt: new Date().toISOString(), lastError: scan.off ? 'online check off' : scan.error },
    ...(decided ? { blocked: !verdict.ok, ...(verdict.ok ? { blockedWhy: null } : { blockedWhy: verdict.why }) } : {}),
  } : null));
  return { repo: `extension:${id}`, scan, record };
};

/** impure — every installed extension checked again (the daily watch's leg). */
export const recheckInstalledExtensions = async () => {
  const legs = [];
  for (const id of Object.keys(await readInstalled())) legs.push(await recheckExtension(id));
  return legs;
};
