// impure: resolve only public resolver/trust files, never bind host /etc wholesale.
//
// OUTWARD ONLY. A networked shell gets the internet, never the machine it runs
// on: sharing the host's network would hand a being every service bound to
// loopback (the image engine takes jobs with no login, so its content law
// could be skipped outright, and the local model server and backend sit there
// too) and the home network behind it. The same line the web tool holds
// (web-guard.js). So the shell runs in its own network namespace behind pasta
// (passt) with every port forward off and no route to the host, and nftables in
// that namespace refuses private, loopback and link-local destinations before
// the shell starts. Only DNS crosses to the host resolver, through a stand-in
// address. No pasta or nft on the machine: the networked shell does not run
// (it never falls back to sharing the host network).
import fs from 'fs/promises';
import { constants as FS } from 'fs';
import os from 'os';
import path from 'path';

const RESOLVERS = Object.freeze(['/etc/resolv.conf', '/etc/nsswitch.conf', '/etc/hosts']);
const CA_BUNDLES = Object.freeze([
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/ssl/cert.pem',
  '/etc/ssl/ca-bundle.pem',
  '/etc/pki/tls/certs/ca-bundle.crt',
  '/etc/pki/tls/cert.pem',
  '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',
]);

// TEST-NET-1: never routed anywhere real; pasta answers DNS sent to it with the host's resolver.
const STAND_IN_DNS = '192.0.2.53';
const BIN_DIRS = Object.freeze(['/usr/bin', '/usr/sbin', '/bin', '/sbin']);

// Loopback inside the namespace is the shell's own (a dev server it starts is fine).
export const OUTWARD_RULES = `table inet outward {
  chain out {
    type filter hook output priority 0; policy accept;
    oif "lo" accept
    ip daddr ${STAND_IN_DNS} accept
    ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.168.0.0/16, 198.18.0.0/15, 224.0.0.0/3 } reject
    ip6 daddr { ::/127, ::ffff:0:0/96, 64:ff9b::/96, fc00::/7, fe80::/10, ff00::/8 } reject
  }
}
`;

/** Dereference resolver/CA symlinks onto their standard guest file paths.
 * No private-key directories, client certs, credentials, or TLS bypass.
 * @param {{resolvConf?: string}} [opts] a resolver file to bind in place of the host's
 * impure. */
export const shellNetworkResources = async ({ resolvConf = null } = {}) => {
  const args = [];
  for (const destination of [...RESOLVERS, ...CA_BUNDLES]) {
    if (destination === '/etc/resolv.conf' && resolvConf) { args.push('--ro-bind', resolvConf, destination); continue; }
    let source;
    try { source = await fs.realpath(destination); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!(await fs.stat(source)).isFile()) throw new Error(`Not a public resolver/trust file: ${destination}`);
    args.push('--ro-bind', source, destination);
  }
  return args;
};

const findBinary = async (name) => {
  for (const dir of BIN_DIRS) {
    const candidate = path.join(dir, name);
    try { await fs.access(candidate, FS.X_OK); return candidate; } catch { /* next */ }
  }
  return null;
};

// One private folder per process (mode 700, so no other user can swap the files) for the resolver and rules.
// One folder per user, reused across processes, so test runs and restarts do not
// leave a folder each in /tmp. Used only when it is provably ours: a real directory
// (never a symlink), owned by this user, mode 700. Anything else gets a fresh folder.
const ownFolder = async () => {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const dir = path.join(os.tmpdir(), `neuma-outward-${uid ?? 'user'}`);
  try { await fs.mkdir(dir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const st = await fs.lstat(dir);
  const ours = st.isDirectory() && !st.isSymbolicLink() && (uid === null || st.uid === uid) && (st.mode & 0o777) === 0o700;
  return ours ? dir : fs.mkdtemp(path.join(os.tmpdir(), 'neuma-outward-'));
};

// impure — write a file fresh (a stale or swapped one is replaced, never followed)
const writeFresh = async (file, content) => {
  await fs.rm(file, { force: true });
  await fs.writeFile(file, content, { mode: 0o444, flag: 'wx' });
};

let prepared = null;
const prepareFiles = () => {
  prepared ??= (async () => {
    const dir = await ownFolder();
    await fs.chmod(dir, 0o700);
    const resolvConf = path.join(dir, 'resolv.conf');
    const rules = path.join(dir, 'outward.nft');
    await writeFresh(resolvConf, `nameserver ${STAND_IN_DNS}\n`);
    await writeFresh(rules, OUTWARD_RULES);
    return { resolvConf, rules };
  })().catch((error) => { prepared = null; throw error; });
  return prepared;
};

/**
 * The outward-only network for one shell command. impure (finds binaries,
 * writes the per-process resolver and rules once).
 * @returns {Promise<{binds: string[], wrap: (bwrapArgs: string[]) => {command: string, args: string[]}}>}
 */
export const outwardNetwork = async () => {
  const [pasta, nft] = await Promise.all([findBinary('pasta'), findBinary('nft')]);
  if (!pasta || !nft) {
    throw new Error('The networked shell needs pasta (the passt package) and nft (nftables) to keep it off this machine\'s own services; install them, or run the shell offline');
  }
  const files = await prepareFiles();
  const binds = await shellNetworkResources({ resolvConf: files.resolvConf });
  const wrap = (bwrapArgs) => {
    const pastaArgs = [
      '--config-net', '--quiet', '--no-map-gw', '--map-host-loopback', 'none',
      '-t', 'none', '-u', 'none', '-T', 'none', '-U', 'none', '--dns-forward', STAND_IN_DNS,
      '--', '/bin/sh', '-c', '"$1" -f "$2" && shift 2 && exec "$@"', 'sh', nft, files.rules, 'bwrap', ...bwrapArgs,
    ];
    // pasta drops its command's output when stdout is a socket, and Node's
    // 'pipe' is a socketpair; bash hands it real pipes and returns pasta's exit code.
    return { command: '/bin/bash', args: ['-c', '"$0" "$@" > >(cat) 2> >(cat >&2)', pasta, ...pastaArgs] };
  };
  return { binds, wrap };
};
