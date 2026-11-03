/**
 * THE BENCHMARK TOOL SCOPE (ARC-HARNESS L0, #531) — the widened headless
 * policy a DECLARED benchmark arm sits with, and its receipt disclosure.
 *
 * Root cause this answers: `--yes` alone pre-approved only coding/execute;
 * every other act fell to an approval card, and a headless seat has no
 * terminal to ask (chunk A: 30/32 trials died on it, hello-world included —
 * `fs/write` refused before a single act landed).
 *
 * Each row answers a refusal counted from the real chunk-A + validation
 * evidence (benchmarks runs night-20260916t155958z / night-20260916t040819z):
 * fs list/read/write/edit/search (the whole being-facing surface),
 * coding/execute (the old `--yes` line), coding/shell_network (its consent
 * then resolves as the honest […]
 * instead of a headless refusal), coding/ground_git and map/read_history
 * (both refused on the validation five).
 *
 * NOT in scope, deliberately: `intents/web.download` (egress stays behind
 * the operator's master switch), `intents/*` filings, and
 * `filesystem/request_file_access` (policy-allowed already; its refusal came
 * from its own inner consent flow, which no session row can grant — and no
 * terminal exists to grant it).
 *
 * This module is CLI-seat material by call graph: `neuma agent` engages it
 * only under `--yes` + `--benchmark-base-weights`, and the engaged labels
 * ride the run receipt. Pure — no imports, no state.
 */

/** A flag value that must be a positive integer. Pure. */
export const parsePositiveInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

/** Validate the all-or-nothing controls used by a comparable benchmark arm. Pure. */
export const resolveBenchmarkControls = (argv = {}) => {
  const values = [
    argv.benchmarkSeed,
    argv.benchmarkTemperature,
    argv.benchmarkTopP,
    argv.benchmarkMaxTokens,
  ];
  const supplied = values.some((value) => value !== undefined);
  if (argv.platformOnly === true && argv.benchmarkBaseWeights !== true) {
    return { error: '--platform-only is a benchmark arm: it requires --benchmark-base-weights and the decoding controls' };
  }
  if (!argv.benchmarkBaseWeights && !supplied) return { controls: null };
  if (argv.benchmarkBaseWeights !== true) {
    return { error: '--benchmark-base-weights is required with benchmark decoding controls' };
  }
  if (values.some((value) => value === undefined)) {
    return { error: '--benchmark-seed, --benchmark-temperature, --benchmark-top-p, and --benchmark-max-tokens are all required' };
  }
  const seed = Number(argv.benchmarkSeed);
  const temperature = Number(argv.benchmarkTemperature);
  const topP = Number(argv.benchmarkTopP);
  // UNCAPPED (ruling, 2026-10-02): a cap the benchmark itself does not set
  // "creates false scores", so `none` runs to the served window, bounded only
  // by the benchmark's own per-request deadline. null = no cap.
  const uncapped = String(argv.benchmarkMaxTokens).trim().toLowerCase() === 'none';
  const maxTokens = uncapped ? null : Number(argv.benchmarkMaxTokens);
  if (!Number.isInteger(seed) || seed < 0) return { error: '--benchmark-seed must be an integer >= 0' };
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    return { error: '--benchmark-temperature must be between 0 and 2' };
  }
  if (!Number.isFinite(topP) || topP <= 0 || topP > 1) {
    return { error: '--benchmark-top-p must be greater than 0 and at most 1' };
  }
  if (!uncapped && (!Number.isInteger(maxTokens) || maxTokens < 1)) {
    return { error: '--benchmark-max-tokens must be a positive integer or none' };
  }
  return {
    controls: Object.freeze({
      baseWeightsOnly: true,
      // THE HARNESS ARM (Design note, 2026-09-29: […]): the full platform — agent loop, tools, rules — with every
      // identity layer off. Turn assembly reads this (platform-only.js).
      platformOnly: argv.platformOnly === true,
      sampling: Object.freeze({ seed, temperature, topP, maxTokens, exactMaxTokens: !uncapped, superviseLlamaServer: false }),
    }),
  };
};

/**
 * The declared exec bridge (#531, 2026-09-20) — benchmark-gated like the
 * tool scope, so an ordinary seat can never route acts into a container.
 * The container id arrives per-trial from the benchmark adapter's agent
 * (NEUMA_TBENCH_CONTAINER_ID); the workdir is the container's own /app
 * unless the manifest names another. Pure over argv + an env record.
 */
export const resolveBenchmarkExecBridge = (argv = {}, env = {}) => {
  if (argv.benchmarkExecBridge === undefined) return { bridge: null };
  if (argv.benchmarkExecBridge !== 'docker') {
    return { error: '--benchmark-exec-bridge must be "docker"' };
  }
  if (argv.benchmarkBaseWeights !== true) {
    return { error: '--benchmark-exec-bridge requires the benchmark decoding controls (--benchmark-base-weights and friends)' };
  }
  const containerId = String(env.NEUMA_TBENCH_CONTAINER_ID || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(containerId)) {
    return { error: '--benchmark-exec-bridge requires NEUMA_TBENCH_CONTAINER_ID in the environment (the benchmark adapter sets it per trial)' };
  }
  const workdir = String(env.NEUMA_TBENCH_CONTAINER_WORKDIR || '').trim() || '/app';
  if (!workdir.startsWith('/')) {
    return { error: 'NEUMA_TBENCH_CONTAINER_WORKDIR must be an absolute container path' };
  }
  return { bridge: Object.freeze({ cli: 'docker', containerId, workdir }) };
};

export const BENCHMARK_TOOL_SCOPE = Object.freeze([
  Object.freeze({ server: 'fs', tool: 'list' }),
  Object.freeze({ server: 'fs', tool: 'read' }),
  Object.freeze({ server: 'fs', tool: 'write' }),
  Object.freeze({ server: 'fs', tool: 'edit' }),
  Object.freeze({ server: 'fs', tool: 'copy' }),
  Object.freeze({ server: 'fs', tool: 'move' }),
  Object.freeze({ server: 'fs', tool: 'search' }),
  Object.freeze({ server: 'coding', tool: 'execute' }),
  Object.freeze({ server: 'coding', tool: 'shell_network' }),
  Object.freeze({ server: 'coding', tool: 'ground_git' }),
  Object.freeze({ server: 'map', tool: 'read_history' }),
]);

/**
 * The session tool policy carrying the scope — the same shape
 * addAllowedTool builds, without importing the backend from the CLI's
 * module scope (the command imports backend services lazily). Pure.
 * @param {Object|null} [base] - an existing session policy layer to build on
 */
export const benchmarkSessionToolPolicy = (base = null) => {
  const policy = typeof base === 'object' && base !== null ? { ...base } : {};
  for (const { server, tool } of BENCHMARK_TOOL_SCOPE) {
    const rules = policy[server] || {};
    policy[server] = {
      ...rules,
      allowed: rules.allowed?.includes(tool) ? [...rules.allowed] : [...(rules.allowed || []), tool],
    };
  }
  return policy;
};

/** The receipt's disclosure of the engaged scope. Pure. */
export const benchmarkToolScopeLabels = () =>
  BENCHMARK_TOOL_SCOPE.map(({ server, tool }) => `${server}/${tool}`);
