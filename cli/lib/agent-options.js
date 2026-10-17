// agent-options — the `neuma agent` flag surface, moved out of the command
// so the command file stays under the size law. Every flag's meaning lives in
// its describe line; the command reads them off argv unchanged.

/**
 * Declare the agent command's positional and options on a yargs builder.
 * @param {object} y the yargs builder
 * @param {{defaultTimeoutS: number}} defaults
 * @returns {object} the same builder
 */
export const withAgentOptions = (y, { defaultTimeoutS }) => y
      .positional('task', {
    describe: 'the work to take up, in the operator\'s own words (omit with --transcript)',
    type: 'string',
  })
  .option('workspace', {
    describe: 'neuma lane id or chosen name (default: the only local neuma)',
    type: 'string',
  })
  .option('ground', {
    describe: 'isolated task directory (default: current directory)',
    type: 'string',
  })
  .option('rounds', {
    describe: 'optional provider/tool round ceiling (default: the house policy; normally unlimited)',
    type: 'number',
  })
  .option('timeout', {
    describe: `wall-clock budget in seconds (default ${defaultTimeoutS})`,
    type: 'number',
  })
  .option('yes', {
    describe: 'pre-approve sandboxed coding/execute for this run only',
    type: 'boolean',
    default: false,
  })
  .option('benchmark-base-weights', {
    describe: 'benchmark only: neutralize every loaded refinement adapter',
    type: 'boolean',
    default: false,
  })
  .option('benchmark-seed', {
    describe: 'benchmark only: exact inference seed',
    type: 'number',
  })
  .option('benchmark-temperature', {
    describe: 'benchmark only: exact inference temperature',
    type: 'number',
  })
  .option('benchmark-top-p', {
    describe: 'benchmark only: exact nucleus-sampling threshold',
    type: 'number',
  })
  .option('benchmark-max-tokens', {
    // A string so `none` survives parsing (a number type reads it as NaN);
    // benchmark-scope.js validates both forms.
    describe: 'benchmark only: exact total output-token ceiling, or none (uncapped: the served window)',
    type: 'string',
  })
  .option('benchmark-format-echo', {
    describe: 'benchmark only: carry the declared task-format echo before the final question',
    type: 'boolean',
    default: false,
  })
  .option('supervisor', {
    describe: 'declare the turn supervisor (ARC-HARNESS L1): stagnation redirects during the turn',
    type: 'boolean',
    default: false,
  })
  .option('verify-answer', {
    describe: 'declare the answer verify gate (ARC-HARNESS L2): re-read the task against the draft at settle',
    type: 'boolean',
    default: false,
  })
  .option('budget', {
    describe: 'declare the sitting\'s completion allowance in tokens — an exact shared cap (thought + speech) for the whole turn',
    type: 'number',
  })
  .option('network', {
    describe: 'benchmark only: declare host network for the sitting\'s shell — the shell_network consent, session-lived, never persisted',
    type: 'boolean',
    default: false,
  })
  .option('benchmark-exec-bridge', {
    describe: 'benchmark only: route coding/execute into the declared task container and mirror ground writes to it (#531)',
    type: 'string',
    choices: ['docker'],
  })
  .option('candidates', {
    describe: 'benchmark only: K scored final-answer candidates at settle, argmax by total likelihood — the PoE pass (#533)',
    type: 'number',
  })
  .option('receipt', {
    describe: 'write a machine-readable run receipt (automation)',
    type: 'string',
  })
  .option('platform-only', {
    describe: 'benchmark only: the platform with NO identity — the full agent loop, tools and platform rules, every identity layer off (the HARNESS arm)',
    type: 'boolean',
    default: false,
  })
  .option('closed-book', {
    describe: 'benchmark only: a closed-book sitting. Only local tools are open, the shell runs offline, and no intent settles (a memory test, never a lookup)',
    type: 'boolean',
    default: false,
  })
  .option('caller-tools', {
    describe: 'a JSON file of the sender\'s own OpenAI function tools: the being may call them, and each call is handed back in the receipt, never run here',
    type: 'string',
  })
  .option('caller-parallel', {
    describe: 'benchmark only, with --caller-tools: the sender lets one reply carry several tool calls (its parallel_tool_calls), so the being may too',
    type: 'boolean',
    default: false,
  })
  .option('transcript', {
    describe: 'a JSON file of the sender\'s chat messages (with their tool calls and results), seated in place of <task>',
    type: 'string',
  });
