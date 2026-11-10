// Backend takeover — an update replaces the whole installation, backend included.
//
// After an update the new version starts at once, and the backend of the version it replaced
// can still be running: its desk quit without waiting for it, and on Linux it only notices
// every 4 s that its desk is gone (backend/services/desk-parent-watch.js). Its files may already
// be gone from under it (the AppImage it ran from was replaced), so it can answer the health
// check badly or not at all. Before this module the new version then either refused to start
// ([…]) or took the old backend for somebody else's
// service and moved to another port, leaving two backends over one data root — and a person
// who updated could not find their own wallet (2026-11-10).
//
// So a leftover is recognised by WHAT IT IS, not by how it answers: a NEUMA backend process
// (resources/app/backend/server.js) run by this same user whose desk is gone. That one is
// stopped and its port waited out. A backend whose desk is still alive (another desk of the
// person's, a dev desk) is never touched. Linux and Windows; elsewhere nothing is found and the
// caller keeps its honest dialog.  // impure (proc fs, child processes, signals)

const fs = require('node:fs');
const { execFile } = require('node:child_process');

const SERVER_MARK = /(^|[\\/])backend[\\/]server\.js$/;

/** Is this argv a NEUMA backend? Pure. */
const isBackendArgv = (argv) => argv.some((a) => SERVER_MARK.test(a));

/**
 * The inodes listening on a port in /proc/net/tcp(6) text. Pure.
 * @param {string} table - the file's text
 * @param {number} port
 * @returns {string[]} socket inodes
 */
const listeningInodes = (table, port) => table.split('\n').slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter((f) => f.length > 9 && f[3] === '0A' && parseInt(f[1].split(':').pop(), 16) === port)
  .map((f) => f[9]);

/**
 * The pid listening on a port in `netstat -ano -p TCP` text (Windows). Pure.
 * @returns {number|null}
 */
const netstatListener = (text, port) => {
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f[0] === 'TCP' && f[3] === 'LISTENING' && Number(f[1].split(':').pop()) === port) return Number(f[4]);
  }
  return null;
};

const run = (file, args) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout: 10000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
});

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

/** impure — the pid listening on the port (only processes this user may read on Linux). */
const findListener = async (port) => {
  if (process.platform === 'win32') return netstatListener(await run('netstat', ['-ano', '-p', 'TCP']), port);
  if (process.platform !== 'linux') return null;
  const inodes = new Set([...listeningInodes(readText('/proc/net/tcp'), port), ...listeningInodes(readText('/proc/net/tcp6'), port)]);
  if (!inodes.size) return null;
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; } // not ours to read
    for (const fd of fds) {
      let link = '';
      try { link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      const m = /^socket:\[(\d+)\]$/.exec(link);
      if (m && inodes.has(m[1])) return Number(pid);
    }
  }
  return null;
};

/** impure — is a pid alive? */
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
};

/**
 * impure — what is this process? {backend, deskPid} for a NEUMA backend of this user, else null.
 * The desk pid is the one the desk stamped at spawn (NEUMA_DESK_PID) — or, on Windows, its parent.
 */
const describe = async (pid) => {
  if (process.platform === 'linux') {
    if (fs.statSync(`/proc/${pid}`, { throwIfNoEntry: false })?.uid !== process.getuid()) return null;
    const argv = readText(`/proc/${pid}/cmdline`).split('\0').filter(Boolean);
    if (!isBackendArgv(argv)) return null;
    const env = readText(`/proc/${pid}/environ`).split('\0');
    const desk = env.find((e) => e.startsWith('NEUMA_DESK_PID='));
    return { deskPid: desk ? Number(desk.slice('NEUMA_DESK_PID='.length)) : null };
  }
  if (process.platform === 'win32') {
    const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { "$($p.ParentProcessId)"; $p.CommandLine }`]);
    const [parent, ...rest] = out.split(/\r?\n/);
    if (!/backend[\\/]server\.js/.test(rest.join(' '))) return null;
    return { deskPid: Number(parent) || null };
  }
  return null;
};

/** impure — stop a backend and everything it started. */
const stopTree = (pid, force = false) => {
  if (process.platform === 'win32') return run('taskkill', ['/PID', String(pid), '/T', '/F']);
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  // The backend leads its own process group (backend-spawn.cjs: detached), so the group takes its children.
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch { /* gone */ } }
  return Promise.resolve();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * impure — free a port held by a leftover NEUMA backend of ours whose desk is gone.
 * @param {number} port
 * @param {{isFree: (port:number) => Promise<boolean>, graceMs?: number, settleMs?: number}} opts
 * @returns {Promise<{outcome:'free'|'stopped'|'not-ours'|'desk-alive'|'stuck', pid?: number}>}
 */
const takeOverPort = async (port, { isFree, graceMs = 5000, settleMs = 10000 }) => {
  if (await isFree(port)) return { outcome: 'free' };
  const pid = await findListener(port);
  const who = pid ? await describe(pid) : null;
  if (!who) return { outcome: 'not-ours', pid };
  if (who.deskPid && alive(who.deskPid)) return { outcome: 'desk-alive', pid };
  await stopTree(pid);
  for (let waited = 0; waited < settleMs; waited += 250) {
    if (waited === graceMs && alive(pid)) await stopTree(pid, true);
    if (!alive(pid) && (await isFree(port))) return { outcome: 'stopped', pid };
    await sleep(250);
  }
  return { outcome: 'stuck', pid };
};

module.exports = { takeOverPort, findListener, describe, isBackendArgv, listeningInodes, netstatListener };
