// listener-owner — who holds a loopback port. impure (reads /proc), with pure readers beside it.
//
// The app talks to local servers over 127.0.0.1: the speech engine it starts, an Ollama it starts
// or finds running. An answer on a port proves nothing about who answers: any program on this
// computer can bind a loopback port first, and another account's program then stands where the
// engine or the model server should (PR600 audit P6-59, P6-153). The kernel knows who holds each
// listening socket, so the app asks it:
//
//   - a server the app started must hold its own port (listenerHeldBy: every socket listening
//     there is one of that process's own),
//   - a server the app found running must be run by this account, by root, or by a service account
//     the caller names (listenerStanding): never by another person's account.
//
// On Linux the kernel's table is /proc/net/tcp. On macOS and Windows listenerStanding asks the
// system's own commands (listener-owner-hosts.js); listenerHeldBy is Linux's alone and answers
// 'unknown' elsewhere. Where a server was heard answering and no listener of a trusted account
// could be read, macOS and Windows count it as another account's (answeredStanding): there the
// commands show this account every listener it may trust, so one it cannot see is not one of them.
import fs from 'node:fs';
import { hostListeners } from './listener-owner-hosts.js';

// the kernel's code for a socket in the LISTEN state
const LISTENING = '0A';

/**
 * The sockets listening on one port, read from the text of /proc/net/tcp or /proc/net/tcp6. Pure.
 * @param {string} table
 * @param {number} port
 * @returns {Array<{uid: number, inode: number}>}
 */
export const listenRows = (table, port) => String(table).split('\n').slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter((f) => f.length > 9 && f[3] === LISTENING && parseInt(f[1].slice(f[1].lastIndexOf(':') + 1), 16) === port)
  .map((f) => ({ uid: Number(f[7]), inode: Number(f[9]) }));

/**
 * The numeric id of a named account, read from the text of /etc/passwd, or null. Pure.
 * @param {string} passwd
 * @param {string} name
 * @returns {number|null}
 */
export const accountUid = (passwd, name) => {
  const row = String(passwd).split('\n').map((line) => line.split(':')).find((f) => f[0] === name && /^\d+$/.test(f[2] ?? ''));
  return row ? Number(row[2]) : null;
};

/**
 * What a port's listeners say about who runs the server there. Pure.
 * @param {Array<{uid: number|string|null}>|null} rows - the port's listeners (uid null: the account could not
 *   be read, which is nobody trusted), or null where the system cannot say
 * @param {{uid: number|string, serviceUids?: Array<number|string>}} who - this account, and the service accounts trusted beside root
 * @returns {{standing: 'own'|'system'|'foreign'|'unknown', uid: number|string|null}} uid: the foreign account's, where it was read
 */
export const standingOf = (rows, { uid, serviceUids = [] }) => {
  if (!rows || rows.length === 0) return Object.freeze({ standing: 'unknown', uid: null });
  const trusted = new Set([uid, 0, ...serviceUids]);
  const foreign = rows.find((row) => !trusted.has(row.uid));
  if (foreign) return Object.freeze({ standing: 'foreign', uid: foreign.uid });
  return Object.freeze({ standing: rows.every((row) => row.uid === uid) ? 'own' : 'system', uid: null });
};

// impure (fs) — every socket listening on a port on this computer, or null where the system cannot
// say (not Linux, or the kernel's table cannot be read)
const portListeners = (port) => {
  if (process.platform !== 'linux') return null;
  try {
    const v6 = fs.existsSync('/proc/net/tcp6') ? fs.readFileSync('/proc/net/tcp6', 'utf8') : '';
    return [...listenRows(fs.readFileSync('/proc/net/tcp', 'utf8'), port), ...listenRows(v6, port)];
  } catch {
    return null;
  }
};

// impure (fs) — the sockets a process holds, by inode
const socketsOf = (pid) => new Set(fs.readdirSync(`/proc/${pid}/fd`).flatMap((fd) => {
  try {
    const inode = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(`/proc/${pid}/fd/${fd}`));
    return inode ? [Number(inode[1])] : [];
  } catch {
    return []; // a descriptor closed between the listing and the read
  }
}));

/**
 * Does this process hold the port: is every socket listening there one of its own? 'unknown' where
 * the system cannot say. A port nothing listens on, or one shared with any other process, is 'other'.
 * impure (fs)
 * @param {number} port
 * @param {number} pid
 * @returns {'held'|'other'|'unknown'}
 */
export const listenerHeldBy = (port, pid) => {
  const rows = portListeners(port);
  if (rows === null) return 'unknown';
  if (rows.length === 0) return 'other';
  try {
    const own = socketsOf(pid);
    return rows.every((row) => own.has(row.inode)) ? 'held' : 'other';
  } catch {
    return 'other'; // the process is gone, or is not this account's to read
  }
};

/**
 * Who runs the server on a port: this account ('own'), root or a named service account ('system'),
 * another account ('foreign', with its id), or 'unknown' where the system cannot say or nothing on
 * this computer listens there (a port forwarded from elsewhere). impure (fs)
 * @param {number} port
 * @param {{serviceAccounts?: string[], platform?: string}} [opts] - service accounts trusted beside root, by name
 *   (Linux); the system whose way of asking is used
 * @returns {{standing: 'own'|'system'|'foreign'|'unknown', uid: number|string|null}}
 */
export const listenerStanding = (port, { serviceAccounts = [], platform = process.platform } = {}) => {
  if (platform !== 'linux') {
    const host = hostListeners(platform, port);
    return host ? standingOf(host.rows, host.who) : standingOf(null, { uid: -1 });
  }
  const rows = portListeners(port);
  if (!rows || rows.length === 0) return standingOf(rows, { uid: -1 });
  let passwd = '';
  try { passwd = fs.readFileSync('/etc/passwd', 'utf8'); } catch { /* no account file: no service account is trusted */ }
  const serviceUids = serviceAccounts.map((name) => accountUid(passwd, name)).filter((uid) => uid !== null);
  return standingOf(rows, { uid: process.getuid(), serviceUids });
};

/**
 * The standing of a server that was HEARD answering on the port. On Linux an unreadable owner
 * stays 'unknown' (a port forwarded from elsewhere has no listener here). On macOS and Windows
 * it is 'foreign': never adopted on an answer alone. Pure.
 * @param {string} platform
 * @param {{standing: string, uid: number|string|null}} owner - listenerStanding's answer
 * @returns {{standing: 'own'|'system'|'foreign'|'unknown', uid: number|string|null}}
 */
export const answeredStanding = (platform, owner) => (
  platform !== 'linux' && owner.standing === 'unknown' ? Object.freeze({ standing: 'foreign', uid: null }) : owner
);
