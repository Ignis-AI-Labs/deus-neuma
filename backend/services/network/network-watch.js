// THE NETWORK WATCH — every connection this machine holds right now, read as it is: what is going OUT, what came
// IN, what is LISTENING, by which program, to which address.
//
// Design note, 2026-11-22: […]
//
// What it reads: the machine's own socket table (`ss`, the kernel's list — the same one host-probe.js reads for
// what is listening), so it shows what IS connected, not what a program says it does. Each connection is placed by
// WHERE its other end is:
//   this machine   loopback: a program here talking to a program here; nothing leaves
//   your tailnet   only your own devices reach it
//   your network   a private address on your LAN (the router, another computer in the room)
//   the internet   a public address: this is what leaves
// and by WHOSE it is: the platform's own (this desk, its engine, its sidecars — by process and by the ports the
// platform owns) or another program's on the machine (a browser, an editor), which is shown apart so the platform's
// own traffic is never lost among it.
// No name is looked up for an address: asking would itself be a connection going out. The address is shown as it is.
// Beside what is connected stands what MAY connect by itself: the platform's own list of self-running connections
// (connections/connection-switches.js), each on or off.
// A machine whose socket table cannot be read says so; it never reports a network it did not measure.
// The reading of the table is PURE; the watch is impure (one command, the switches).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { bindScope } from '../security/host-probe.js';
import { readPlatformPorts, portOwner } from '../security/platform-ports.js';
import { connectionStates } from '../connections/connection-switches.js';
import { createLogger } from '../logger.js';

const log = createLogger('NetworkWatch');
const execFileP = promisify(execFile);
const COMMAND_TIMEOUT_MS = 8000;

// pure — "192.168.1.5:443", "[2001:db8::1]:443", "*:80", "192.168.1.5%wlan0:68" → {address, port}.
const endOf = (text) => {
  const at = String(text ?? '').lastIndexOf(':');
  if (at < 0) return { address: String(text ?? ''), port: null };
  const port = Number(text.slice(at + 1));
  return { address: text.slice(0, at).split('%')[0].replace(/^\[|\]$/g, ''), port: Number.isInteger(port) ? port : null };
};
const MULTICAST_V4 = (a) => { const first = Number(a.split('.')[0]); return a.split('.').length === 4 && first >= 224 && first <= 239; };
const PRIVATE_V4 = (a) => { const o = a.split('.').map(Number); return o.length === 4 && (o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168) || (o[0] === 169 && o[1] === 254)); };

/**
 * pure — where an address is, as the operator would say it.
 * @returns {'machine'|'tailnet'|'lan'|'internet'|'any'}
 */
export const placeOf = (address) => {
  const a = String(address ?? '').replace(/^::ffff:/, '').toLowerCase();
  if (a === '*' || a === '0.0.0.0' || a === '::' || a === '') return 'any';
  const scope = bindScope(a);
  if (scope === 'loopback') return 'machine';
  if (scope === 'tailnet') return 'tailnet';
  // A private address, or one only this network segment hears (multicast: device discovery), never leaves the room.
  if (PRIVATE_V4(a) || MULTICAST_V4(a) || /^(fe80|fc|fd|ff)[0-9a-f]*:/.test(a)) return 'lan';
  return 'internet';
};

/**
 * pure — `ss -H -t -u -n -p -a` lines → sockets. Lines look like:
 *   tcp ESTAB 0 0 192.168.1.5:54321 104.18.2.3:443 users:(("node",pid=41,fd=30))
 *   tcp LISTEN 0 511 127.0.0.1:3375 0.0.0.0:* users:(("node",pid=41,fd=22))
 * A socket another user owns carries no users:(…): process and pid are null.
 * @returns {Array<{proto: string, state: string, local: {address, port}, peer: {address, port}, process: ?string, pid: ?number}>}
 */
export const parseSockets = (text) => String(text ?? '').split('\n').map((line) => {
  const cells = line.trim().split(/\s+/);
  if (cells.length < 6 || !/^(tcp|udp)$/.test(cells[0])) return null;
  const who = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
  return { proto: cells[0], state: cells[1], local: endOf(cells[4]), peer: endOf(cells[5]), process: who ? who[1] : null, pid: who ? Number(who[2]) : null };
}).filter(Boolean);

/**
 * pure — the network as the operator reads it.
 * @param {object[]} sockets - parseSockets' answer
 * @param {{ports?: object[], pids?: Set<number>}} platform - ports: the platform's own port registry · pids: its own processes
 * @returns {{listening: object[], out: object[], in: object[], counts: object}}
 */
export const networkOf = (sockets, { ports = [], pids = new Set() } = {}) => {
  const listens = sockets.filter((s) => s.state === 'LISTEN' || (s.proto === 'udp' && s.state === 'UNCONN'));
  const open = new Set(listens.map((s) => `${s.proto}:${s.local.port}`));
  const ours = (s, port) => Boolean((s.pid && pids.has(s.pid)) || portOwner(ports, port));
  const listening = listens.map((s) => ({ proto: s.proto, address: s.local.address, port: s.local.port, reach: placeOf(s.local.address), process: s.process, pid: s.pid, owner: portOwner(ports, s.local.port), ours: ours(s, s.local.port) }))
    .sort((a, b) => Number(b.ours) - Number(a.ours) || a.port - b.port);
  // One line a program and a far end: twenty sockets to one address are one conversation, counted.
  const group = (rows) => { const by = new Map(); for (const r of rows) { const k = `${r.process}|${r.pid}|${r.address}|${r.port}|${r.proto}`; const g = by.get(k) ?? { ...r, sockets: 0 }; g.sockets += 1; by.set(k, g); } return [...by.values()]; };
  const order = { internet: 0, lan: 1, tailnet: 2, machine: 3, any: 4 };
  const sorted = (rows) => group(rows).sort((a, b) => order[a.place] - order[b.place] || Number(b.ours) - Number(a.ours) || String(a.process).localeCompare(String(b.process)) || String(a.address).localeCompare(String(b.address)));
  const live = sockets.filter((s) => s.state === 'ESTAB' && s.peer.port);
  // It came IN when its own end is a port something here listens on; otherwise this machine reached out.
  const cameIn = (s) => open.has(`${s.proto}:${s.local.port}`);
  const row = (s, inward) => ({ proto: s.proto, process: s.process, pid: s.pid, address: s.peer.address, port: inward ? s.local.port : s.peer.port, place: placeOf(s.peer.address), owner: portOwner(ports, inward ? s.local.port : s.peer.port), ours: ours(s, inward ? s.local.port : s.peer.port) });
  const out = sorted(live.filter((s) => !cameIn(s)).map((s) => row(s, false)));
  const inward = sorted(live.filter(cameIn).map((s) => row(s, true)));
  const leaving = out.filter((r) => r.place === 'internet');
  return {
    listening, out, in: inward,
    counts: {
      leaving: leaving.length, leavingOurs: leaving.filter((r) => r.ours).length, addresses: new Set(leaving.map((r) => r.address)).size,
      lan: out.filter((r) => r.place === 'lan').length, onMachine: out.filter((r) => r.place === 'machine').length + inward.filter((r) => r.place === 'machine').length,
      inFromOutside: inward.filter((r) => r.place !== 'machine').length,
      open: listening.filter((l) => l.reach !== 'machine').length, listening: listening.length,
    },
  };
};

// impure — this desk's own processes: itself, what started it, and what it started.
const platformPids = async () => {
  const pids = new Set([process.pid, process.ppid].filter(Boolean));
  try {
    const { stdout } = await execFileP('ps', ['-eo', 'pid=,ppid='], { timeout: COMMAND_TIMEOUT_MS });
    const rows = stdout.split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter((r) => r.length === 2 && r.every(Number.isInteger));
    // Children of the desk, to any depth; and the shell around it (its parent's other children are the app's own windows).
    for (let grew = true; grew;) { grew = false; for (const [pid, ppid] of rows) if (pids.has(ppid) && !pids.has(pid)) { pids.add(pid); grew = true; } }
  } catch { /* the two it knows by itself stand */ }
  return pids;
};

/**
 * The network, read now. Never throws.
 * @returns {Promise<{readAt: string, measured: boolean, why?: string, listening: object[], out: object[], in: object[], counts: object, selfRunning: object[]}>}
 */
export const readNetwork = async () => {
  const readAt = new Date().toISOString();
  const selfRunning = (await connectionStates().catch(() => [])).map((c) => ({ id: c.id, name: c.name, to: c.to, when: c.when, sends: c.sends, control: c.control, on: c.on ?? null }));
  if (process.platform !== 'linux') return { readAt, measured: false, why: `the socket table is read on Linux today; on ${process.platform} this watch is not built yet`, listening: [], out: [], in: [], counts: {}, selfRunning };
  try {
    const [{ stdout }, pids] = await Promise.all([execFileP('ss', ['-H', '-t', '-u', '-n', '-p', '-a'], { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }), platformPids()]);
    return { readAt, measured: true, ...networkOf(parseSockets(stdout), { ports: readPlatformPorts(), pids }), selfRunning };
  } catch (err) {
    log.warn('The socket table could not be read', { error: err.message });
    return { readAt, measured: false, why: `the machine's socket table could not be read (${err.code === 'ENOENT' ? 'the ss command is not installed' : err.message})`, listening: [], out: [], in: [], counts: {}, selfRunning };
  }
};
