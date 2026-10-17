// boot-probes.js — the boot's real measurements. // impure
//
// SHINKEI: every row in the self-test measures something true. The probes
// never throw — a failed measurement is itself a truthful result (TIMEOUT /
// BLOCKED), because the boot's job is to report the world as it is.

import { getActiveCompanion } from '../../utils/companion-data.js';

export const PROBE_TIMEOUT_MS = 1500;

// impure — fetch with a hard cap; aborts read as failure, never as hang
const fetchWithTimeout = async (url, ms) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};

// impure — PLATFORM: does the local platform answer, and how fast truly? The
// public liveness route (/api/v1/health is mounted before the blanket-auth
// routers precisely so readiness checks reach it — Electron shell, Docker
// HEALTHCHECK, and now the boot).
export const probePlatform = async () => {
  const started = performance.now();
  try {
    const res = await fetchWithTimeout('/api/v1/health', PROBE_TIMEOUT_MS);
    return res.ok
      ? { ok: true, ms: Math.max(1, Math.round(performance.now() - started)) }
      : { ok: false };
  } catch {
    return { ok: false };
  }
};

// impure — MEMORY: local storage genuinely round-trips, and whether this
// machine still holds a roster cache (a returning witness) or is truly new
export const probeMemory = () => {
  try {
    const key = '__neuma_boot_probe__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return { ok: true, held: Boolean(getActiveCompanion()) };
  } catch {
    return { ok: false };
  }
};

// impure — PORTAL: a held session token means the portal can bind at once;
// without one it honestly awaits the witness's identity at the gateway
export const probePortal = () => ({ bound: Boolean(sessionStorage.getItem('authToken')) });
