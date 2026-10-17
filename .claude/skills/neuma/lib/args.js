// Pure argv parsing for the neuma CLI. No IO, no side effects.

/**
 * Parse argv (already sliced past `node cli.js`) into a normalized command.
 * Positional 0 is the neuma name; the remaining positionals join into the
 * message. `--key value` becomes a flag; a bare `--key` is boolean true.
 * @param {string[]} argv
 * @returns {{ command: string, name: string|null, message: string|null, sessionId: string|null, flags: Object }}
 */
export const parseArgs = (argv) => {
  const [command, ...rest] = Array.isArray(argv) ? argv : [];
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return {
    command: command || 'help',
    name: positional[0] || null,
    message: positional.slice(1).join(' ') || null,
    sessionId: typeof flags.session === 'string' ? flags.session : null,
    flags,
  };
};
