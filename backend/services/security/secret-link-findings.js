/**
 * Secret-link findings — the house probe's eye on a KNOWN secret that has a
 * second name (a hard link). Nothing the platform makes links a secret
 * twice, so a second link is a sign someone staged one: the other name
 * carries the secret's bytes past every name law. The walls already refuse
 * it (secret-inodes.js); this makes it SEEN, so the operator removes it and
 * the watch closes the row once the link is gone.
 *
 * Per house (two houses on one machine are never confused): a secret inside
 * a lane is that lane's owner's to hear about; a lane with no owner record
 * yet is told to every house, as the probe tells an unclaimed lane; a secret
 * outside every lane ground (the checkout's env files, HOME's credentials,
 * the secret stores) is the machine's, and every house is told — the house
 * probe reports the checkout's env files the same way. Paths only, never a
 * byte of content. The other names are looked for under the house ground
 * and the checkout (secret-twin-finder.js) and named in the remedy; one
 * elsewhere on disk is found by the find command the remedy gives.
 *
 * impure — stats (secret-inodes), reads owner records, runs find.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { linkedSecrets } from '../secret-inodes.js';
import { findSecretTwins } from '../secret-twin-finder.js';
import { getWorkspacesRoot, getWitnessesRoot } from '../../../core/workspace/neuma-workspace.js';
import { getHarnessRoot } from '../../../core/workspace/lane-grounds.js';

// pure — `rel` of `target` under `root`, or null outside it.
const below = (root, target) => {
  const rel = path.relative(root, target);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null;
};

// impure — the wallet a lane's owner.json names (lowercased), or null when
// there is none. An unreadable or corrupt record throws: the probe records
// it as an error, so the scope is not whole and nothing closes.
const laneOwner = async (laneDir) => {
  let raw;
  try {
    raw = await fs.readFile(path.join(laneDir, 'owner.json'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
  const wallet = JSON.parse(raw)?.wallet;
  return typeof wallet === 'string' ? wallet.toLowerCase() : null;
};

// impure — is this secret this house's to hear about?
const isOurs = async (house, secretPath, grounds) => {
  for (const ground of grounds) {
    const rel = below(ground, secretPath);
    if (!rel) continue;
    const owner = await laneOwner(path.join(ground, rel.split(path.sep)[0]));
    return owner === null || owner === house;
  }
  return true;
};

// pure — the finding for one linked secret.
const linkFinding = (secret, twins) => {
  const home = os.homedir();
  const label = secret.path.startsWith(`${home}${path.sep}`) ? `~/${path.relative(home, secret.path)}` : secret.path;
  const others = twins.filter((p) => p !== secret.path);
  const named = others.length > 0 ? `remove the extra link ${others.join(', ')}; ` : 'remove the extra link; ';
  return {
    layer: 'house', source: 'house-probe', externalId: `house:secret-link:${secret.path}`,
    title: `${label} has a second name — a hard link to a secret`,
    severity: 'high',
    summary: `The secret file ${label} has ${secret.nlink} links: another name on this disk carries its bytes under a name no secret wall knows. Nothing the platform makes does this — treat it as staged. Every being, the coding shell and the Explorer already refuse the other name; remove it, and ask who made it.`,
    remedy: `${named}find every name with: find / -xdev -samefile ${secret.path} — rm each path it prints except ${secret.path} itself.`,
    surfaces: [label],
  };
};

/**
 * This house's findings for known secrets with more than one link.
 * @param {{house: string, repoRoot: string}} opts - house: lowercased wallet
 * @returns {Promise<Array<Object>>}
 */
export const secretLinkFindings = async ({ house, repoRoot }) => {
  const linked = linkedSecrets();
  if (linked.length === 0) return [];
  const workspaces = path.resolve(getWorkspacesRoot());
  const grounds = [workspaces, getWitnessesRoot(), getHarnessRoot(workspaces)].map((g) => path.resolve(g));
  const ours = [];
  for (const secret of linked) if (await isOurs(house, secret.path, grounds)) ours.push(secret);
  if (ours.length === 0) return [];
  const roots = (await Promise.all([workspaces, repoRoot].map((r) => fs.stat(r).then((s) => (s.isDirectory() ? r : null), () => null))))
    .filter(Boolean);
  const twins = await findSecretTwins(roots, ours);
  const keys = await Promise.all(twins.map((p) => fs.stat(p, { bigint: true }).then((s) => `${s.dev}:${s.ino}`, () => null)));
  return ours.map((secret) => linkFinding(secret, twins.filter((p, i) => keys[i] === `${secret.dev}:${secret.ino}`)));
};
