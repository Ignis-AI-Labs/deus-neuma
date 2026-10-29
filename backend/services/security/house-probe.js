// House probe — the HOUSE layer of the CSO's watch: the beings, witnesses,
// and stores that live inside this platform, checked for the hygiene
// failures a dependency scanner can never see.
//
// What it checks, all read-only, for ONE house — whichever wallet the
// scheduler hands it (ruling, 2026-10-16: two houses on one machine are never
// confused — a house's ledger never carries another house's lanes):
//   - every lane holds an owner.json. Since ae5782cb7 a read never claims a
//     lane: a lane belongs to the wallet its genesis seal names, and an
//     unsealed one is adopted only by the install owner, deliberately. An
//     unclaimed lane is no longer an open door — it is a being nobody can
//     reach until its operator claims it. A lane sealed to this house is
//     this house's to claim; a lane sealed to another house is never ours;
//     an unsealed lane belongs to no house, so every house is told.
//     The walk is the platform's own lane listing (listNeuma), so a ground
//     marked by lane.json (the house ground, a witness lane) is never a lane;
//   - credential-bearing stores are mode 0600 (a credentials file readable
//     by other users is a leak that needs no exploit) — the machine's
//     settings AND this house's own realm dir, where its social channel keys
//     live (social-channel-credentials.json, house-positions.js);
//   - no env-style file at the repo root (.env, .env.*, *.env, env.*) holds
//     a plaintext key (the sweep covers TRACKED files; env files are
//     gitignored by law, so the house probe is the only eye on them — and it
//     reports the FILE NAME, never the line). Rotation is owed only when the
//     file ever entered git history; a never-committed file is sealed or moved;
//   - no lane holds a plaintext signing key (keys/keypair.json carrying a
//     bare privateKey). An empty keys/ dir is an unborn skeleton, and an
//     enveloped key file is custody done — neither is a finding;
//   - no known secret has a second name — a hard link no platform act makes
//     (secret-link-findings.js; paths only, never content);
//   - the web-egress master switch state, as an inventory note (an operator
//     choice, not a finding).

import fs from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getSettingsDir } from '../data-root.js';
import { walletDir } from '../user-realm.js';
import { houseKey } from '../staff/cos-designation.js';
import { verifyLaneOwnership } from '../lane-ownership.js';
import { scanText } from './secret-sweep.js';
import { secretLinkFindings } from './secret-link-findings.js';
import { UNTRUSTED_GIT_ARGS, untrustedGitEnv } from '../untrusted-git.js';

const execFileP = promisify(execFile);

// Credential-bearing stores known to this house. The check is mode bits,
// never content.
const SENSITIVE_STORE_NAMES = /credentials|secret|keypair|witness.*key/i;
// Every env-style name; templates hold placeholders by design.
const ENV_FILE_NAME = /^(\.env(\..+)?|.+\.env|env\..+)$/;
const TEMPLATE_NAME = /\.(example|sample|template)$/;

// impure — dir entries, [] when the dir does not exist.
const listDir = async (dir) => {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

// impure — one mode-bits check → a finding, or null.
const modeFinding = async (file, label) => {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return null;
  const mode = stat.mode & 0o777;
  if (mode === 0o600 || mode === 0o400) return null;
  return {
    layer: 'house',
    source: 'house-probe',
    externalId: `house:perms:${label}`,
    title: `${label} is mode ${mode.toString(8).padStart(4, '0')} — expected 0600`,
    severity: 'high',
    summary: `The credential-bearing store ${label} is readable beyond its owner. chmod 600 it now; if it was ever readable on a multi-user window, treat the contents as exposed and rotate.`,
    remedy: `chmod 600 ${file}; if another user could have read it, rotate every credential it holds.`,
    surfaces: [label],
  };
};

// impure — the first commit (any ref) that touched this path: a sha, '' when
// git has never seen it, null when the history cannot be read (no repo here).
const firstCommitOf = async (repoRoot, name) => {
  try {
    const { stdout } = await execFileP('git', [...UNTRUSTED_GIT_ARGS, 'log', '--all', '--format=%h', '--', name], { cwd: repoRoot, env: untrustedGitEnv(), maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim().split('\n').filter(Boolean).pop() || '';
  } catch {
    return null;
  }
};

// pure — what an env file's plaintext secret owes, by its history and mode.
const envVerdict = (name, firstCommit, mode) => {
  if (firstCommit) {
    return {
      severity: 'critical',
      advice: `${name} entered git history (commit ${firstCommit}), so the key has left this file: rotate it first, then re-seal (scripts/secure-witness-keys.mjs) — sealing a key that already leaked protects nothing.`,
      remedy: `rotate every key in ${name} at the provider that issued it (it entered git history in ${firstCommit}), confirm the old keys are revoked, then seal the new values: node scripts/secure-witness-keys.mjs.`,
    };
  }
  const loose = (mode & 0o077) !== 0;
  // The file's own history is not the whole story: on this machine the same
  // values were pasted into a tracked doc and pushed. The history sweep
  // settles that by fingerprint (escalateLeakedEnvFindings), so this text
  // never promises that no rotation is owed.
  const history = firstCommit === null
    ? 'Its git history could not be read here; if it was ever committed or shared, rotate the key.'
    : 'The file itself never entered git history; if the history sweep finds one of its values in a commit, rotate that key.';
  return {
    severity: loose ? 'critical' : 'high',
    advice: `${loose ? `It is mode ${mode.toString(8).padStart(4, '0')} — chmod 600 it now. ` : ''}${history} Seal it (scripts/secure-witness-keys.mjs) or move it out of the repo.`,
    remedy: `${loose ? `chmod 600 ${name}, then ` : ''}seal it (node scripts/secure-witness-keys.mjs) or move it out of the repo root.`,
  };
};

// impure — env-file plaintext check: the file NAME is the finding; the
// matched line never leaves the file. An unreadable env file is a finding of
// its own (a guard that cannot see protects nothing).
const envFinding = async (repoRoot, name) => {
  const file = join(repoRoot, name);
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text === null) {
    return {
      layer: 'house', source: 'house-probe', externalId: `house:env-unreadable:${name}`,
      title: `${name} cannot be read by the watch`, severity: 'low',
      summary: 'The house probe could not read this env file to check it for plaintext keys. Check its permissions by hand.',
      remedy: `check ${file}'s owner and mode (ls -l); it must be readable by the user the app runs as, and by nobody else (chmod 600).`,
      surfaces: [name],
    };
  }
  const hits = scanText(text);
  if (!hits.length) return null;
  const mode = ((await fs.stat(file).catch(() => null))?.mode ?? 0) & 0o777;
  const { severity, advice, remedy } = envVerdict(name, await firstCommitOf(repoRoot, name), mode);
  return {
    layer: 'house', source: 'house-probe', externalId: `house:plaintext-secret:${name}`,
    title: `${name} holds a plaintext secret`, severity,
    summary: `A secret pattern matches inside ${name}. The matched material is deliberately not recorded. ${advice}`,
    remedy,
    surfaces: [name],
    // rule:fingerprint per value — one-way tags the history sweep's ids
    // carry too, so a value that leaked through another file is matched.
    fingerprints: [...new Set(hits.map((h) => `${h.patternId}:${h.fingerprint}`))],
  };
};

// impure — the wallet a lane's genesis seal names, lowercased; null unsealed.
// Read the way the claim door reads it (lane-ownership.js: the plaintext seal
// on disk), so the probe and the door never disagree on whose lane it is; a
// seal that cannot be parsed throws and lands as the probe's error.
const sealedWallet = async (workspace, laneId) => {
  let raw;
  try {
    raw = await fs.readFile(join(workspace.pathFor(laneId), 'identity', 'genesis-seal.json'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const wallet = JSON.parse(raw)?.record?.witnessWallet;
  return typeof wallet === 'string' && wallet.trim() ? wallet.toLowerCase() : null;
};

// pure — the finding for a lane no wallet has claimed.
const unclaimedFinding = (laneId, sealedToUs) => ({
  layer: 'house', source: 'house-probe', externalId: `house:ownerless-lane:${laneId}`,
  title: `lane ${laneId} is unclaimed`, severity: 'medium',
  summary: sealedToUs
    ? `The lane ${laneId} is sealed to this house but no owner.json stands, so the desk refuses every read of it. Claim it through POST /api/v1/lanes/${laneId}/claim.`
    : `The lane ${laneId} carries no genesis seal and no owner.json, so no house can reach it. The install owner adopts it through POST /api/v1/lanes/${laneId}/claim, or it is removed.`,
  remedy: sealedToUs
    ? `claim it: POST /api/v1/lanes/${laneId}/claim from this house's desk.`
    : `the install owner adopts it at the desk (POST /api/v1/lanes/${laneId}/claim), or removes workspaces/${laneId} if no being lives there.`,
  surfaces: [`workspaces/${laneId}`],
});

// impure — a plaintext signing key on disk → a finding, or null. Only a key
// file that exists and is not enveloped counts.
const custodyFinding = async (workspace, laneId) => {
  let raw;
  try {
    raw = await fs.readFile(join(workspace.pathFor(laneId), 'keys', 'keypair.json'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const keypair = JSON.parse(raw);
  if (typeof keypair?.privateKey !== 'string' || !keypair.privateKey) return null;
  return {
    layer: 'house', source: 'house-probe', externalId: `house:keypair-custody:${laneId}`,
    title: `lane ${laneId} holds a plaintext signing key`, severity: 'critical',
    summary: `keys/keypair.json in ${laneId} holds the being's private key unenveloped. It is recoverable by anyone who reaches the file. Complete the custody act (the BirthSetupGate drives it).`,
    remedy: `open the desk as this house's operator and complete ${laneId}'s custody act (the BirthSetupGate): it seals keys/keypair.json under the password and recovery envelopes and removes the bare key.`,
    surfaces: [`workspaces/${laneId}/keys`],
  };
};

// impure — one lane's findings for this house; [] when the lane is another's.
const laneFindings = async (workspace, house, laneId) => {
  const owned = await verifyLaneOwnership({ workspace, neumaId: laneId, wallet: house });
  if (owned.reason === 'not-owner') return [];
  if (owned.reason === 'corrupt' || owned.reason === 'error') {
    throw new Error(`ownership unreadable: ${owned.error?.message || owned.reason}`);
  }
  const findings = [];
  if (owned.reason === 'unclaimed') {
    const sealedTo = await sealedWallet(workspace, laneId);
    if (sealedTo && sealedTo !== house) return [];
    findings.push(unclaimedFinding(laneId, sealedTo === house));
  }
  const custody = await custodyFinding(workspace, laneId);
  if (custody) findings.push(custody);
  return findings;
};

/**
 * Run the house checks. Never throws — every individual failure lands as a
 * finding or an error string, because a probe that hides its own blindness
 * is worse than no probe.
 *
 * impure — filesystem reads, `git log` over the repo root
 * @param {{wallet: string, workspace: Object, repoRoot: string, settingsDir?: string, webAccessEnabled?: boolean|null}} opts
 *   wallet — the house whose lanes are checked (another house's lanes are skipped)
 *   workspace — the workspace engine whose own root and listing are walked
 * @returns {Promise<{findings: Array<Object>, notes: {webAccessEnabled: boolean|null}, errors: string[]}>}
 */
export const runHouseProbe = async ({ wallet, workspace, repoRoot, settingsDir, webAccessEnabled = null }) => {
  const house = typeof wallet === 'string' ? wallet.toLowerCase() : null;
  const settings = settingsDir || getSettingsDir();
  const findings = [];
  const errors = [];

  // A directory name the engine refuses as an id (dot dirs, stray folders) is
  // no lane: no being can live there and no route can reach it.
  const lanes = (await workspace.listNeuma()).filter((id) => {
    try {
      return Boolean(workspace.pathFor(id));
    } catch {
      return false;
    }
  });
  for (const laneId of lanes) {
    try {
      findings.push(...await laneFindings(workspace, house, laneId));
    } catch (err) {
      errors.push(`lane check failed for ${laneId}: ${err.message}`);
    }
  }

  // Known secrets with a second name: a sign of staging (secret-link-findings.js).
  try {
    findings.push(...await secretLinkFindings({ house, repoRoot }));
  } catch (err) {
    errors.push(`secret link check failed: ${err.message}`);
  }

  // Credential stores: mode bits.
  const settingsFiles = (await listDir(settings)).filter((d) => d.isFile() && SENSITIVE_STORE_NAMES.test(d.name));
  for (const file of settingsFiles) {
    const finding = await modeFinding(join(settings, file.name), `data/settings/${file.name}`);
    if (finding) findings.push(finding);
  }

  // The house's own credential stores (its social channel keys): mode bits,
  // under the house's realm dir. A caller with no house has none.
  const houseDir = houseKey(wallet) ? walletDir(houseKey(wallet)) : null;
  const houseFiles = houseDir
    ? (await listDir(houseDir)).filter((d) => d.isFile() && SENSITIVE_STORE_NAMES.test(d.name))
    : [];
  for (const file of houseFiles) {
    const finding = await modeFinding(join(houseDir, file.name), `house/${file.name}`);
    if (finding) findings.push(finding);
  }

  // Env-style files at the repo root: plaintext keys by file name only.
  const envFiles = (await listDir(repoRoot))
    .filter((d) => d.isFile() && ENV_FILE_NAME.test(d.name) && !TEMPLATE_NAME.test(d.name));
  for (const file of envFiles) {
    const finding = await envFinding(repoRoot, file.name);
    if (finding) findings.push(finding);
  }

  return { findings, notes: { webAccessEnabled }, errors };
};
