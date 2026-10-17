/**
 * THE SERVED MODEL'S TRUE NAME — resolved through the kernel, not the argv.
 *
 * The supervisor hands llama-server its model as an inherited descriptor
 * (custody: the child gets fds, never paths — serving-process-owner.js), so
 * the server's /v1/models self-report names /proc/self/fd/N. After a backend
 * relight onto a SURVIVING server, nothing in this process remembers what
 * that descriptor is: config.model is the placeholder (.env never loads into
 * the desk Electron), and the runtime selection overlay died with the old
 * backend (2026-08-15, the boot log said llmModel: "/proc/self/fd/4").
 *
 * But the kernel remembers. The claim carries the serving pid, and the
 * serving process's own fd table names the real file:
 * readlink /proc/<pid>/fd/<N> → the gguf on disk. Reading a PUBLIC kernel
 * symlink of a process we supervise is observation, not custody — nothing is
 * opened, nothing is touched.
 *
 * impure (readlink over procfs; claim read).
 */

import { readlink } from 'fs/promises';
import { readClaim } from './substrate-claim-registry.js';

// /proc/self/fd/N, /proc/<pid>/fd/N, /dev/fd/N — the descriptor spellings a
// served model id can carry. Capture the descriptor number.
const FD_NAME = /^(?:\/proc\/(?:self|\d+)|\/dev)\/fd\/(\d+)$/;

/** Is this served name a descriptor path rather than an identity? Pure. */
export const isFdServedName = (name) => FD_NAME.test(String(name ?? ''));

/**
 * The public identity a live /v1/models row should become. An FD is never
 * a name: a mapped identity wins; an unmapped FD returns null so callers
 * fall through to claim/env rather than leaking "/proc/self/fd/4" onto the desk.
 * Pure.
 * @param {{id?: string, name?: string}|null} live
 * @param {string|null} [mapped]
 * @returns {string|null}
 */
export const servedKeyFromLive = (live, mapped = null) => {
  if (!live?.id || live.id === 'local-model') return null;
  if (isFdServedName(live.id)) return mapped || null;
  return live.id;
};

/**
 * The identity behind a descriptor-shaped served-model name. The CLAIM is
 * the first authority — the spawning supervisor writes what it launched
 * (model path + catalog key) beside the pid, so the identity survives the
 * process that held it. The kernel readlink is only the fallback for a
 * legacy claim, and only a real `.gguf` target counts: custody staging
 * names an artifact file for its ROLE, not its model (observed 2026-08-15:
 * llmModel: "bytes"), so a role-name resolves to null and callers keep the
 * honest descriptor name until the next spawn writes a full claim.
 * @param {string} servedName - e.g. '/proc/self/fd/4'
 * @returns {Promise<string|null>} model key or absolute gguf path, or null
 */
export const servedModelIdentity = async (servedName) => {
  const fd = FD_NAME.exec(String(servedName ?? ''))?.[1];
  if (!fd) return null;
  const claim = readClaim();
  if (!claim?.pid) return null;
  const declared = [claim.servingModel, claim.model]
    .find((value) => typeof value === 'string' && value.length > 0);
  if (declared) return declared;
  const real = await readlink(`/proc/${claim.pid}/fd/${fd}`).catch(() => null);
  return real && /\.gguf$/i.test(real) ? real : null;
};
