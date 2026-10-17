#!/usr/bin/env node
/**
 * sign-release.mjs — the Linux packages' signature, under Ignis AI Labs LLC.
 *
 * Linux has no OS-level code signing to satisfy, but people check what they
 * download (Design note, 2026-10-04: […]).
 * This writes SHA256SUMS over the given artifacts and signs it with the Ignis
 * release key — one detached, armored signature, the way Linux distributions
 * sign their images. Verify with:
 *   gpg --verify SHA256SUMS.asc SHA256SUMS && sha256sum -c SHA256SUMS
 *
 * The key is named by DEUS_NEUMA_SIGNING_KEY (fingerprint) and must already be
 * in this machine's GPG keyring; its passphrase goes to gpg-agent's own prompt,
 * never through this script. Nothing is signed by a key that is not there.
 *
 * Usage: DEUS_NEUMA_SIGNING_KEY=<fpr> node scripts/sign-release.mjs <artifact>...
 *   e.g. release/Deus-Neuma-0.1.30-x86_64.AppImage release/latest-linux.yml …
 * Writes SHA256SUMS + SHA256SUMS.asc beside the first artifact.
 */
import { createHash } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

// impure — the sha256 of a file, streamed (installers are ~600–900 MB)
const sha256Of = (path) => new Promise((done, fail) => {
  const hash = createHash('sha256');
  createReadStream(path).on('data', (b) => hash.update(b)).on('end', () => done(hash.digest('hex'))).on('error', fail);
});

/** The SHA256SUMS text: one `<hex>  <name>` line per artifact, sorted by name. Pure. */
export const sumsText = (rows) => [...rows]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(({ hex, name }) => `${hex}  ${name}\n`)
  .join('');

const main = async () => {
  const key = process.env.DEUS_NEUMA_SIGNING_KEY;
  const files = process.argv.slice(2).map((f) => resolve(f));
  if (!key) throw new Error('DEUS_NEUMA_SIGNING_KEY (the Ignis release key fingerprint) is not set');
  if (files.length === 0) throw new Error('usage: node scripts/sign-release.mjs <artifact>...');
  const dir = dirname(files[0]);
  if (files.some((f) => dirname(f) !== dir)) throw new Error('every artifact must sit in one folder (SHA256SUMS names them by file name)');
  // the key must be here, and must be able to sign
  execFileSync('gpg', ['--batch', '--list-secret-keys', key], { stdio: 'ignore' });

  const rows = [];
  for (const f of files) {
    await fsp.access(f);
    rows.push({ name: basename(f), hex: await sha256Of(f) });
    process.stdout.write(`  ${basename(f)}\n`);
  }
  const sums = join(dir, 'SHA256SUMS');
  await fsp.writeFile(sums, sumsText(rows));
  await fsp.rm(`${sums}.asc`, { force: true });
  execFileSync('gpg', ['--local-user', key, '--armor', '--detach-sign', '--output', `${sums}.asc`, sums], { stdio: 'inherit' });
  execFileSync('gpg', ['--verify', `${sums}.asc`, sums], { stdio: 'inherit' });
  process.stdout.write(`signed ${rows.length} artifact(s) → ${sums} + ${sums}.asc\n`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { process.stderr.write(`sign-release: ${err.message}\n`); process.exit(1); });
}
