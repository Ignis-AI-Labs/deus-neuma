import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const names = (prefix) => Array.from({ length: 128 }, (_, index) =>
  `${prefix}-${String(index).padStart(3, '0')}.txt`);

/** Build two real revisions inside a disposable Explorer root. */
// impure — invokes Git and writes files only under the caller's temporary root.
export const createExplorerCheckout = async (root) => {
  const git = async (...args) => (await exec('git', [
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Explorer regression', '-c', 'user.email=explorer@example.invalid',
    ...args,
  ], { cwd: root })).stdout.trim();
  const before = names('before');
  const after = names('after');
  await git('init');
  for (const name of before) await fs.writeFile(path.join(root, name), name);
  await git('add', '.');
  await git('commit', '-m', 'Initial Explorer fixture');
  const first = await git('rev-parse', 'HEAD');
  for (const name of before) await fs.unlink(path.join(root, name));
  for (const name of after) await fs.writeFile(path.join(root, name), name);
  await git('add', '-A');
  await git('commit', '-m', 'Replace 128 Explorer entries');
  const second = await git('rev-parse', 'HEAD');
  await git('checkout', '--detach', first);
  return { before, after, first, second, checkout: (revision) => git('checkout', '--detach', revision) };
};
