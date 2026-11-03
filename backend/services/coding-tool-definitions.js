/** Shared coding schemas; both seats retain the same capabilities and policy IDs. */
const EMPTY = Object.freeze({ type: 'object', properties: Object.freeze({}), additionalProperties: false });
const COMMAND = Object.freeze({ type: 'object', properties: Object.freeze({
  command: Object.freeze({ type: 'string', description: 'shell command to run' }),
  timeoutMs: Object.freeze({ type: 'number', description: 'timeout in milliseconds, 1000-120000' }),
}), required: Object.freeze(['command']) });

export const WITNESS_CODING_TOOLS = Object.freeze([
  Object.freeze({ server: 'coding', name: 'sandbox_status', inputSchema: EMPTY,
    description: 'Show whether SANDBOX is ON or OFF and where commands run. ON reports shell generation, preserved writes and freshness; OFF reports direct execution with no overlay to recover. Status alone is not build verification.' }),
  Object.freeze({ server: 'coding', name: 'sandbox_recover', inputSchema: EMPTY,
    description: 'SANDBOX ON only: recover a blocked isolated shell after mask changes or stale upper work. Operator approval preserves the old upper for inspection/harvest, then activates a fresh generation from the live project. OFF needs no recovery because commands run directly. No arguments.' }),
  Object.freeze({ server: 'coding', name: 'ground_git', inputSchema: EMPTY,
    description: "Read the OPERATOR'S LIVE checkout branch, HEAD, upstream and dirty counts, independent of shell health. Requires approval even in AUTO unless explicitly granted for this tool. No arguments; hardened Git configuration checks apply." }),
  Object.freeze({ server: 'coding', name: 'ground_sync', inputSchema: EMPTY,
    description: "Sync the OPERATOR'S LIVE clean checkout by approved upstream fast-forward. Refuses repositories declaring scripts/sync-from-dev.mjs: use their dev-only workflow after owned work is published and merged to dev, with a clean tree/index and no pending Git operation. Approval names root, branch, full HEAD and upstream; drift or interruption refuses execution. Requires approval even in AUTO unless explicitly granted. No arguments, hooks, configured filters, SSH/helpers, commit, push, rebase or force. Supports GitHub HTTPS and numeric-loopback HTTP; private GitHub authentication stays backend-side. Failures report possible effects, never raw Git diagnostics." }),
  Object.freeze({ server: 'coding', name: 'inspect', inputSchema: COMMAND,
    description: 'Run a noninteractive command in the focused folder. SANDBOX OFF (the default): direct execution with the operator\'s normal OS user, environment, network and permissions; the command itself determines whether it writes. SANDBOX ON: read-only shell; AUTO in the open folder reads that folder, otherwise a read-only overlay. Use execute for builds that emit files. Arithmetic belongs here too: printed output is a measurement.' }),
  Object.freeze({ server: 'coding', name: 'execute', inputSchema: COMMAND,
    description: 'Run a noninteractive shell command in the focused folder. SANDBOX OFF (the default): direct execution with the operator\'s normal OS user, environment, network and permissions; writes land directly. SANDBOX ON: AUTO in the open folder writes there with .git and secrets masked; otherwise writes stay lane-side in an overlay. Approval tiers and observe mode are independent and still apply. Use for builds, installs and tests.' }),
]);

/** A refused shell keeps its diagnosis and recovery/Git capabilities, not dead executors. */
export const codingToolsForState = (sandbox, recoverable) => sandbox ? [...WITNESS_CODING_TOOLS]
  : WITNESS_CODING_TOOLS.filter(({ name }) => name === 'sandbox_status'
    || (recoverable && ['sandbox_recover', 'ground_git', 'ground_sync'].includes(name)));
