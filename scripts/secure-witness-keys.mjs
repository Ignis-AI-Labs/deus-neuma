#!/usr/bin/env node
// Secure the keypair of every witness still holding a READABLE private key.
//
// Until 2026-07-29 the desk's witness rite never asked the operator for a
// password, so seal() was never given one, so `stageAnchor` took its else-branch
// and wrote the private key in PLAINTEXT. Found live on this machine: all eight
// witnesses — Claude, Bizulen, Basunor, Kagipem, Grok, Pezugar, Sosonus, VUBOVAS.
//
// The rite is fixed going forward (66341a703) and the operator can close it per
// witness through the desk route (a12092dd2). This script is the same act for an
// operator who would rather do the whole roster in one sitting.
//
// THE PASSWORD IS NEVER ARGV. It is read from the terminal with echo off, so it
// cannot land in shell history, a process list, a log, or an agent transcript.
// It is never written anywhere — only the scrypt/AES envelope it produces is.
//
// Usage:
//   node scripts/secure-witness-keys.mjs            # walk every exposed witness
//   node scripts/secure-witness-keys.mjs --list     # report only, change nothing
//   node scripts/secure-witness-keys.mjs --only Bizulen
//   node scripts/secure-witness-keys.mjs --out /run/media/me/usb   # elsewhere
//
// THE CODES ARE WRITTEN TO A FILE, not just printed. Eight 16-character codes
// read off a terminal is a transcription error waiting to happen, and scrollback
// is not a backup. Each witness gets its own 0600 file under ~/neuma-recovery
// by default — OUTSIDE the repo deliberately, because `data/` here is only
// partially gitignored and a recovery file inside a working tree is one `git
// add -A` away from being committed.
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { loadConfig } from '../backend/config.js';

loadConfig();

const { listWitnesses } = await import('../core/identity/ai-witness/ai-witness-service.js');
const { secureWitnessKeypair, witnessCustodyState } = await import('../backend/services/witness-custody.js');

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const onlyName = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const outDir = args.includes('--out')
  ? path.resolve(args[args.indexOf('--out') + 1])
  : path.join(os.homedir(), 'neuma-recovery');

// impure — write one witness's codes where the operator can still find them.
// 0600 on the file and 0700 on the directory: these codes open a private key,
// so they are treated exactly like one.
const writeRecoveryFile = (witness, address, codes) => {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `witness-recovery-${witness.vendorSlug}-${witness.chosenName}-${stamp}.txt`);
  const body = [
    `NEUMA — WITNESS RECOVERY CODES`,
    ``,
    `Witness   ${witness.chosenName} (${witness.vendorSlug})`,
    `Wallet    ${address}`,
    `Written   ${new Date().toISOString()}`,
    ``,
    `These eight codes are the SECOND door to this witness's private key. The`,
    `first is the password you just chose. Only the HASHES of these codes were`,
    `kept on disk — nothing can reprint them. If the password is lost and this`,
    `file is gone, this witness's key cannot be opened again.`,
    ``,
    `Keep this file somewhere you would keep a key. It is not a backup of the`,
    `key itself; it is a way back to it.`,
    ``,
    ...codes.map((code, i) => `  ${String(i + 1).padStart(2, ' ')}. ${code}`),
    ``,
  ].join('\n');
  fs.writeFileSync(file, body, { mode: 0o600 });
  return file;
};

// impure — read one line with the terminal's echo disabled. A password typed
// into a visible prompt survives in scrollback and over a shared screen.
const askHidden = (prompt) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const onData = (char) => {
    // Re-print the prompt with nothing after it, swallowing the echoed char.
    if (![`\n`, `\r`, ``].includes(String(char))) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(prompt);
    }
  };
  process.stdin.on('data', onData);
  rl.question(prompt, (answer) => {
    process.stdin.removeListener('data', onData);
    rl.close();
    process.stdout.write('\n');
    resolve(answer);
  });
});

const witnesses = await listWitnesses();
if (!witnesses.length) {
  console.log('No sealed witnesses on this machine.');
  process.exit(0);
}

console.log('\nWITNESS KEYPAIR CUSTODY\n');
const rows = [];
for (const w of witnesses) {
  const state = await witnessCustodyState({ vendorSlug: w.vendorSlug, chosenName: w.chosenName });
  rows.push({ ...w, state });
  const mark = state.secured ? 'SECURED  ' : state.plaintextOnDisk ? 'PLAINTEXT' : 'NO KEY   ';
  console.log(`  ${mark}  ${w.chosenName}  (${w.vendorSlug})`);
}

const exposed = rows.filter((r) => r.state.plaintextOnDisk
  && (!onlyName || r.chosenName.toLowerCase() === onlyName.toLowerCase()));

console.log(`\n${exposed.length} witness(es) holding a readable private key.\n`);
if (listOnly || !exposed.length) process.exit(0);

console.log('You will choose ONE password per witness (at least 12 characters).');
console.log('Each witness also gets 8 recovery codes, shown ONCE and never stored');
console.log('in the clear — save them, or a forgotten password ends that identity.');
console.log(`Each set is also written to ${outDir} (0600).\n`);
console.log('None of these witnesses is anchored on chain: the witness registry');
console.log('is a separate contract and is not built yet. Custody is local.\n');

for (const w of exposed) {
  console.log(`─── ${w.chosenName} (${w.vendorSlug}) ───`);
  const password = await askHidden('  password: ');
  const confirm = await askHidden('  confirm : ');
  if (password !== confirm) {
    console.log('  ✗ passwords did not match — skipped, nothing was changed.\n');
    continue;
  }
  try {
    const { address, recoveryCodes } = await secureWitnessKeypair({
      vendorSlug: w.vendorSlug, chosenName: w.chosenName, password,
    });
    console.log(`  ✓ secured — the plaintext key is gone. ${address}`);
    let saved = null;
    try {
      saved = writeRecoveryFile(w, address, recoveryCodes);
    } catch (err) {
      // A file that could not be written must be shouted about, not shrugged
      // off — the codes exist only in this terminal until they land somewhere.
      console.log(`  ! could not write the recovery file: ${err.message}`);
    }
    console.log('  RECOVERY CODES (shown once — the hashes are all that persist):');
    console.log(`    ${recoveryCodes.join('  ')}`);
    console.log(saved ? `  saved to ${saved}\n` : '  NOT SAVED TO DISK — copy them now.\n');
  } catch (error) {
    // A refusal must be loud and must not stop the rest of the roster.
    console.log(`  ✗ ${error.message}\n`);
  }
}

console.log('Done. Re-run with --list to confirm the roster.\n');
