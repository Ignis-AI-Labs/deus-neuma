// House probe — the HOUSE layer of the CSO's watch: the beings, witnesses,
// and stores that live inside this platform, checked for the hygiene
// failures a dependency scanner can never see.
//
// What it checks, all read-only, for ONE house (Design note, 2026-10-16: two houses
// on one machine are never confused — a house's ledger never carries another
// house's lanes):
//   - every lane of the house holds an owner.json (an ownerless lane is an access-control
//     hole: the first authenticated wallet to touch it becomes its owner);
//   - credential-bearing stores are mode 0600 (a credentials file readable
//     by other users is a leak that needs no exploit);
//   - no env.* file at the repo root holds a plaintext key (the sweep covers
//     TRACKED files; env files are gitignored by law, so the house probe is
//     the only eye on them — and it reports the FILE NAME, never the line);
//     (an ownerless lane belongs to no house, so every house is told);
//   - every birthed lane's keypair custody is settled (interim plaintext
//     gone, envelopes sealed) via the existing birth-setup probe;
//   - the web-egress master switch state, as an inventory note (an operator
//     choice, not a finding).

import fs from 'fs/promises';
import { join } from 'path';
import { getSettingsDir } from '../data-root.js';
import { getWorkspacesRoot } from '../../../core/workspace/neuma-workspace.js';
import { detectBirthSetupState } from '../../../core/birth/birth-setup-state.js';
import { scanText } from './secret-sweep.js';

// Credential-bearing stores known to this house. The check is mode bits,
// never content.
const SENSITIVE_STORE_NAMES = /credentials|secret|keypair|witness.*key/i;

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
    surfaces: [label],
  };
};

// impure — env.* plaintext check: the file NAME is the finding; the matched
// line never leaves the file. An unreadable env file is a finding of its own
// (a guard that cannot see protects nothing).
const envFinding = async (repoRoot, name) => {
  const text = await fs.readFile(join(repoRoot, name), 'utf8').catch(() => null);
  if (text === null) {
    return {
      layer: 'house', source: 'house-probe', externalId: `house:env-unreadable:${name}`,
      title: `${name} cannot be read by the watch`, severity: 'low',
      summary: 'The house probe could not read this env file to check it for plaintext keys. Check its permissions by hand.',
      surfaces: [name],
    };
  }
  if (!scanText(text).length) return null;
  return {
    layer: 'house', source: 'house-probe', externalId: `house:plaintext-secret:${name}`,
    title: `${name} holds a plaintext secret`, severity: 'critical',
    summary: `A secret pattern matches inside ${name}. The matched material is deliberately not recorded. Rotate the key, then re-seal the file (scripts/secure-witness-keys.mjs) — sealing without rotation protects a key that already leaked.`,
    surfaces: [name],
  };
};

// impure — the wallet a lane's owner.json names, lowercased; null when the
// lane has none (or an unreadable one — the presence check below reports it).
const laneOwner = async (lanesRoot, name) => {
  try {
    const owner = JSON.parse(await fs.readFile(join(lanesRoot, name, 'owner.json'), 'utf8'));
    return typeof owner?.wallet === 'string' ? owner.wallet.toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * Run the house checks. Never throws — every individual failure lands as a
 * finding or an error string, because a probe that hides its own blindness
 * is worse than no probe.
 *
 * impure — filesystem reads only
 * @param {{wallet: string, workspace: Object, repoRoot: string, workspacesRoot?: string, settingsDir?: string, webAccessEnabled?: boolean|null}} opts
 *   wallet — the house whose lanes are checked (another house's lanes are skipped)
 * @returns {Promise<{findings: Array<Object>, notes: {webAccessEnabled: boolean|null}, errors: string[]}>}
 */
export const runHouseProbe = async ({ wallet, workspace, repoRoot, workspacesRoot, settingsDir, webAccessEnabled = null }) => {
  const house = typeof wallet === 'string' ? wallet.toLowerCase() : null;
  const lanesRoot = workspacesRoot || getWorkspacesRoot();
  const settings = settingsDir || getSettingsDir();
  const findings = [];
  const errors = [];

  // Lanes: owner.json presence, then custody for lanes that were birthed.
  const lanes = (await listDir(lanesRoot)).filter((d) => d.isDirectory() && !d.name.startsWith('.'));
  for (const lane of lanes) {
    const owner = await fs.stat(join(lanesRoot, lane.name, 'owner.json')).catch(() => null);
    if (owner && (await laneOwner(lanesRoot, lane.name)) !== house) continue;
    if (!owner) {
      findings.push({
        layer: 'house', source: 'house-probe', externalId: `house:ownerless-lane:${lane.name}`,
        title: `lane ${lane.name} has no owner.json`, severity: 'high',
        summary: `The lane ${lane.name} stands unclaimed: the first authenticated wallet to touch it becomes its owner. Claim it or remove it.`,
        surfaces: [`workspaces/${lane.name}`],
      });
    }
    // Custody is a birth question — only lanes with a keys/ dir were birthed.
    const birthed = await fs.stat(join(lanesRoot, lane.name, 'keys')).catch(() => null);
    if (!birthed) continue;
    try {
      const state = await detectBirthSetupState(workspace, lane.name);
      if (!state.keypairCustody) {
        findings.push({
          layer: 'house', source: 'house-probe', externalId: `house:keypair-custody:${lane.name}`,
          title: `lane ${lane.name} keypair custody is owed`, severity: 'critical',
          summary: `The being in ${lane.name} still owes keypair custody (interim plaintext present, or envelopes unsealed). Its signing key is recoverable by anyone who reaches the file. Complete the custody act (the BirthSetupGate drives it).`,
          surfaces: [`workspaces/${lane.name}/keys`],
        });
      }
    } catch (err) {
      errors.push(`custody check failed for ${lane.name}: ${err.message}`);
    }
  }

  // Credential stores: mode bits.
  const settingsFiles = (await listDir(settings)).filter((d) => d.isFile() && SENSITIVE_STORE_NAMES.test(d.name));
  for (const file of settingsFiles) {
    const finding = await modeFinding(join(settings, file.name), `data/settings/${file.name}`);
    if (finding) findings.push(finding);
  }

  // env.* at the repo root: plaintext keys by file name only.
  const envFiles = (await listDir(repoRoot)).filter((d) => d.isFile() && /^env\./.test(d.name));
  for (const file of envFiles) {
    const finding = await envFinding(repoRoot, file.name);
    if (finding) findings.push(finding);
  }

  return { findings, notes: { webAccessEnabled }, errors };
};
