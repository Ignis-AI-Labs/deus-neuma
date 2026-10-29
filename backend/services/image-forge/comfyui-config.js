/**
 * ComfyUI launch planning — the pure config/gate block extracted verbatim from
 * comfyui-supervisor.js (size-law breakdown, 2026-08-26). Resolves the lane's
 * config from env, composes the frozen §3.1 launch argv, judges any argv
 * against the safety law, and makes the two-tier reap decision. Everything
 * here is pure (RULE 0: provable by direct unit test); the exec boundary —
 * spawn/stop/probe — stays in comfyui-supervisor.js, which imports this and
 * never the reverse.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Resolve the image-forge launch config from an env bag. Pure.
 * `installDir` empty = the lane is ABSENT (fail-closed): nothing advertises,
 * Settings offers the FR-33 install flow. Port default 8190 — operators who
 * already run their own ComfyUI own 8188 (CHANGE-1 law; checkout B: 8191).
 * @param {Record<string,string|undefined>} env
 */
export const resolveComfyConfig = (env) => {
  const url = env.COMFYUI_URL || 'http://127.0.0.1:8190';
  let host = '127.0.0.1';
  let port = 8190;
  try {
    const u = new URL(url);
    host = u.hostname || host;
    port = Number(u.port) || port;
  } catch { /* malformed URL → defaults */ }
  if (host === 'localhost') host = '127.0.0.1';
  // Loopback by LAW, not just by default: a non-loopback COMFYUI_URL would
  // have the supervisor probing/freeing a remote engine while spawning a
  // local one — incoherent, and the lane's whole security posture is the
  // bind. Clamped, and the clamp is visible in the status port/host truth.
  if (!LOOPBACK_HOSTS.has(host)) host = '127.0.0.1';
  const installDir = env.COMFYUI_INSTALL_DIR || '';
  // Per-checkout by default (the engine's sqlite DB lives under the user
  // dir — two lanes sharing one would die on the lock); overridable for
  // test isolation and multi-root rigs.
  const dataRoot = env.COMFYUI_DATA_DIR || path.join(REPO_ROOT, 'data', 'comfyui');
  return Object.freeze({
    host,
    port,
    installDir,
    python: installDir ? path.join(installDir, '.venv', 'bin', 'python') : '',
    mainPy: installDir ? path.join(installDir, 'main.py') : '',
    modelsDir: env.COMFYUI_MODELS_DIR || '',
    outputDir: env.COMFYUI_OUTPUT_DIR || path.join(dataRoot, 'output'),
    tempDir: path.join(dataRoot, 'tmp'),
    // sqlite DB lives under the user dir — per-checkout by construction here,
    // which is what lets two checkouts share one install dir if they must.
    userDir: path.join(dataRoot, 'user'),
    logDir: path.join(dataRoot, 'logs'),
    extraModelPaths: env.COMFYUI_EXTRA_MODEL_PATHS || '',
    // Empty = unset: the supervisor computes the ceiling at launch from the
    // machine (forge-capacity.js), so the engine never runs unbounded. A set
    // value is the operator's explicit envelope and passes through untouched.
    headroomGb: env.COMFYUI_VRAM_HEADROOM_GB || '',
    idleTtlMs: Number(env.COMFYUI_IDLE_TTL_MS ?? 600_000),
    reapTtlMs: Number(env.COMFYUI_REAP_TTL_MS ?? 1_800_000),
  });
};

/**
 * The safety law over a ComfyUI argv — ours before spawn, a stranger's before
 * adoption. Returns named violations; empty = safe. Pure.
 *
 * @param {string[]} argv - tokens after the python binary (main.py first)
 * @param {{requireOutputDir?: string}} [expect] - adoption additionally
 *   requires the instance to write into OUR output dir, or collection breaks.
 * @returns {string[]} violations, each a sentence naming the law broken
 */
export const argvViolations = (argv, { requireOutputDir } = {}) => {
  const tokens = Array.isArray(argv) ? argv.map(String) : [];
  const violations = [];
  // argparse accepts BOTH spellings — `--flag VALUE` and `--flag=VALUE` — so
  // the law must too, or a stranger launched with `--listen=0.0.0.0` walks
  // straight through a token-exact check (echo-review finding, round 1).
  const hasFlag = (flag) => tokens.some((t) => t === flag || t.startsWith(`${flag}=`));
  const valueOf = (flag) => {
    const eq = tokens.find((t) => t.startsWith(`${flag}=`));
    if (eq !== undefined) return eq.slice(flag.length + 1);
    const i = tokens.indexOf(flag);
    if (i === -1) return undefined;
    const next = tokens[i + 1];
    return next === undefined || next.startsWith('--') ? null : next; // null = bare
  };
  if (hasFlag('--listen')) {
    const bind = valueOf('--listen');
    if (bind === null || bind === '') violations.push('bare --listen binds 0.0.0.0 — the engine has no auth; loopback is the only gate');
    else if (!LOOPBACK_HOSTS.has(bind)) violations.push(`--listen ${bind} is a non-loopback bind — the engine has no auth; loopback is the only gate`);
  }
  if (hasFlag('--whitelist-custom-nodes')) {
    violations.push('--whitelist-custom-nodes present — custom-node packs load only through the FR-35 operator-whitelist lane, never a raw flag');
  }
  if (hasFlag('--enable-cors-header')) {
    violations.push('--enable-cors-header swaps the Host/Origin CSRF guard for CORS — never passed');
  }
  if (hasFlag('--multi-user')) {
    violations.push('--multi-user is never passed — NEUMA is the sole client');
  }
  if (!hasFlag('--disable-all-custom-nodes')) {
    violations.push('--disable-all-custom-nodes missing — zero custom nodes is launch law');
  }
  if (requireOutputDir !== undefined && valueOf('--output-directory') !== requireOutputDir) {
    violations.push(`--output-directory is not ours (${requireOutputDir}) — collection would read the wrong tree`);
  }
  return violations;
};

/**
 * Build the frozen research-§3.1 launch argv from a resolved config. Pure.
 * The composed line is itself passed through argvViolations before any spawn
 * (fail-closed on our own config).
 * @param {ReturnType<typeof resolveComfyConfig>} cfg
 * @returns {string[]} args for `spawn(cfg.python, args, {cwd: cfg.installDir})`
 */
export const buildComfyArgs = (cfg) => {
  const args = [
    cfg.mainPy,
    '--port', String(cfg.port),
    // `--listen` intentionally ABSENT: the default bind is 127.0.0.1 and a
    // bare `--listen` means 0.0.0.0 (the footgun the law exists for).
    '--disable-all-custom-nodes',
    // No cloud: v0.41 retired --disable-api-nodes for --offline (no API nodes, frontend offline).
    '--offline',
    '--disable-metadata',
    '--output-directory', cfg.outputDir,
    '--temp-directory', cfg.tempDir,
    '--user-directory', cfg.userDir,
  ];
  if (cfg.modelsDir) args.push('--models-directory', cfg.modelsDir);
  if (cfg.extraModelPaths) args.push('--extra-model-paths-config', cfg.extraModelPaths);
  if (cfg.headroomGb) args.push('--vram-headroom', String(cfg.headroomGb));
  return args;
};

/**
 * The two-tier reap decision over measured inputs. Pure — the impure pass
 * probes /queue and feeds this. 'free' = tier-1 model unload (POST /free);
 * 'stop' = tier-2 full stop, OWNED only (an adopted engine is never ours to
 * stop — it gets /free forever). TTL ≤ 0 disables its tier.
 * @param {{state: string, adopted: boolean, queueBusy: boolean, now: number,
 *   readySince: number|null, lastActivityAt: number|null, lastFreeAt: number|null,
 *   idleTtlMs: number, reapTtlMs: number}} input
 * @returns {'none'|'free'|'stop'}
 */
export const decideReapAction = ({ state, adopted, queueBusy, now, readySince, lastActivityAt, lastFreeAt, idleTtlMs, reapTtlMs }) => {
  if (state !== 'ready' || queueBusy) return 'none';
  // Idle counts from the most recent life sign; readySince is the floor, so a
  // freshly launched/adopted engine always gets one full TTL of grace.
  const idleFrom = Math.max(readySince ?? 0, lastActivityAt ?? 0);
  if (idleFrom <= 0) return 'none';
  const idleMs = now - idleFrom;
  if (!adopted && reapTtlMs > 0 && idleMs >= reapTtlMs) return 'stop';
  // Free once per idle spell: a /free newer than the last activity already
  // reclaimed this idle period's VRAM.
  const alreadyFreed = lastFreeAt !== null && lastFreeAt >= idleFrom;
  if (idleTtlMs > 0 && idleMs >= idleTtlMs && !alreadyFreed) return 'free';
  return 'none';
};
