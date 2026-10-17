/** Real disposable Git repositories served by a real dumb-HTTP Git remote. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ENV = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/dev/null', LANG: 'C.UTF-8',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' });

/** impure - fixture setup only; no host config/templates/hooks or live repository. */
export const fixtureGit = async (cwd, args) => (await exec('/usr/bin/git', [
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
  '-c', 'core.attributesFile=/dev/null', '-c', 'core.excludesFile=/dev/null',
  '-c', 'init.templateDir=', '-c', 'protocol.file.allow=always',
  '-c', 'user.name=Harness Git Fixture', '-c', 'user.email=fixture@localhost',
  ...args,
], { cwd, env: ENV, timeout: 10000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();

/** impure - commit and publish only fixture-owned bytes. */
export const commitFixture = async (cwd, name, text) => {
  await fs.writeFile(path.join(cwd, name), text);
  await fixtureGit(cwd, ['add', '--', name]);
  await fixtureGit(cwd, ['commit', '--quiet', '-m', `fixture ${name}`]);
  await fixtureGit(cwd, ['update-server-info']);
  return fixtureGit(cwd, ['rev-parse', 'HEAD']);
};

/** impure - HTTP speaks Git's actual static object transport, not a stub. */
export const createHarnessGitKit = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-harness-git-'));
  const origin = path.join(root, 'origin');
  const ground = path.join(root, 'ground');
  await fs.mkdir(origin);
  await fixtureGit(origin, ['init', '--quiet', '--initial-branch=main']);
  await commitFixture(origin, 'base.txt', 'base\n');
  await fixtureGit(root, ['clone', '--quiet', origin, ground]);
  let hold = false;
  let failureBody = null;
  const requests = [];
  const held = new Set();
  const server = createServer(async (req, res) => {
    requests.push(req.url);
    if (failureBody !== null) {
      res.writeHead(401, { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Basic realm="git-fixture"' }).end(failureBody);
      return;
    }
    if (hold && (hold === true || req.url.startsWith('/objects/'))) {
      held.add(res);
      res.once('close', () => held.delete(res));
      return;
    }
    try {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      const file = path.resolve(origin, '.git', `.${decodeURIComponent(pathname)}`);
      if (!file.startsWith(`${path.join(origin, '.git')}/`)) { res.writeHead(403).end(); return; }
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/repo.git`;
  // The served prefix maps to the real repository's object store.
  server.prependListener('request', (req) => { req.url = req.url.replace(/^\/repo\.git/, ''); });
  await fixtureGit(ground, ['remote', 'set-url', 'origin', url]);
  return { root, origin, ground, url, requests,
    hold: (objectsOnly = false) => { hold = objectsOnly ? 'objects' : true; },
    fail: (body) => { failureBody = body; },
    held,
    close: async () => {
      for (const response of held) response.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    } };
};
