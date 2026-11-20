#!/usr/bin/env node
/**
 * The master's copy off this machine — for someone with no password manager.
 * It writes ONE file that holds this install's master key (and the retired
 * ones), sealed under a passphrase you type. Copy the file to a USB stick or
 * another computer: the file alone opens nothing, the passphrase alone opens
 * nothing. No key and no passphrase is ever printed.
 *
 *   node scripts/master-recovery-file.mjs make <file>      # write the recovery file (asks the passphrase twice)
 *   node scripts/master-recovery-file.mjs check <file>     # does it open, and is it this install's key?
 *   node scripts/master-recovery-file.mjs restore <file>   # put the key back into the env file when it is missing
 *
 * Run it in your own terminal. Make a new file after every re-key
 * (scripts/rekey-house.mjs): the old file still opens, to the old key.
 * Env file: .env (NEUMA_REKEY_ENV_FILE overrides, as the re-key reads it).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { masterFingerprint as fingerprint, readRetiredMasters, retireMasters, retiredMastersPath } from '../core/workspace/retired-masters.js';
import { masterCheckPath, masterCheckState } from '../core/workspace/master-check.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = process.env.NEUMA_REKEY_ENV_FILE || path.join(REPO, '.env');
const SCRYPT = Object.freeze({ N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
const MIN_PASSPHRASE = 12;

const say = (line) => process.stdout.write(`${line}\n`);
const kdf = (passphrase, salt) => crypto.scryptSync(passphrase.normalize('NFKC'), salt, 32, SCRYPT);

// impure (stdin) — the lines typed: hidden on a terminal, read as they come from a pipe
const ask = async (prompts) => {
  const terminal = Boolean(process.stdin.isTTY);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal });
  if (terminal) rl._writeToOutput = () => {}; // what is typed is never echoed
  const lines = rl[Symbol.asyncIterator]();
  const answers = [];
  for (const prompt of prompts) {
    process.stdout.write(prompt);
    const { value, done } = await lines.next();
    if (terminal) process.stdout.write('\n');
    answers.push(done ? '' : value);
  }
  rl.close();
  return answers;
};

// pure (given the passphrase) — the sealed file's content
const seal = (payload, passphrase) => {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kdf(passphrase, salt), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { v: 1, what: 'neuma-master-recovery', kdf: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, createdAt: new Date().toISOString(),
    salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
};

// pure (given the passphrase) — the payload, or null when the passphrase is not the one
const open = (record, passphrase) => {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', kdf(passphrase, Buffer.from(record.salt, 'base64')), Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.ct, 'base64')), decipher.final()]).toString('utf8'));
  } catch { return null; }
};

const readRecord = (file) => {
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record?.what !== 'neuma-master-recovery') throw new Error(`${file} is not a Neuma master recovery file`);
  return record;
};

const envNow = () => (fs.existsSync(ENV_FILE) ? dotenv.parse(fs.readFileSync(ENV_FILE, 'utf8')) : {});
const dataRootOf = (env) => env.NEUMA_DATA_ROOT || process.env.NEUMA_DATA_ROOT || path.join(REPO, 'data');

const make = async (file) => {
  const env = envNow();
  const master = env.DNA_ENCRYPTION_KEY;
  if (!master) throw new Error(`${ENV_FILE} holds no DNA_ENCRYPTION_KEY — there is nothing to copy`);
  if (fs.existsSync(file)) throw new Error(`${file} is already there — name a new file; an older recovery file is never written over`);
  const [first, second] = await ask(['Passphrase for the recovery file (hidden, 12 characters or more): ', 'The same passphrase again: ']);
  if (first.length < MIN_PASSPHRASE) throw new Error('that passphrase is shorter than 12 characters — nothing was written');
  if (first !== second) throw new Error('the two passphrases are not the same — nothing was written');
  const retired = readRetiredMasters(retiredMastersPath(dataRootOf(env)), [master]);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(seal({ master, retired }, first), null, 2), { mode: 0o600, flag: 'wx' });
  const back = open(readRecord(file), first);
  if (back?.master !== master) { fs.rmSync(file, { force: true }); throw new Error('the recovery file did not open back to this install\'s key — it was removed'); }
  say(`Recovery file written: ${file}`);
  say(`  it holds this install's master key (${fingerprint(master)}) and ${retired.length} retired one(s), sealed under your passphrase.`);
  say('  Copy it off this computer. Without the passphrase it opens nothing; without the file the passphrase opens nothing.');
};

const check = async (file) => {
  const record = readRecord(file);
  const [passphrase] = await ask(['Passphrase of the recovery file (hidden): ']);
  const payload = open(record, passphrase);
  if (!payload) { say('That passphrase does not open this recovery file.'); process.exitCode = 1; return; }
  const master = envNow().DNA_ENCRYPTION_KEY;
  say(`The recovery file opens (written ${record.createdAt}; key ${fingerprint(payload.master)}; ${payload.retired.length} retired).`);
  say(master === payload.master ? '  It holds the key this install runs on now.'
    : '  It does NOT hold the key in the env file now — make a new recovery file (the key changed since this one was written).');
};

const restore = async (file) => {
  const record = readRecord(file);
  const [passphrase] = await ask(['Passphrase of the recovery file (hidden): ']);
  const payload = open(record, passphrase);
  if (!payload) throw new Error('that passphrase does not open this recovery file — nothing was changed');
  const env = envNow();
  const dataRoot = dataRootOf(env);
  const here = env.DNA_ENCRYPTION_KEY;
  if (here === payload.master) { say('The env file already holds this key — nothing to restore.'); return; }
  const check = masterCheckPath(dataRoot);
  // A key already in the env file is replaced only when the install's own check says it is the wrong one and this one is right.
  if (here && !(masterCheckState(check, [here]) === 'foreign' && masterCheckState(check, [payload.master]) === 'opens')) {
    throw new Error(`${ENV_FILE} already holds a different master key, and nothing here shows it is the wrong one — nothing was changed`);
  }
  const text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const kept = text.split('\n').filter((line) => !/^\s*DNA_ENCRYPTION_KEY\s*=/.test(line));
  while (kept.length && kept.at(-1) === '') kept.pop();
  const tmp = `${ENV_FILE}.restore.tmp`;
  fs.writeFileSync(tmp, `${[...kept, `DNA_ENCRYPTION_KEY=${payload.master}`].join('\n')}\n`, { mode: 0o600 });
  fs.renameSync(tmp, ENV_FILE);
  if (payload.retired.length || here) retireMasters(retiredMastersPath(dataRoot), [...payload.retired, ...(here ? [here] : [])], payload.master);
  say(`The master key (${fingerprint(payload.master)}) is back in ${ENV_FILE}. Start Neuma again.`);
};

const [verb, file] = process.argv.slice(2);
const acts = { make, check, restore };
if (!acts[verb] || !file) {
  say('usage: node scripts/master-recovery-file.mjs make|check|restore <file>');
  process.exitCode = 2;
} else {
  acts[verb](file).catch((err) => { process.stderr.write(`master-recovery-file: ${err.message}\n`); process.exitCode = 1; });
}
