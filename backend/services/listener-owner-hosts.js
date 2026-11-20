// listener-owner-hosts — who holds a loopback port where there is no /proc: macOS and Windows
// (PR600 audit P6-153). Pure readers of each system's own command output, and one thin caller that
// runs the commands. listener-owner.js decides what the rows mean.
//
//   macOS    lsof -nP -iTCP:<port> -sTCP:LISTEN -F pu   → each listening process and its account id.
//            Without root, lsof lists only this account's own processes: a listener it does not
//            list is somebody else's.
//   Windows  netstat -ano -p TCP                         → the process ids listening on the port
//            tasklist /FI "PID eq <pid>" /V /FO CSV /NH  → that process's account (DOMAIN\name);
//            a process this account may not read answers N/A, which names nobody.
//
// A row whose account could not be read carries `uid: null`; nothing here guesses one.
import { execFileSync } from 'node:child_process';
import os from 'node:os';

/** The accounts Windows itself runs services under, as tasklist names them (lower case). */
const WINDOWS_SYSTEM = Object.freeze(['nt authority\\system', 'nt authority\\local service', 'nt authority\\network service']);

/**
 * The listening processes in the text of `lsof -F pu`: a `p<pid>` line opens a process, a
 * `u<uid>` line names its account. Pure.
 * @param {string} text
 * @returns {Array<{pid: number, uid: number|null}>}
 */
export const lsofListeners = (text) => String(text).split('\n').reduce((rows, line) => {
  const value = line.slice(1).trim();
  if (line[0] === 'p' && /^\d+$/.test(value)) return [...rows, { pid: Number(value), uid: null }];
  if (line[0] === 'u' && /^\d+$/.test(value) && rows.length > 0) return [...rows.slice(0, -1), { ...rows.at(-1), uid: Number(value) }];
  return rows;
}, []);

/**
 * The ids of the processes listening on one port, from the text of `netstat -ano`. A listening
 * row is told by its remote side (0.0.0.0:0, [::]:0), never by the state word, which Windows
 * prints in the system's language. Pure.
 * @param {string} text
 * @param {number} port
 * @returns {number[]}
 */
export const netstatListenerPids = (text, port) => [...new Set(String(text).split('\n')
  .map((line) => line.trim().split(/\s+/))
  .filter((f) => f[0] === 'TCP' && f.length >= 5 && f[1].slice(f[1].lastIndexOf(':') + 1) === String(port)
    && /^(0\.0\.0\.0|\[::\]|\*):(0|\*)$/.test(f[2]) && /^\d+$/.test(f.at(-1)))
  .map((f) => Number(f.at(-1))))];

/**
 * The account running a process, from the text of `tasklist /V /FO CSV /NH` for that one process:
 * its seventh cell, DOMAIN\name, lower case. Null when the row is missing or names nobody. Pure.
 * @param {string} csv
 * @returns {string|null}
 */
export const tasklistOwner = (csv) => {
  const row = String(csv).split('\n').map((line) => line.trim()).find((line) => line.startsWith('"'));
  const user = row ? [...row.matchAll(/"([^"]*)"/g)].map((cell) => cell[1])[6] : null;
  return user && user.includes('\\') ? user.toLowerCase() : null;
};

// impure (child process) — one command's text; throws when the command cannot run
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });

// impure — lsof exits 1 when it lists nothing, which is an answer (nobody of ours listens), not a failure
const lsofText = (port) => {
  try {
    return run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pu']);
  } catch (err) {
    if (err.status === 1) return String(err.stdout ?? '');
    throw err;
  }
};

// impure — the account behind each listening process id; null where it cannot be read
const windowsRows = (port) => netstatListenerPids(run('netstat', ['-ano', '-p', 'TCP']), port).map((pid) => {
  try {
    return { pid, uid: tasklistOwner(run('tasklist', ['/FI', `PID eq ${pid}`, '/V', '/FO', 'CSV', '/NH'])) };
  } catch {
    return { pid, uid: null };
  }
});

/**
 * Every process listening on a port on a macOS or Windows computer, with this account and the
 * system accounts trusted beside it, or null where the system's command could not be run at all.
 * impure (child processes)
 * @param {'darwin'|'win32'|string} platform
 * @param {number} port
 * @returns {{rows: Array<{pid: number, uid: number|string|null}>, who: {uid: number|string, serviceUids: Array<number|string>}}|null}
 */
export const hostListeners = (platform, port) => {
  try {
    if (platform === 'darwin') return { rows: lsofListeners(lsofText(port)), who: { uid: process.getuid(), serviceUids: [] } };
    if (platform === 'win32') {
      const me = `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`.toLowerCase();
      return { rows: windowsRows(port), who: { uid: me, serviceUids: WINDOWS_SYSTEM } };
    }
    return null;
  } catch {
    return null;
  }
};
