#!/usr/bin/env node
/**
 * Re-key the house — the operator's command (it reads and rewrites the env
 * file; no key is ever printed). Every being on every ground gets a fresh
 * random key; everything sealed by the master directly is sealed again under
 * a new master; the old master — leaked or not — then opens nothing here.
 *
 *   node scripts/rekey-house.mjs                       # DRY RUN: what would move, what can't be opened
 *   node scripts/rekey-house.mjs --apply               # do it (every backend on this house stopped first)
 *   node scripts/rekey-house.mjs --root /path/house2   # another house under the SAME master (repeatable)
 *
 * Resumable: a run that stops part-way is finished by running --apply again.
 * Engine: core/workspace/rekey-house.js. Env file: .env (NEUMA_REKEY_ENV_FILE overrides).
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = process.env.NEUMA_REKEY_ENV_FILE || path.join(REPO, '.env');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const extraRoots = args.flatMap((a, i) => (a === '--root' && args[i + 1] ? [path.resolve(args[i + 1])] : []));

const say = (line) => process.stdout.write(`${line}\n`);
const fingerprint = (secret) => crypto.createHash('sha256').update(`rekey-fp:${secret}`).digest('hex').slice(0, 12);

// impure (fs) — the env file's lines with the two key lines replaced in place (or added), everything else kept
const writeEnvKeys = async (current, previous) => {
  const text = await fs.readFile(ENV_FILE, 'utf8');
  const stat = await fs.stat(ENV_FILE);
  const want = { DNA_ENCRYPTION_KEY: current, DNA_ENCRYPTION_KEY_PREVIOUS: previous.join(',') };
  const seen = new Set();
  const lines = text.split('\n').flatMap((line) => {
    const name = line.match(/^\s*([A-Z_]+)\s*=/)?.[1];
    if (!(name in want)) return [line];
    if (seen.has(name)) return [];
    seen.add(name);
    return want[name] ? [`${name}=${want[name]}`] : [];
  });
  for (const [name, value] of Object.entries(want)) if (!seen.has(name) && value) lines.splice(lines.length - (lines.at(-1) === '' ? 1 : 0), 0, `${name}=${value}`);
  const tmp = `${ENV_FILE}.rekey.tmp`;
  await fs.writeFile(tmp, lines.join('\n'), { mode: stat.mode & 0o777 });
  await fs.rename(tmp, ENV_FILE);
};

// impure (ps, /proc) — backends that read THIS env file (dotenv reads .env from the
// process's working directory) and so write these grounds; any other is named, not blocking
const liveBackends = async () => {
  if (process.platform === 'win32') return { here: [], elsewhere: [] };
  const out = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  const pids = out.split('\n').filter((l) => /(^|\s)\S*backend\/server\.js(\s|$)/.test(l)).map((l) => l.trim().split(/\s+/)[0]);
  const here = [];
  const elsewhere = [];
  for (const pid of pids) {
    const cwd = await fs.readlink(`/proc/${pid}/cwd`).catch(() => null);
    (cwd === null || cwd === path.dirname(ENV_FILE) ? here : elsewhere).push(pid);
  }
  return { here, elsewhere };
};

const main = async () => {
  const env = dotenv.parse(await fs.readFile(ENV_FILE, 'utf8'));
  if (!env.DNA_ENCRYPTION_KEY) throw new Error(`${ENV_FILE} holds no DNA_ENCRYPTION_KEY`);
  // The env file is the house's truth for this run; the backend modules below read process.env.
  Object.assign(process.env, Object.fromEntries(['WORKSPACES_ROOT', 'WITNESSES_ROOT', 'HARNESS_ROOT', 'NEUMA_DATA_ROOT', 'NEUMA_VAULT_ROOT']
    .filter((k) => env[k] && !process.env[k]).map((k) => [k, env[k]])));
  const { applyWorkspaceSettings } = await import('../backend/services/workspace-settings.js');
  const { getDataRoot, getVaultRoot } = await import('../backend/services/data-root.js');
  const { getWorkspacesRoot, getWitnessesRoot } = await import('../core/workspace/neuma-workspace.js');
  const { getHarnessRoot } = await import('../core/workspace/lane-grounds.js');
  const engine = await import('../core/workspace/rekey-house.js');
  await applyWorkspaceSettings();

  const stateFile = path.join(getDataRoot(), '.rekey-state.json');
  const state = await fs.readFile(stateFile, 'utf8').then(JSON.parse).catch(() => null);
  const previous = (env.DNA_ENCRYPTION_KEY_PREVIOUS || '').split(',').map((s) => s.trim()).filter(Boolean);
  let newSecret;
  let oldSecrets;
  if (state) {
    newSecret = env.DNA_ENCRYPTION_KEY;
    oldSecrets = previous;
    if (fingerprint(newSecret) !== state.fp) throw new Error('a re-key is in progress but the env file\'s key is not the one it started — stop and look');
    say(`RESUMING the re-key started ${state.startedAt}.`);
  } else {
    newSecret = crypto.randomBytes(32).toString('hex');
    oldSecrets = [env.DNA_ENCRYPTION_KEY, ...previous];
  }
  const house = path.resolve(getWorkspacesRoot());
  // The env file's own root counts even when the desk's saved choice wins over it: its beings are under this key.
  const named = [...new Set([...(env.WORKSPACES_ROOT ? [env.WORKSPACES_ROOT] : []), ...extraRoots].map((r) => path.resolve(r)))].filter((r) => r !== house);
  const grounds = [...new Set([house, getWitnessesRoot(), getHarnessRoot(house),
    ...named.flatMap((r) => [r, path.join(path.dirname(r), 'witnesses'), path.join(path.dirname(r), 'harness')])].map((g) => path.resolve(g)))];
  const inGround = (file) => grounds.some((g) => file === g || file.startsWith(g + path.sep));
  const oldMasters = engine.masterCandidates(oldSecrets);
  const newMaster = engine.masterCandidates([newSecret])[0].key;

  // Every other house beside these (<home>/<who>/<house>) and the checkout's own workspaces/: any whose beings
  // open with this key and is not in the run would be locked out when the old key goes.
  const homes = [...new Set([house, ...named].map((r) => path.dirname(path.dirname(r))))];
  const siblings = [path.join(REPO, 'workspaces')];
  for (const home of homes) {
    for (const who of await fs.readdir(home, { withFileTypes: true }).catch(() => [])) {
      if (!who.isDirectory()) continue;
      for (const h of await fs.readdir(path.join(home, who.name), { withFileTypes: true }).catch(() => [])) {
        if (h.isDirectory() && h.name !== 'platform') siblings.push(path.join(home, who.name, h.name));
      }
    }
  }
  // A backups folder (snapshots carrying manifest.json) is copies, not a house: it is named, never re-keyed.
  const isBackups = async (dir) => (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
    .some((d) => d.isDirectory() && fsSync.existsSync(path.join(dir, d.name, 'manifest.json')));
  const others = [...new Set(siblings)].filter((s) => !grounds.includes(path.resolve(s)));
  const backupRoots = [];
  for (const o of others) if (await isBackups(o)) backupRoots.push(o);
  const missing = await engine.housesUnderKey(others.filter((o) => !backupRoots.includes(o)), oldMasters);

  const backends = await liveBackends();
  say(`${APPLY ? 'RE-KEY' : 'DRY RUN — nothing is changed'} · env file ${ENV_FILE}`);
  for (const g of grounds) say(`  ground ${g}`);
  say(`  data ${getDataRoot()} · vault ${path.join(getVaultRoot(), 'dna')}`);
  if (missing.length) {
    say('  «STOP» beings in these houses also open with this key and are not in the run — add each with --root, or they are locked out:');
    missing.forEach((m) => say(`    --root ${m}`));
    if (APPLY) { process.exitCode = 2; return; }
  }
  if (backupRoots.length) say(`  backups (copies, not re-keyed — after the re-key only the old key opens them; make a fresh backup, then delete these): ${backupRoots.join(', ')}`);
  if (backends.elsewhere.length) say(`  backends of other checkouts (pids ${backends.elsewhere.join(', ')}) — not this house's grounds, not blocking.`);
  if (backends.here.length) {
    say(`  «STOP» this checkout's backends are running (pids ${backends.here.join(', ')}) — they would write under the old keys mid-run.`);
    if (APPLY) { process.exitCode = 2; return; }
  }

  if (APPLY && !state) {
    await fs.writeFile(stateFile, JSON.stringify({ startedAt: new Date().toISOString(), fp: fingerprint(newSecret) }), { mode: 0o600 });
    await writeEnvKeys(newSecret, oldSecrets);
    say('  the new master is in the env file; the old one stays as PREVIOUS until the house is proven.');
  }

  const totals = { lanes: 0, masterLanes: 0, moved: 0, staleBackups: 0, unreadable: [], closedDirs: 0 };
  const beingKeys = new Map();
  for (const ground of grounds) {
    for (const lane of await engine.lanesOn(ground)) {
      if (lane.dek) {
        const r = await engine.rekeyLane(lane, { oldMasters, newMaster, dryRun: !APPLY });
        totals.lanes += 1;
        if (r.newDek) beingKeys.set(lane.id, { oldDek: r.oldDek, newDek: r.newDek });
        totals.moved += r.moved; totals.staleBackups += r.staleBackups; totals.unreadable.push(...r.unreadable); totals.closedDirs += r.closedDirs?.length ?? 0;
        if (APPLY && !r.done && r.newDek) {
          await fs.mkdir(path.join(lane.dir, 'audit'), { recursive: true });
          await fs.appendFile(path.join(lane.dir, 'audit', 'audit.jsonl'), `${JSON.stringify({ timestamp: new Date().toISOString(), action: 'KEY_REKEYED', details: { note: 'Your lock was changed to a fresh key of your own. Nothing you wrote was changed.' } })}\n`);
        }
      } else {
        const r = await engine.resealTree(lane.dir, oldMasters, newMaster, { dryRun: !APPLY });
        totals.masterLanes += 1; totals.moved += r.moved; totals.staleBackups += r.staleBackups; totals.unreadable.push(...r.unreadable); totals.closedDirs += r.closedDirs.length;
      }
    }
  }
  const data = await engine.resealTree(getDataRoot(), oldMasters, newMaster, { dryRun: !APPLY, skip: inGround });
  const vault = await engine.rekeyVault(path.join(getVaultRoot(), 'dna'), beingKeys, { oldSecrets, newSecret, dryRun: !APPLY });
  say(`  beings with their own key: ${totals.lanes} · lanes on the master: ${totals.masterLanes} · files to re-seal: ${totals.moved + data.moved + vault.moved}`);
  say(`  install stores sealed by the master: ${data.moved} · DNA vault records: ${vault.moved} · old migration backups to drop: ${totals.staleBackups + data.staleBackups}`);
  if (totals.closedDirs) say(`  ${totals.closedDirs} folder(s) this user cannot open were passed over (no record the platform writes lives there).`);
  const foreign = totals.unreadable;
  if (foreign.length) { say(`  ${foreign.length} being file(s) hold records no key here opens — unreadable before this run, kept exactly as they are:`); foreign.slice(0, 20).forEach((f) => say(`    ${f}`)); }
  if (data.unreadable.length || vault.unreadable.length) say(`  ${data.unreadable.length + vault.unreadable.length} install file(s) this master never sealed (other keys, fixtures) — left as they are.`);
  if (!APPLY) { say('Run again with --apply once every backend on this house is stopped.'); return; }

  const stillOld = (await Promise.all([...grounds, getDataRoot()].map((d) => engine.stillOpenedByOld(d, oldMasters)))).flat();
  if (stillOld.length) {
    say(`  NOT FINISHED — ${stillOld.length} file(s) still open with the old key. The old key stays as PREVIOUS; run --apply again after looking.`);
    stillOld.slice(0, 20).forEach((f) => say(`    ${f}`));
    process.exitCode = 1;
    return;
  }
  await writeEnvKeys(newSecret, previous.filter((p) => !oldSecrets.includes(p)));
  await fs.unlink(stateFile);
  say('  DONE — every being holds a fresh key of its own; the old master opens nothing on these grounds and is gone from the env file.');
  say('  Backups made before today were sealed under the old key: make a fresh backup now, then delete the old ones.');
};

main().catch((err) => { process.stderr.write(`rekey-house: ${err.message}\n`); process.exitCode = 1; });
