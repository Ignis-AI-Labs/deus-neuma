// Tripwire findings — what a decoy read, or a swapped clipboard address,
// becomes in the threat ledger, and who may be frozen for it. Pure: the
// watch hands in what it saw, this decides what is said and done.

import { basename } from 'path';
import { decoyName } from './decoy-catalog.js';
import { isSwappedAddress } from '../../../../core/wallet/address-family.js';

// The desktop session and the login chain: freezing one hangs the screen.
const SESSION_EXECUTABLES = new Set(['systemd', 'gnome-shell', 'gnome-session-binary', 'plasmashell', 'kwin_wayland', 'kwin_x11', 'Xwayland', 'Xorg', 'sshd', 'login', 'gdm-session-worker', 'sddm', 'dbus-daemon', 'dbus-broker', 'pipewire', 'wireplumber']);
const SESSION_DIRS = Object.freeze(['/usr/bin/', '/usr/sbin/', '/usr/libexec/', '/usr/lib/', '/usr/lib64/', '/bin/', '/sbin/']);
// File indexers and scanners that open everything they are pointed at. Known
// by the executable's NAME and a root-owned LOCATION together: a process may
// call itself anything, but it cannot put its binary in /usr/bin without root.
const INDEXERS = new Set(['localsearch-3', 'tracker-miner-fs-3', 'tracker-extract-3', 'baloo_file', 'baloo_file_extractor', 'clamscan', 'clamd']);
const SYSTEM_DIRS = Object.freeze(['/usr/bin/', '/usr/libexec/', '/usr/lib/', '/usr/lib64/', '/bin/', '/usr/sbin/']);

/**
 * Where a reader stands.
 *   self      — this backend process
 *   protected — the session, the login chain, or one of our own ancestors
 *   indexer   — a system file indexer or scanner
 *   house     — started by this backend (a being's shell, a Neuma tool)
 *   outside   — anything else
 * @param {{pid: number, comm: string, exe: ?string}} proc
 * @param {{selfPid: number, selfAncestors: number[], procAncestors: number[]}} ctx
 */
export const readerStanding = (proc, { selfPid, selfAncestors = [], procAncestors = [] }) => {
  if (proc.pid === selfPid) return 'self';
  if (proc.pid === 1 || selfAncestors.includes(proc.pid)) return 'protected';
  const exe = proc.exe || '';
  if (proc.script) return procAncestors.includes(selfPid) ? 'house' : 'outside';
  if (SESSION_EXECUTABLES.has(basename(exe)) && SESSION_DIRS.some((dir) => exe.startsWith(dir))) return 'protected';
  if (INDEXERS.has(basename(exe)) && SYSTEM_DIRS.some((dir) => exe.startsWith(dir))) return 'indexer';
  return procAncestors.includes(selfPid) ? 'house' : 'outside';
};

/** Only a reader caught in the act, that is not ours to leave running, is frozen. */
export const mayFreeze = (standing) => standing === 'outside' || standing === 'house';

const STANDING_NOTE = Object.freeze({
  self: 'Neuma itself',
  protected: 'part of the desktop session, left running',
  indexer: 'a file indexer, left running',
  house: 'started by Neuma: a consciousness\'s shell or tool',
  outside: 'not started by Neuma',
});

const procLine = (p) => {
  const what = p.script ? `${p.exe || p.comm} running ${p.script}` : (p.exe || p.comm);
  return `\`${what}\` (pid ${p.pid})`;
};

const readerLine = (r) => `- ${procLine(r)}: ${STANDING_NOTE[r.standing]}${r.frozen ? ', **frozen**' : ''}`;

/**
 * One incident — every decoy hit inside one short window — as a threat.
 * @param {{startedAt: number, hits: Array<{decoyId: string, path: string, kind: string, at: number}>,
 *   readers: Array<Object>, candidates: Array<Object>}} incident
 * @returns {Object} a threat-ledger finding
 */
export const incidentFinding = ({ startedAt, hits, readers = [], candidates = [] }) => {
  const names = [...new Set(hits.map((h) => decoyName(h.decoyId)))];
  const reads = hits.filter((h) => h.kind === 'read');
  const onlyRemoved = reads.length === 0;
  const onlyIndexers = readers.length > 0 && readers.every((r) => r.standing === 'indexer');
  const frozen = readers.filter((r) => r.frozen);
  const verb = onlyRemoved ? 'removed' : 'opened';
  const title = names.length === 1
    ? `A decoy wallet file was ${verb}: ${names[0]}`
    : `${names.length} decoy wallet files were ${verb} in one sweep: ${names.join(', ')}`;
  const parts = [
    'These files are decoys Neuma planted where no real wallet or key lives. Nothing on this computer has a reason to open them, so whatever did was looking for wallets and keys.',
    `**${onlyRemoved ? 'Removed' : 'Opened'}:**\n${hits.map((h) => `- ${decoyName(h.decoyId)}: ${h.path} (${h.kind}, ${new Date(h.at).toISOString()})`).join('\n')}`,
  ];
  if (readers.length) {
    parts.push(`**Caught with the file open:**\n${readers.map(readerLine).join('\n')}`);
  } else if (!onlyRemoved) {
    parts.push('**The reader was not caught.** It had closed the file before it could be named; naming every reader needs a helper that runs as root, which this install does not have.');
  }
  if (!readers.length && candidates.length) {
    parts.push(`**Started in the two minutes before** (candidates, not a verdict):\n${candidates.map((c) => `- ${procLine(c)}`).join('\n')}`);
  }
  return {
    layer: 'hardware',
    source: 'tripwire',
    externalId: `tripwire:decoy:${new Date(startedAt).toISOString()}`,
    title,
    severity: onlyIndexers ? 'low' : (onlyRemoved ? 'high' : 'critical'),
    summary: parts.join('\n\n'),
    remedy: frozen.length
      ? 'A program is frozen. If it is yours, release it in SECURITY. If it is not: leave it frozen, take this computer off the network, move funds to a wallet made on a clean device, and change every key and password this computer held.'
      : 'Find out what read it. If you cannot name it as yours: take this computer off the network, move funds to a wallet made on a clean device, and change every key and password this computer held.',
    surfaces: names,
  };
};

/**
 * A swapped clipboard address as a threat, or null unless `found` is a
 * different address of the same chain as `copied`. An address is public
 * data; a clipboard may hold anything, and nothing else is ever written to
 * the ledger.
 */
export const clipboardFinding = ({ copied, found, at }) => {
  if (!isSwappedAddress(copied, found)) return null;
  return {
    layer: 'hardware',
    source: 'tripwire',
    externalId: `tripwire:clipboard:${new Date(at).toISOString()}`,
    title: 'An address you copied was replaced on the clipboard',
    severity: 'critical',
    summary: [
      'Neuma put an address on the clipboard and, a moment later, a different address was there. Unless you copied another address yourself in that second, a program on this computer is swapping copied wallet addresses for its own.',
      `**Copied:** \`${copied}\`\n\n**Found on the clipboard:** \`${found}\``,
      'Do not paste. Any payment sent to the address found goes to whoever runs that program.',
    ].join('\n\n'),
    remedy: 'Send nothing from this computer until the program is found and removed. Read every pasted address against its source, first and last characters and the middle. Treat every key and password this computer held as exposed.',
    surfaces: ['clipboard'],
  };
};
