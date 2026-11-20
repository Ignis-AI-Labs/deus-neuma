// sidecar-trust — each voice sidecar and the backend know each other by an engine-derived key
// (re-audit 2026-10-29, M-06; socket binding added for P6-76).
//
// The sidecars bind loopback, and loopback is shared by every program on the machine. A program
// that answered /health on a sidecar's port used to be adopted as that sidecar and was then handed
// the voice clip and the transcription audio; its own idle_seconds kept it from ever being reaped.
// Now:
//   * the install keeps one random root key in its settings dir (walled from every being, 0600);
//     each spawned sidecar receives only the key derived for its own engine id;
//   * before the backend sends a sidecar ANYTHING but a /health poll, the sidecar proves an HMAC
//     over a fresh challenge, its engine id, and the listening socket. A proof relayed to another
//     engine or port fails, and the key itself never crosses the wire;
//   * the backend's own calls carry that engine's token, and the sidecar refuses every call without
//     it (voice-engines/_shared/browser_guard.py).
// Loopback only: an endpoint the operator points at another machine is theirs to trust, and never
// receives the token.

import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSettingsDir } from '../data-root.js';

export const SIDECAR_KEY_ENV = 'NEUMA_SIDECAR_KEY';
export const SIDECAR_ENGINE_ENV = 'NEUMA_SIDECAR_ENGINE';
export const SIDECAR_CALLER_HEADER = 'x-neuma-sidecar';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const PROOF_TIMEOUT_MS = 2000;

// pure — engine ids become credential labels; a URL port is the relay-bound socket identity.
const validEngine = (engine) => {
  const id = String(engine || '');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('a loopback sidecar call must name its engine');
  return id;
};
export const socketIdentity = (origin) => {
  const url = new URL(origin);
  const host = ['[::1]', '::1'].includes(url.hostname) ? '[::1]' : '127.0.0.1';
  return `${host}:${url.port || '80'}`;
};

/** pure — the independent key one spawned engine holds. */
export const engineKey = (key, engine) => createHmac('sha256', key)
  .update(`neuma-sidecar-engine-v1\n${validEngine(engine)}`).digest();

/** pure — the token only this engine's backend calls carry. */
export const callerToken = (key, engine) => createHmac('sha256', engineKey(key, engine))
  .update(`neuma-sidecar-caller-v2\n${validEngine(engine)}`).digest('hex');

/** pure — proof computed by a sidecar holding only its derived key. */
export const engineIdentityProof = (derivedKey, engine, challenge, socket) => createHmac('sha256', Buffer.isBuffer(derivedKey) ? derivedKey : Buffer.from(derivedKey, 'hex'))
  .update(`neuma-sidecar-identity-v2\n${validEngine(engine)}\n${socket}\n${challenge}`).digest('hex');

/** pure — proof for this engine, fresh challenge, and actual listening socket. */
export const identityProof = (key, engine, challenge, socket) => engineIdentityProof(engineKey(key, engine), engine, challenge, socket);

let cached = { file: null, key: null };
/**
 * The install's root sidecar key: NEUMA_SIDECAR_KEY when the launcher pins one, else the key file in
 * the settings dir, made on first use (wx, 0600 — two first uses settle on one key). impure (fs, env)
 * @returns {string}
 */
export const sidecarKey = () => {
  if (process.env[SIDECAR_KEY_ENV]) return process.env[SIDECAR_KEY_ENV];
  const file = path.join(getSettingsDir(), 'voice-sidecar.key');
  if (cached.file === file) return cached.key;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const key = fs.readFileSync(file, 'utf8').trim();
  if (key.length < 32) throw new Error(`the voice sidecar key at ${file} is damaged — remove it and start again`);
  cached = { file, key };
  return key;
};

/** The environment one spawned sidecar gets its derived key and identity through. impure */
export const sidecarKeyEnv = (engine) => ({
  [SIDECAR_KEY_ENV]: engineKey(sidecarKey(), engine).toString('hex'),
  [SIDECAR_ENGINE_ENV]: validEngine(engine),
});

// pure — is this origin a sidecar on this machine?
const onLoopback = (origin) => {
  try { return LOOPBACK.has(new URL(origin).hostname); } catch { return false; }
};

/**
 * Does this engine answer on the expected socket with its own derived key? impure (one loopback request)
 * @param {string} origin e.g. http://127.0.0.1:7860
 * @param {string} engine registry id
 * @returns {Promise<boolean>}
 */
export const verifySidecar = async (origin, engine) => {
  const challenge = randomBytes(16).toString('hex');
  try {
    const socket = socketIdentity(origin);
    const query = new URLSearchParams({ challenge, socket });
    const r = await fetch(`${new URL(origin).origin}/identity?${query}`, { signal: AbortSignal.timeout(PROOF_TIMEOUT_MS) });
    const proof = r.ok ? String((await r.json().catch(() => ({}))).proof || '') : '';
    const want = Buffer.from(identityProof(sidecarKey(), engine, challenge, socket), 'hex');
    const got = Buffer.from(proof, 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
};

/** The refusal when a port's answerer cannot prove itself. pure */
export const unprovenSidecar = (origin) => new Error(`the voice engine at ${origin} could not prove it is this app's own `
  + '(another program may hold its port, or it was started outside the app) — nothing was sent to it');

/**
 * fetch for a sidecar: on loopback the named engine proves its socket first and the call carries its
 * engine token; elsewhere a plain fetch. impure
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {string} engine registry id, required on loopback
 * @returns {Promise<Response>}
 */
export const sidecarFetch = async (url, init = {}, engine) => {
  const { origin } = new URL(url);
  if (!onLoopback(origin)) return fetch(url, init);
  if (!(await verifySidecar(origin, engine))) throw unprovenSidecar(origin);
  return fetch(url, { ...init, headers: { ...(init.headers || {}), [SIDECAR_CALLER_HEADER]: callerToken(sidecarKey(), engine) } });
};

/**
 * The headers a socket to a sidecar opens with, once the named engine has proved its socket. impure
 * @param {string} origin
 * @param {string} engine registry id
 * @returns {Promise<Record<string, string>>}
 */
export const sidecarSocketHeaders = async (origin, engine) => {
  if (!(await verifySidecar(origin, engine))) throw unprovenSidecar(origin);
  return { [SIDECAR_CALLER_HEADER]: callerToken(sidecarKey(), engine) };
};

/**
 * A named engine's /health, only when its socket proof holds — what adoption and the idle reaper act on.
 * impure
 * @param {string} origin
 * @param {string} engine registry id
 * @returns {Promise<object|null>}
 */
export const provenHealth = async (origin, engine) => {
  if (!(await verifySidecar(origin, engine))) return null;
  try {
    const r = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(PROOF_TIMEOUT_MS) });
    return r.ok ? await r.json().catch(() => null) : null;
  } catch { return null; }
};
