/**
 * Shared kit for the residency-daemon suites:
 *   test/integration/residency-daemon-wrapper.test.js
 *   test/integration/residency-daemon-health.test.js
 *
 * REAL bash, REAL filesystem — the wrapper runs unmodified under a PATH
 * whose stub `systemctl`/`journalctl` shims record their argv to disk (the
 * shim substitutes SYSTEMD ITSELF, never the wrapper-under-test).
 */
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { createTempDir } from './temp-fs.js';

export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const WRAPPER = path.join(REPO_ROOT, 'scripts/neuma-daemon.sh');
export const UNIT_TEMPLATE = path.join(REPO_ROOT, 'systemd/neuma.service.template');

// Build a temp dir with a stub `systemctl` (and `journalctl`) on its PATH.
// The stubs echo their argv to a log file the test can read back to assert
// the wrapper invoked the right commands with the right flags. The wrapper
// also calls `systemctl --user show-environment` for its session probe —
// by default the stub exits 0 for that so require_systemd_user passes.
// Set sessionProbeExitCode != 0 to simulate a no-DBus-session environment
// (R2.1 test for the doctor-survives-broken-session invariant).
export const buildStubBin = async (logFile, { sessionProbeExitCode = 0 } = {}) => {
  const dir = await createTempDir('s20-stub-bin');
  const systemctlStub = `#!/usr/bin/env bash
echo "systemctl $*" >> "${logFile}"
if [[ "$1" == "--user" && "$2" == "show-environment" ]]; then
  echo "STUB_OK=1"
  exit ${sessionProbeExitCode}
fi
exit 0
`;
  const journalctlStub = `#!/usr/bin/env bash
echo "journalctl $*" >> "${logFile}"
exit 0
`;
  await fs.writeFile(path.join(dir, 'systemctl'), systemctlStub);
  await fs.writeFile(path.join(dir, 'journalctl'), journalctlStub);
  await fs.chmod(path.join(dir, 'systemctl'), 0o755);
  await fs.chmod(path.join(dir, 'journalctl'), 0o755);
  return dir;
};

// ai6 R2.4 — deterministic "nothing-is-listening" port: bind ephemeral,
// record, close. Guarantees a port no process holds during the test
// (vs port 1 which is probabilistic).
export const reservedDeadPort = async () => {
  const net = await import('net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
};

// Invoke the wrapper under a PATH that finds the stubs first.
export const runWrapper = (args, { stubBin, env = {}, wrapper = WRAPPER } = {}) => new Promise((resolve, reject) => {
  // We deliberately KEEP /usr/bin etc. on PATH so the wrapper can still find
  // `curl`, `cut`, `grep`, `mkdir`, `rm`, etc. — only systemctl + journalctl
  // are shadowed by the stubs.
  // `wrapper` defaults to the real WRAPPER; the metachar-path regression
  // test overrides it to execute a copy of the wrapper located at a path
  // containing sed-replacement metachars (& \ |), so REPO_ROOT resolution
  // (via SCRIPT_DIR + cd ..) produces the metachar parent.
  const finalEnv = {
    ...process.env,
    ...env,
    PATH: stubBin ? `${stubBin}:${process.env.PATH}` : process.env.PATH,
  };
  const proc = spawn('bash', [wrapper, ...args], { env: finalEnv });
  let stdout = '', stderr = '';
  proc.stdout.on('data', (b) => { stdout += b.toString(); });
  proc.stderr.on('data', (b) => { stderr += b.toString(); });
  proc.on('error', reject);
  proc.on('close', (code) => resolve({ stdout, stderr, exitCode: code }));
});
