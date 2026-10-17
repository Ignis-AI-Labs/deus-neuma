// Pure presentation only: inferred categories never grant execution permissions.

const PROGRAMS = Object.freeze({
  make: 'build', cmake: 'build', webpack: 'build', tsc: 'check',
  eslint: 'check', biome: 'check', prettier: 'check',
  vitest: 'test', jest: 'test', pytest: 'test', playwright: 'test',
  git: 'git', rg: 'search', grep: 'search', find: 'search',
  cat: 'read', head: 'read', tail: 'read', less: 'read', ls: 'list',
  rm: 'delete', unlink: 'delete', mv: 'move', mkdir: 'write', touch: 'write',
});

const scriptKind = (name) => {
  if (/^(build|compile|bundle|dist)(?:$|[:.-])/.test(name)) return 'build';
  if (/^(test|e2e)(?:$|[:.-])/.test(name)) return 'test';
  if (/^(lint|typecheck|type-check|check|format)(?:$|[:.-])/.test(name)) return 'check';
  return 'execute';
};

const partKind = (part) => {
  if (!part.trim()) return null;
  const words = part.trim().split(/\s+/);
  while (/^[A-Za-z_][\w]*=/.test(words[0]) || ['env', 'npx'].includes(words[0])) words.shift();
  const program = (words.shift() || '').split('/').pop();
  if (program === 'cd') return null;
  if (program === 'node' && words.includes('--check')) return 'check';
  if (program === 'node' && words.includes('--test')) return 'test';
  if (program === 'vite') return words[0] === 'build' ? 'build' : 'execute';
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
    const verb = words[0];
    if (['install', 'ci', 'add', 'remove', 'uninstall', 'update'].includes(verb)) return 'install';
    return scriptKind(verb === 'run' ? words[1] || '' : verb || '');
  }
  if (['cargo', 'go', 'dotnet'].includes(program)) return scriptKind(words[0] || '');
  if (['pip', 'pip3'].includes(program) && words[0] === 'install') return 'install';
  if (['sed', 'perl'].includes(program) && words.some((word) => /^-[^-]*i/.test(word))) return 'edit';
  return PROGRAMS[program] || 'execute';
};

/** Recognize executable positions only; quoted text is never an action hint. */
export const executionKind = (command) => {
  if (typeof command !== 'string') return 'execute';
  // Complex substitution and heredoc programs are opaque, not guessed from prose.
  if (/<<|\$\(|`/.test(command)) return 'execute';
  const outsideQuotes = command.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, 'ARG');
  const kinds = [...new Set(outsideQuotes.split(/&&|\|\||[;|\n]/).map(partKind).filter(Boolean))];
  return kinds.length > 1 ? 'batch' : kinds[0] || 'execute';
};

/** Keep the command and its outcome in the live event and persisted summary. */
export const executionPresentation = (command, { result, error } = {}) => {
  const text = typeof command === 'string' && command.trim() ? command : '(command unavailable)';
  const activity = executionKind(command);
  const outcome = error ? 'failed' : result
    ? result.timedOut ? 'timed out' : `exit ${result.exitCode ?? 'none'}`
    : 'running';
  return {
    activity,
    summary: `${activity.toUpperCase()} · ${text} — ${outcome}`,
  };
};
