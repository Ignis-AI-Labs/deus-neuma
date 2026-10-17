/**
 * provider-discovery.js — find every local LLM server, whatever port it's on.
 *
 * A tester's report (Bastien, 2026-08-08): a running llama.cpp server was not
 * detected until they found the port Neuma had hard-coded, and once it was
 * seen, Neuma still defaulted to that port, so the first pass failed until
 * they picked the ollama button by hand. The probe knew two
 * addresses (ollama :11434, LM Studio :1234) and nothing else existed. A
 * llama.cpp on :8080 was invisible; a nontechnical operator saw […] while their server sat there answering.
 *
 * So: ask the OS what is actually listening, then ask each listener what it
 * is. No hard-coded port is load-bearing anymore — the well-known ports are
 * merely also-probed fallbacks for OSes where the listener read fails.
 *
 *   1. listeningPorts() — the machine's real loopback listeners
 *      (linux: /proc/net/tcp{,6}; darwin/win32: netstat -an; both capped)
 *   2. identifyEndpoint() — provider signatures, in order of specificity:
 *        /api/tags        answers with models     → ollama
 *        /api/v1/models   LM Studio's own list    → lm-studio (it answers /props too)
 *        /props           answers                 → llama-server
 *        /v1/models       answers with data array → lm-studio (openai-compat)
 *   3. discoverProviders() — sweep + identify, parallel, short timeouts.
 *
 * Every probe is a localhost GET with a hard timeout; a port that isn't an
 * LLM server answers nothing recognizable and is skipped. Discovery never
 * throws — a machine we cannot enumerate degrades to the fallback ports.
 */
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from './logger.js';
import { lmStudioCatalog } from './local-server-models.js';

const execFileP = promisify(execFile);
const log = createLogger('ProviderDiscovery');

const PROBE_TIMEOUT_MS = 900;
// Ports below 1024 are system services, never a local LLM server.
const MIN_PORT = 1024;
// A dev box can listen on a lot; cap the sweep so preflight stays fast.
const MAX_PORTS_PROBED = 128;
const PROBE_BATCH = 16;

/** The historical well-known ports — fallbacks, not the source of truth. */
export const FALLBACK_PORTS = Object.freeze([11434, 1234, 8080, 8089]);

// impure — the explicit sweep pin (ops + tests): NEUMA_DISCOVERY_PORTS
// ="8080,5000" makes discovery probe exactly these ports and NOTHING else
// (no fallback append — a pin that leaks other ports is not a pin). A port
// must be a real TCP port; "999999x" is neither.
const discoveryPortsOverride = () => String(process.env.NEUMA_DISCOVERY_PORTS || '')
  .split(',')
  .map((p) => (/^\d+$/.test(p.trim()) ? parseInt(p.trim(), 10) : NaN))
  .filter((p) => Number.isFinite(p) && p >= 1 && p <= 65535)
  .slice(0, MAX_PORTS_PROBED);

// pure — parse /proc/net/tcp lines: local_address is HEX ip:port, st 0A = LISTEN.
export const parseProcNetTcp = (text) => {
  const ports = new Set();
  for (const line of String(text || '').split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const [, local, , st] = cols;
    if (st !== '0A') continue;
    const hexPort = local?.split(':').pop();
    const port = parseInt(hexPort, 16);
    if (Number.isFinite(port) && port >= MIN_PORT) ports.add(port);
  }
  return [...ports];
};

// pure — parse `netstat -an` output for LISTEN(ING) lines on any interface.
export const parseNetstat = (text) => {
  const ports = new Set();
  for (const line of String(text || '').split('\n')) {
    if (!/LISTEN/i.test(line)) continue;
    // The local address column: 0.0.0.0:11434, 127.0.0.1.1234 (macOS dots),
    // [::]:8080 — the port is the final number after the last : or .
    const m = line.match(/[\d.:*\][]+[.:](\d+)\s/);
    const port = m ? parseInt(m[1], 10) : NaN;
    if (Number.isFinite(port) && port >= MIN_PORT) ports.add(port);
  }
  return [...ports];
};

/**
 * The machine's actual listening TCP ports (loopback-reachable). impure.
 * Falls back to the well-known ports when the OS read fails — discovery
 * must never be worse than the old hard-coded probe.
 * @returns {Promise<number[]>}
 */
export const listeningPorts = async () => {
  // Explicit override (ops + tests): NEUMA_DISCOVERY_PORTS="8080,5000"
  // constrains the sweep to exactly these ports — for machines where the
  // listener read is noisy, or where discovery must be pinned.
  const override = discoveryPortsOverride();
  if (override.length > 0) return override;
  try {
    if (process.platform === 'linux') {
      const [v4, v6] = await Promise.all([
        fs.readFile('/proc/net/tcp', 'utf8').catch(() => ''),
        fs.readFile('/proc/net/tcp6', 'utf8').catch(() => ''),
      ]);
      const ports = [...new Set([...parseProcNetTcp(v4), ...parseProcNetTcp(v6)])];
      if (ports.length > 0) return ports.slice(0, MAX_PORTS_PROBED);
    } else {
      const { stdout } = await execFileP('netstat', ['-an'], { timeout: 5000 });
      const ports = parseNetstat(stdout);
      if (ports.length > 0) return ports.slice(0, MAX_PORTS_PROBED);
    }
  } catch (err) {
    log.warn('Listener enumeration failed — falling back to well-known ports', { error: err.message });
  }
  return [...FALLBACK_PORTS];
};

// impure — one signature GET; null unless it answers 200 with parseable JSON.
const probeJson = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

/**
 * What is serving at this endpoint? impure.
 * @param {string} base - e.g. http://127.0.0.1:8080
 * @returns {Promise<{provider: 'ollama'|'llama-server'|'lm-studio', endpoint: string, models: string[]}|null>}
 */
export const identifyEndpoint = async (base) => {
  const clean = String(base).replace(/\/+$/, '');
  // Ollama first — its /api/tags is unambiguous.
  const tags = await probeJson(`${clean}/api/tags`);
  if (Array.isArray(tags?.models)) {
    return { provider: 'ollama', endpoint: clean, models: tags.models.map((m) => m.name).filter(Boolean) };
  }
  // OpenAI-compatible surface — then split llama.cpp from the generic shape
  // by its /props endpoint (LM Studio and friends don't serve it).
  const v1 = await probeJson(`${clean}/v1/models`);
  if (Array.isArray(v1?.data)) {
    const models = v1.data.map((m) => m.id).filter(Boolean);
    // LM Studio answers /props too (it runs llama.cpp inside — seen live
    // 2026-10-14, :1234 read as llama-server), so its own REST list is asked
    // FIRST. `models` stays what is LOADED (the flight check adopts from it);
    // `available` is every model the server can serve (local-server-models.js).
    const catalog = await lmStudioCatalog(clean);
    if (catalog) return { provider: 'lm-studio', endpoint: clean, models, available: catalog.map((m) => m.id) };
    const props = await probeJson(`${clean}/props`);
    return { provider: props ? 'llama-server' : 'lm-studio', endpoint: clean, models };
  }
  return null;
};

/**
 * Sweep the machine: every listener identified, well-known ports included
 * even when enumeration worked (a firewalled /proc read can miss). impure.
 * @returns {Promise<Array<{provider: string, endpoint: string, models: string[]}>>}
 */
export const discoverProviders = async () => {
  const pinned = discoveryPortsOverride();
  const ports = pinned.length > 0
    ? pinned
    : [...new Set([...(await listeningPorts()), ...FALLBACK_PORTS])]
      .slice(0, MAX_PORTS_PROBED + FALLBACK_PORTS.length);
  const found = [];
  for (let i = 0; i < ports.length; i += PROBE_BATCH) {
    const batch = ports.slice(i, i + PROBE_BATCH);
    const results = await Promise.all(
      batch.map((port) => identifyEndpoint(`http://127.0.0.1:${port}`)),
    );
    found.push(...results.filter(Boolean));
  }
  // One entry per endpoint; prefer entries that actually hold models.
  const seen = new Map();
  for (const f of found) {
    const prev = seen.get(f.endpoint);
    if (!prev || (prev.models.length === 0 && f.models.length > 0)) seen.set(f.endpoint, f);
  }
  const list = [...seen.values()];
  if (list.length > 0) {
    log.info('Local LLM servers discovered', {
      found: list.map((f) => `${f.provider}@${f.endpoint}(${f.models.length})`),
    });
  }
  return list;
};

/**
 * Should the platform adopt a discovered server as the mind, unasked? Pure.
 *
 * Adopt ONLY when silence is being filled, never when a person is being
 * overridden: no prior operator choice (a previous auto-adopt may be
 * re-decided), and exactly ONE running endpoint holding models — ambiguity
 * belongs to the operator, one-click chips and all.
 *
 * @param {Array<{id?: string, provider?: string, endpoint: string, models: string[]}>} found
 * @param {{chosenBy: string}|null} prior - the persisted choice, if any
 * @returns {object|null} the entry to adopt, or null
 */
export const pickAutoAdopt = (found, prior) => {
  if (prior && prior.chosenBy !== 'auto') return null;
  const withModels = dedupeEndpoints((found || []).filter((f) => (f.models || []).length > 0));
  return withModels.length === 1 ? withModels[0] : null;
};

/** localhost and 127.0.0.1 are the same server. Pure. */
export const sameEndpoint = (a, b) => {
  const fold = (e) => String(e || '').replace(/\/+$/, '').replace('//localhost', '//127.0.0.1');
  return fold(a) === fold(b);
};

/**
 * One entry per SERVER. Pure. The fixed probes report localhost:11434 while
 * the sweep reports 127.0.0.1:11434 — a strict string dedup keeps both, the
 * operator sees two chips for one server, and pickAutoAdopt reads the
 * duplicate as AMBIGUITY and refuses to adopt in the single most common
 * scenario the feature exists for (sc-echo R3). First entry wins.
 * @param {Array<{endpoint: string}>} list
 */
export const dedupeEndpoints = (list) => (list || [])
  .filter((p, i, all) => all.findIndex((q) => sameEndpoint(q.endpoint, p.endpoint)) === i);
