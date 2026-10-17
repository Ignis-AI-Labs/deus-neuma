/** Real smart HTTP Git fixture: Git itself handles discovery and pack exchange. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fixtureGit } from './harness-git-kit.js';

/** impure - serve a dedicated bare clone; no production repo/config/credentials. */
export const createSmartGitFixture = async (source, root) => {
  const remote = path.join(root, 'smart-remote.git');
  await fixtureGit(root, ['clone', '--quiet', '--bare', source, remote]);
  const children = new Set();
  const errors = [];
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!['/smart-remote.git/info/refs', '/smart-remote.git/git-upload-pack'].includes(url.pathname)
      || !['GET', 'POST'].includes(req.method)) { res.writeHead(404).end(); return; }
    requests.push({ method: req.method, path: url.pathname });
    const child = spawn('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false', 'http-backend'], {
      cwd: root, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/bin:/bin', HOME: '/dev/null', LANG: 'C.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1',
        REQUEST_METHOD: req.method, PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: req.headers['content-type'] || '', CONTENT_LENGTH: req.headers['content-length'] || '',
        HTTP_GIT_PROTOCOL: req.headers['git-protocol'] || '', REMOTE_ADDR: '127.0.0.1',
      },
    });
    children.add(child);
    let header = Buffer.alloc(0);
    let headersSent = false;
    let stderr = '';
    const kill = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') errors.push(error); }
    };
    const failed = (error) => { errors.push(error); res.destroy(error); kill(); };
    child.on('error', failed);
    child.stdin.on('error', failed);
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(0, 2000); });
    child.stdout.on('data', (chunk) => {
      if (headersSent) { res.write(chunk); return; }
      header = Buffer.concat([header, chunk]);
      const end = header.indexOf('\r\n\r\n');
      if (end < 0) {
        if (header.length > 16384) failed(new Error('Git CGI headers exceeded fixture bound'));
        return;
      }
      let status = 200;
      for (const line of header.subarray(0, end).toString().split('\r\n')) {
        const colon = line.indexOf(':');
        const name = line.slice(0, colon);
        const value = line.slice(colon + 1).trim();
        if (name.toLowerCase() === 'status') status = Number(value.split(' ')[0]);
        else res.setHeader(name, value);
      }
      res.writeHead(status);
      headersSent = true;
      res.write(header.subarray(end + 4));
      header = Buffer.alloc(0);
    });
    child.on('close', (code) => {
      children.delete(child);
      if (code !== 0 || !headersSent) { failed(new Error(`Git CGI failed (${code}): ${stderr}`)); return; }
      res.end();
    });
    req.on('aborted', kill);
    res.on('close', () => { if (!res.writableEnded) kill(); });
    req.pipe(child.stdin);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    remote, url: `http://127.0.0.1:${server.address().port}/smart-remote.git`, requests,
    close: async () => {
      const closing = [...children].map((child) => new Promise((resolve) => {
        child.once('close', resolve);
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') errors.push(error); }
      }));
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await Promise.all(closing);
      if (errors.length) throw new AggregateError(errors, 'Smart Git fixture failed');
    },
  };
};
