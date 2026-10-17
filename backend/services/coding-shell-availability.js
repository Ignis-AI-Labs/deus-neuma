/** Coding shell prerequisites; a failed probe never permits an unconfined fallback. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Pure host policy; the overlay confinement implementation is Linux-only. */
export const shellPlatformError = (platform) => platform === 'linux' ? null
  : 'Coding shell execution is unavailable on this operating system. Its confinement requires Linux and bubblewrap; commands will not run without confinement.';

/** Pure version check for the overlay flags used by the command runner. */
export const supportsShellOverlay = (version) => {
  const match = /^bubblewrap (\d+)\.(\d+)(?:\.\d+)?(?:\s|$)/.exec(version.trim());
  return Boolean(match && (Number(match[1]) > 0 || Number(match[2]) >= 10));
};

/** impure — check the current host and executable before preparing or using a shell. */
export const assertCodingShellAvailable = async () => {
  const platformError = shellPlatformError(process.platform);
  if (platformError) throw new Error(platformError);
  let stdout;
  try {
    ({ stdout } = await execFileAsync('bwrap', ['--version'], { timeout: 3000, maxBuffer: 4096 }));
  } catch (cause) {
    throw new Error('Coding shell execution is unavailable: bubblewrap could not be started. Install an executable bubblewrap 0.10 or newer on this Linux host. Commands will not run without confinement.', { cause });
  }
  if (!supportsShellOverlay(stdout)) {
    throw new Error('Coding shell execution is unavailable: bubblewrap 0.10 or newer is required for confined overlays. Update bubblewrap before retrying.');
  }
};
