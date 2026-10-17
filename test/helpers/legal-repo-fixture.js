// A real git repo on real temp disk for the legal watch's tests: files are
// written, committed with a fixed author, and the repo is read by the real
// scanners exactly as a watched production repo is. No mock stands between
// the scanner and git.
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Legal Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Legal Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

const git = (dir, args) => run('git', args, { cwd: dir, env: GIT_ENV });

/** impure — a fresh repo at `dir` (created). */
export const initRepo = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, ['init', '-q']);
  return dir;
};

/** impure — write `files` ({relPath: string|object}) and commit them under `subject`. */
export const commitFiles = async (dir, subject, files) => {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', subject]);
  const { stdout } = await git(dir, ['rev-parse', 'HEAD']);
  return stdout.trim();
};
