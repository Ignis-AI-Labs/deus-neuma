/** Shared coding schemas; both seats retain the same capabilities and policy IDs. */
const EMPTY = Object.freeze({ type: 'object', properties: Object.freeze({}), additionalProperties: false });
const COMMAND = Object.freeze({ type: 'object', properties: Object.freeze({
  command: Object.freeze({ type: 'string', description: 'shell command to run' }),
  timeoutMs: Object.freeze({ type: 'number', description: 'timeout in milliseconds, 1000-120000' }),
}), required: Object.freeze(['command']) });

export const WITNESS_CODING_TOOLS = Object.freeze([
  Object.freeze({ server: 'coding', name: 'sandbox_status', inputSchema: EMPTY,
    description: 'Refresh and show the active shell generation, preserved writes and freshness state. If blocked, use coding/sandbox_recover; status alone is not build verification.' }),
  Object.freeze({ server: 'coding', name: 'sandbox_recover', inputSchema: EMPTY,
    description: 'Recover or reconcile a blocked coding shell after mask changes or stale upper work. Operator approval preserves the old upper at its existing path for later inspection/harvest, then activates a fresh generation from the live project with current secret masks. No project or Git files are changed; no old work is deleted or automatically copied into the project. Available even when inspect/execute are unavailable. No arguments.' }),
  Object.freeze({ server: 'coding', name: 'ground_git', inputSchema: EMPTY,
    description: "Read the OPERATOR'S LIVE checkout branch, HEAD, upstream and dirty counts, independent of shell health. Requires approval even in AUTO unless explicitly granted for this tool. No arguments; hardened Git configuration checks apply." }),
  Object.freeze({ server: 'coding', name: 'ground_sync', inputSchema: EMPTY,
    description: "Sync the OPERATOR'S LIVE clean checkout by approved upstream fast-forward. Refuses repositories declaring scripts/sync-from-dev.mjs: use their dev-only workflow after owned work is published and merged to dev, with a clean tree/index and no pending Git operation. Approval names root, branch, full HEAD and upstream; drift or interruption refuses execution. Requires approval even in AUTO unless explicitly granted. No arguments, hooks, configured filters, SSH/helpers, commit, push, rebase or force. Supports GitHub HTTPS and numeric-loopback HTTP; private GitHub authentication stays backend-side. Failures report possible effects, never raw Git diagnostics." }),
  Object.freeze({ server: 'coding', name: 'inspect', inputSchema: COMMAND,
    description: 'Run a noninteractive command in a READ-ONLY overlay of the focused folder. Prior shell writes show on top; lower drift beneath them refuses execution. Always offline, empty HOME, bounded output and timeout. Use for non-writing checks; use execute for builds that emit dist or other files. Arithmetic and other precise computation belong here too: a script\'s printed result is a measurement — mental math in speech is a claim.' }),
  Object.freeze({ server: 'coding', name: 'execute', inputSchema: COMMAND,
    description: 'Run a noninteractive shell command in the focused folder overlay; writes stay lane-side, never on the live folder. Lower drift under prior writes refuses execution: use sandbox_recover to preserve old work and start fresh. Witness shells stay offline; the neuma seat can separately request a lane-bound network grant. Use for builds, installs and tests that write files. Local neuma execution is allowed by default; witnesses require approval. Explicit denial and observe mode still hold execution.' }),
]);

/** A refused shell keeps its diagnosis and recovery/Git capabilities, not dead executors. */
export const codingToolsForState = (sandbox, recoverable) => sandbox ? [...WITNESS_CODING_TOOLS]
  : WITNESS_CODING_TOOLS.filter(({ name }) => name === 'sandbox_status'
    || (recoverable && ['sandbox_recover', 'ground_git', 'ground_sync'].includes(name)));
