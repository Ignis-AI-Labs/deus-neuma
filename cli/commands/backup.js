// neuma backup open <backup folder> <out folder> — open the house's office records a backup carries sealed (the CRM:
// leads, their words, deals, invoices; backend/services/backup-seal.js) into a folder, on any computer whose .env holds
// the master key that sealed them (DNA_ENCRYPTION_KEY). Nothing else in the backup is touched. impure (fs, env).

import process from 'node:process';
import { resolveChainConfig } from '../lib/chain-config.js';
import { openSealedTree } from '../../backend/services/backup-seal.js';

/** The command's words for its outcome. pure. */
export const openedWords = ({ opened, failed }, out) => [
  `${opened} office record${opened === 1 ? '' : 's'} opened into ${out}`,
  ...(failed.length ? [`${failed.length} did not open (another master key, or a file moved from another backup):`, ...failed.map((f) => `  ${f}`)] : []),
].join('\n');

export const registerBackupCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'backup',
    'open what a backup carries sealed',
    (y) => y.command(
      'open <backup> <out>',
      'open the house\'s office records (sealed in the backup) into a folder',
      (yy) => yy
        .positional('backup', { describe: 'the backup folder (it holds manifest.json)', type: 'string' })
        .positional('out', { describe: 'a folder to open them into', type: 'string' }),
      async (argv) => {
        try {
          resolveChainConfig(); // the operator's .env: the master key
          const result = await openSealedTree(argv.backup, argv.out);
          stdout.write(`${openedWords(result, argv.out)}\n`);
          if (result.failed.length) process.exitCode = 1;
        } catch (err) {
          stderr.write(`neuma backup open: ${err.message}\n`);
          process.exit(1);
        }
      },
    ).demandCommand(1),
  );
