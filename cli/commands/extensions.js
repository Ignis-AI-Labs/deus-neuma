// `neuma extensions` — the house's third-party MCP servers, from the terminal:
//
//   neuma extensions                       the catalog: what each one is, reaches, needs; what is installed
//   neuma extensions add <id>              install the pinned version (scripts off), check it, read its tools
//   neuma extensions key <id> <NAME>       give it a key it names (read from your input, never an argument)
//   neuma extensions check <id>            check it again now
//   neuma extensions on|off <id>           switch it on or off
//   neuma extensions remove <id>           take it off this computer, keys included
//
// Every extension is someone else's code running here. It is checked against
// the OSV vulnerability database before it can run and again every day; the
// check needs the Security watch's online check on.
//
// impure (npm, OSV, the extension store, child processes).

import { readOneLine } from '../lib/read-one-line.js';

const shelfLine = (e) => {
  const state = e.held ? `held back — ${e.held}`
    : !e.installed ? 'not installed'
    : e.blocked ? `BLOCKED — ${e.blockedWhy}`
      : !e.enabled ? 'installed, off'
        : e.runnable ? `ready, ${e.tools.length} tool(s)` : `installed — ${e.toolsWhy || 'not ready'}`;
  const keys = e.keys.length ? `  keys: ${e.keys.map((k) => `${k.name}${k.required ? '' : '?'}${k.set ? ' ✓' : ''}`).join(', ')}` : '';
  return `${e.id.padEnd(20)} ${e.name} (${e.publisher}) — ${e.does}\n${' '.repeat(21)}${e.package} · reaches ${e.reaches} · ${state}${keys}`;
};

const checkLine = (check) => (check
  ? `checked ${check.checked} package(s) at ${check.at}: ${check.verdict}${check.findings?.length ? ` — ${check.findings.length} finding(s): ${check.findings.map((f) => `${f.id} (${f.severity})`).join(', ')}` : ', no known flaws'}`
  : 'not checked');

/** Run one `neuma extensions` action. Returns the exit code. impure. */
export const runExtensions = async ({ stdin = process.stdin, stdout, stderr, argv }) => {
  const fail = (message) => { stderr.write(`neuma extensions: ${message}\n`); return 1; };
  const manage = await import('../../backend/services/extensions/extension-manage.js');
  const [action = 'list', id, name] = (argv.args || []).map(String);
  try {
    if (action === 'list') {
      const shelf = await manage.extensionShelf();
      stdout.write(`${shelf.note}\n\n${shelf.extensions.map(shelfLine).join('\n')}\n`);
      return 0;
    }
    if (!id) return fail(`usage: neuma extensions ${action} <id>`);
    if (action === 'add') {
      stderr.write(`installing ${id} with install scripts off, then checking every package in it…\n`);
      const record = await manage.addExtension(id);
      stdout.write(`${id} added — ${checkLine(record.check)}\n${record.tools?.length ? `  tools: ${record.tools.map((t) => t.name).join(', ')}\n` : `  ${record.toolsWhy ?? ''}\n`}`);
      return 0;
    }
    if (action === 'key') {
      if (!name) return fail('usage: neuma extensions key <id> <NAME>   (then paste the value and press Enter)');
      if (stdin.isTTY) stderr.write(`paste ${name} for ${id}, then Enter (empty clears it): `);
      const keys = await manage.giveExtensionKey(id, name, await readOneLine(stdin));
      stdout.write(`${id} keys: ${keys.map((k) => `${k.name} ${k.set ? 'set' : 'not set'}`).join(', ')}\n`);
      return 0;
    }
    if (action === 'check') {
      const record = await manage.checkExtension(id);
      stdout.write(`${id}: ${checkLine(record.check)}${record.blocked ? `\n  BLOCKED — ${record.blockedWhy}` : ''}\n`);
      return record.blocked ? 1 : 0;
    }
    if (action === 'on' || action === 'off') {
      await manage.switchExtension(id, action === 'on');
      stdout.write(`${id} is ${action}\n`);
      return 0;
    }
    if (action === 'remove') {
      stdout.write((await manage.dropExtension(id)) ? `${id} removed, keys included\n` : `${id} was not installed\n`);
      return 0;
    }
    return fail(`unknown action ${action} — list, add, key, check, on, off, remove`);
  } catch (error) {
    return fail(error.message);
  }
};

export const registerExtensionsCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'extensions [args..]',
    'third-party MCP extensions, checked before they run: list · add <id> · key <id> <NAME> · check <id> · on|off <id> · remove <id>',
    (y) => y.positional('args', { type: 'string', array: true }),
    async (argv) => {
      const code = await runExtensions({ stdout, stderr, argv });
      if (code !== 0) process.exitCode = code;
    },
  );
