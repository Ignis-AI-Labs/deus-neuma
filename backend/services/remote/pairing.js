/**
 * pairing — how a phone becomes a paired device, and how a device is
 * recognised afterwards.
 *
 * The wallet bridge (auth.js, WEB-001) run in the other direction: a
 * signed-in desk mints a one-time PAIRING CODE bound to its wallet address;
 * a tailnet peer claims the code and receives a DEVICE SECRET in an HttpOnly
 * cookie (Road A); a native app claims the same kind of code over the
 * ephemeral pairing listener with its self-signed CERTIFICATE, and the desk
 * stores only the certificate and the hash of its public key (Road B). Both
 * roads keep only public or hashed material on disk, so the file can never
 * impersonate a phone. A cookie device is recognised by hashing what the
 * cookie carries; a native device by the SPKI hash of the key its
 * handshake presented — both compared in constant time.
 *
 * The pairing table is in-memory and TTL'd like the bridge sessions: a code
 * that is never claimed evaporates, and a claimed one is consumed whether or
 * not it was still valid — one claim, one answer.
 */
import crypto from 'node:crypto';

export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEVICE_COOKIE = 'neuma_remote';
const SWEEP_INTERVAL_MS = 60 * 1000;
const LABEL_MAX = 64;

const pairings = new Map(); // code -> { address, expiresAt }

const _sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [code, pairing] of pairings) {
    if (now > pairing.expiresAt) pairings.delete(code);
  }
}, SWEEP_INTERVAL_MS);
if (typeof _sweepTimer.unref === 'function') _sweepTimer.unref();

/**
 * Mint a one-time code for the wallet that is pairing a phone. impure (table).
 * @param {string} address
 * @param {number} [now]
 * @returns {{ code: string, expiresIn: number }}
 */
export const createPairing = (address, now = Date.now()) => {
  const code = crypto.randomBytes(24).toString('base64url');
  pairings.set(code, { address: String(address).toLowerCase(), expiresAt: now + PAIRING_TTL_MS });
  return { code, expiresIn: PAIRING_TTL_MS };
};

/**
 * Whether a code is currently claimable — the QR route refuses to draw a
 * code it does not hold. impure (table read).
 * @param {unknown} code
 * @param {number} [now]
 * @returns {boolean}
 */
export const hasPairing = (code, now = Date.now()) => {
  const pairing = pairings.get(String(code ?? ''));
  return Boolean(pairing) && now <= pairing.expiresAt;
};

/**
 * How many codes are live right now — the ephemeral pairing listener stays
 * bound only while the answer is above zero. impure (table read).
 * @param {number} [now]
 * @returns {number}
 */
export const livePairingCount = (now = Date.now()) => {
  let count = 0;
  for (const pairing of pairings.values()) {
    if (now <= pairing.expiresAt) count += 1;
  }
  return count;
};

/**
 * Consume a code. Unknown, expired, or already claimed all answer null; a
 * valid claim returns the wallet address the phone will act as. impure.
 * @param {unknown} code
 * @param {number} [now]
 * @returns {{ address: string } | null}
 */
export const claimPairing = (code, now = Date.now()) => {
  const key = String(code ?? '');
  const pairing = pairings.get(key);
  if (!pairing) return null;
  pairings.delete(key);
  return now > pairing.expiresAt ? null : { address: pairing.address };
};

/** Test helper — empty the pairing table between tests. */
export const _clearPairings = () => pairings.clear();

/**
 * @param {string} secret
 * @returns {string} hex SHA-256
 */
export const hashSecret = (secret) => crypto.createHash('sha256').update(String(secret)).digest('hex');

/**
 * A short human label for the device list, taken from the User-Agent. Pure.
 * @param {unknown} userAgent
 * @returns {string}
 */
export const deviceLabel = (userAgent) => {
  const ua = String(userAgent ?? '');
  const family = ['iPhone', 'iPad', 'Android', 'Macintosh', 'Windows', 'Linux'].find((name) => ua.includes(name));
  const browser = ['CriOS', 'Chrome', 'Safari', 'Firefox'].find((name) => ua.includes(name));
  const label = [family, browser === 'CriOS' ? 'Chrome' : browser].filter(Boolean).join(' · ');
  return (label || 'paired device').slice(0, LABEL_MAX);
};

/**
 * Mint a cookie device (Road A): the secret goes to the phone, the row goes
 * to the store. impure (randomness).
 * @param {{ address: string, label: string, now?: number }} input
 * @returns {{ secret: string, device: object }}
 */
export const mintDevice = ({ address, label, now = Date.now() }) => {
  const secret = crypto.randomBytes(32).toString('base64url');
  const stamp = new Date(now).toISOString();
  const device = Object.freeze({
    id: crypto.randomBytes(8).toString('hex'),
    hash: hashSecret(secret),
    label: String(label || 'paired device').slice(0, LABEL_MAX),
    address: String(address).toLowerCase(),
    createdAt: stamp,
    lastSeenAt: stamp,
  });
  return { secret, device };
};

/**
 * Mint a native device (Road B): the phone generated its key inside its own
 * keystore and self-signed the certificate — the desk receives PUBLIC
 * material only and signs nothing. impure (randomness).
 * @param {{ address: string, label: string, spki: string, cert: string, now?: number }} input
 * @returns {{ device: object }}
 */
export const mintNativeDevice = ({ address, label, spki, cert, now = Date.now() }) => {
  const stamp = new Date(now).toISOString();
  const device = Object.freeze({
    id: crypto.randomBytes(8).toString('hex'),
    spki: String(spki).toLowerCase(),
    cert: String(cert),
    label: String(label || 'paired device').slice(0, LABEL_MAX),
    address: String(address).toLowerCase(),
    createdAt: stamp,
    lastSeenAt: stamp,
  });
  return { device };
};

/**
 * Which credential kind a row carries. Pure.
 * @param {object} device
 * @returns {'cookie' | 'native'}
 */
export const deviceKind = (device) => (device?.spki ? 'native' : 'cookie');

const sameHex = (a, b) => {
  const left = Buffer.from(String(a), 'hex');
  const right = Buffer.from(String(b), 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

/**
 * The device a SPKI hash belongs to, if it is still within its 30 days —
 * the desk-side TTL, taken from the row's createdAt exactly as for cookies
 * (the phone certificate's own notAfter is advisory; phone clocks skew).
 * Pure.
 * @param {readonly object[]} devices
 * @param {unknown} spki hex SHA-256 of the device public key
 * @param {number} [now]
 * @returns {object | null}
 */
export const findDeviceBySpki = (devices, spki, now = Date.now()) => {
  if (typeof spki !== 'string' || spki.length === 0) return null;
  const device = devices.find((candidate) => typeof candidate.spki === 'string' && sameHex(candidate.spki, spki));
  if (!device) return null;
  return Date.parse(device.createdAt) + DEVICE_TTL_MS > now ? device : null;
};

const sameHash = (a, b) => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

/**
 * The device a secret belongs to, if it is still within its 30 days. Pure.
 * @param {readonly object[]} devices
 * @param {unknown} secret
 * @param {number} [now]
 * @returns {object | null}
 */
export const findDevice = (devices, secret, now = Date.now()) => {
  if (typeof secret !== 'string' || secret.length === 0) return null;
  const hash = hashSecret(secret);
  const device = devices.find((candidate) => sameHash(candidate.hash, hash));
  if (!device) return null;
  return Date.parse(device.createdAt) + DEVICE_TTL_MS > now ? device : null;
};

/**
 * @param {readonly object[]} devices
 * @param {string} id
 * @param {number} [now]
 * @returns {object[]}
 */
export const withDeviceSeen = (devices, id, now = Date.now()) =>
  devices.map((device) => (device.id === id
    ? Object.freeze({ ...device, lastSeenAt: new Date(now).toISOString() })
    : device));

/**
 * @param {readonly object[]} devices
 * @param {string} id
 * @returns {object[]}
 */
export const withoutDevice = (devices, id) => devices.filter((device) => device.id !== id);

/**
 * What the desk may see of a device — never the hash, never the key
 * material (both are public, but the list answers "who", not "what"). Pure.
 * @param {object} device
 * @returns {{ id: string, kind: string, label: string, createdAt: string, lastSeenAt: string }}
 */
export const publicDevice = ({ id, spki, label, createdAt, lastSeenAt }) =>
  Object.freeze({ id, kind: spki ? 'native' : 'cookie', label, createdAt, lastSeenAt });

/**
 * The Set-Cookie value that enrols a phone. Secure is mandatory: the only
 * road here is Tailscale Serve, which is HTTPS. Pure.
 * @param {string} secret
 * @returns {string}
 */
export const deviceCookie = (secret) =>
  `${DEVICE_COOKIE}=${secret}; Path=/; Max-Age=${Math.floor(DEVICE_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`;

/**
 * The value of one cookie from a Cookie header, or null. Pure.
 * @param {unknown} header
 * @param {string} name
 * @returns {string | null}
 */
export const readCookie = (header, name) => {
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
};
