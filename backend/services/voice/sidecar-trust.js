// sidecar-trust — the voice sidecars and the backend know each other by one install key
// (re-audit 2026-10-29, M-06; first raised 2026-10-28).
//
// The sidecars bind loopback, and loopback is shared by every program on the machine. A program
// that answered /health on a sidecar's port used to be adopted as that sidecar and was then handed
// the voice clip and the transcription audio; its own idle_seconds kept it from ever being reaped.
// Now:
//   * the install keeps one random key in its settings dir (walled from every being, 0600) and
//     hands it to each sidecar it spawns, in the sidecar's environment and nowhere else;
//   * before the backend sends a sidecar ANYTHING but a /health poll, the sidecar proves it holds
//     the key — an HMAC over a fresh random challenge — so an impostor learns nothing and gets
//     nothing; the key itself never crosses the wire;
//   * the backend's own calls carry a token derived from the key, and the sidecar refuses every
//     call without it (voice-engines/_shared/browser_guard.py), so no other local program can
//     use the sidecars either.
// Loopback only: an endpoint the operator points at another machine is theirs to trust, and never
// receives the token.

import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSettingsDir } from '../data-root.js';

export const SIDECAR_KEY_ENV = 'NEUMA_SIDECAR_KEY';
export const SIDECAR_CALLER_HEADER = 'x-neuma-sidecar';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const PROOF_TIMEOUT_MS = 2000;

/** pure — the token the backend's calls carry. */
export const callerToken = (key) => createHmac('sha256', key).update('neuma-sidecar-caller-v1').digest('hex');

/** pure — what a sidecar holding the key answers to a challenge. */
export const identityProof = (key, challenge) => createHmac('sha256', key)
  .update(`neuma-sidecar-identity-v1\n${challenge}`).digest('hex');

let cached = { file: null, key: null };
/**
 * The install's sidecar key: NEUMA_SIDECAR_KEY when the launcher pins one, else the key file in the
 * settings dir, made on first use (wx, 0600 — two first uses settle on one key). impure (fs, env)
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

/** The environment a spawned sidecar gets the key through. impure */
export const sidecarKeyEnv = () => ({ [SIDECAR_KEY_ENV]: sidecarKey() });

// pure — is this origin a sidecar on this machine?
const onLoopback = (origin) => {
  try { return LOOPBACK.has(new URL(origin).hostname); } catch { return false; }
};

/**
 * Does the program answering at this origin hold the install key? impure (one loopback request)
 * @param {string} origin e.g. http://127.0.0.1:7860
 * @returns {Promise<boolean>}
 */
export const verifySidecar = async (origin) => {
  const challenge = randomBytes(16).toString('hex');
  try {
    const r = await fetch(`${new URL(origin).origin}/identity?challenge=${challenge}`, { signal: AbortSignal.timeout(PROOF_TIMEOUT_MS) });
    const proof = r.ok ? String((await r.json().catch(() => ({}))).proof || '') : '';
    const want = Buffer.from(identityProof(sidecarKey(), challenge), 'hex');
    const got = Buffer.from(proof, 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
};

/** The refusal when a port's answerer cannot prove itself. pure */
export const unprovenSidecar = (origin) => new Error(`the voice engine at ${origin} could not prove it is this app's own `
  + '(another program may hold its port, or it was started outside the app) — nothing was sent to it');

/**
 * fetch for a sidecar: on loopback the answerer proves itself first and the call carries the
 * backend's token; elsewhere a plain fetch. impure
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export const sidecarFetch = async (url, init = {}) => {
  const { origin } = new URL(url);
  if (!onLoopback(origin)) return fetch(url, init);
  if (!(await verifySidecar(origin))) throw unprovenSidecar(origin);
  return fetch(url, { ...init, headers: { ...(init.headers || {}), [SIDECAR_CALLER_HEADER]: callerToken(sidecarKey()) } });
};

/**
 * The headers a socket to a sidecar opens with, once the answerer has proved itself. impure
 * @param {string} origin
 * @returns {Promise<Record<string, string>>}
 */
export const sidecarSocketHeaders = async (origin) => {
  if (!(await verifySidecar(origin))) throw unprovenSidecar(origin);
  return { [SIDECAR_CALLER_HEADER]: callerToken(sidecarKey()) };
};

/**
 * A sidecar's /health, only when it proves itself — what the adoption and the idle reaper act on.
 * impure
 * @param {string} origin
 * @returns {Promise<object|null>}
 */
export const provenHealth = async (origin) => {
  if (!(await verifySidecar(origin))) return null;
  try {
    const r = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(PROOF_TIMEOUT_MS) });
    return r.ok ? await r.json().catch(() => null) : null;
  } catch { return null; }
};
