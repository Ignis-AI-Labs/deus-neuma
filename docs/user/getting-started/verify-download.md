# Checking a download

Every release publishes, beside the installers:

- `SHA256SUMS`: the SHA-256 of each installer (AppImage, .deb, .rpm, and .exe when there is one).
- `SHA256SUMS.sig`: an ed25519 signature on `SHA256SUMS`, made with the Deus Neuma **release
  key**. That is the same key the app checks before it installs an update.
- `SHA256SUMS.asc`: a GPG signature on the same file, when the release carries one.

A good `SHA256SUMS.sig` shows that the list came from us. A matching SHA-256 then shows that your
download is the file on that list.

## The release key

The release key below signs every release, starting with 0.1.31.

```
Release public key:  MCowBQYDK2VwAyEA0nYKy1KL5025GP2LlgND4rPTrTWVzPBuJp4cWDuPeKk=
Fingerprint (SHA-256 of the key bytes):  221921cd3886955cef127262bf515f2a5427fdb34e8449f90fe7543c81030036
```

Copy the key from this page or from the app's source (`electron/release-public-key.cjs`). Never
copy it from the download folder.

## Check it with Node (no other tools)

Put the download, `SHA256SUMS` and `SHA256SUMS.sig` in one folder. Save this as `verify.mjs`
somewhere else, paste the release key into `KEY`, and run `node verify.mjs <that folder>`. It needs
Node 18 or newer and nothing else.

```js
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY = 'paste the release public key here';
const dir = process.argv[2] ?? '.';
const keyBytes = Buffer.from(KEY, 'base64');
console.log('fingerprint', createHash('sha256').update(keyBytes).digest('hex'));
const key = createPublicKey({ key: keyBytes, format: 'der', type: 'spki' });
const sums = readFileSync(join(dir, 'SHA256SUMS'));
// what the release key signs: a fixed tag, the file name, then the file's bytes
const message = Buffer.concat([Buffer.from('deus-neuma-feed-v1\nSHA256SUMS\n'), sums]);
const signature = Buffer.from(readFileSync(join(dir, 'SHA256SUMS.sig'), 'utf8').trim(), 'base64');
if (!verify(null, message, key, signature)) {
  console.error('SHA256SUMS is NOT signed by the release key. Do not install.');
  process.exit(1);
}
let failed = false;
for (const line of sums.toString('utf8').split('\n').filter(Boolean)) {
  const [hex, name] = [line.slice(0, 64), line.slice(66)];
  if (!existsSync(join(dir, name))) continue;
  const ok = createHash('sha256').update(readFileSync(join(dir, name))).digest('hex') === hex;
  console.log(ok ? 'OK  ' : 'BAD ', name);
  failed ||= !ok;
}
process.exit(failed ? 1 : 0);
```

The fingerprint it prints must match the one above. The output must say `OK` for your download,
with no `BAD` line.

## Or with the source

From a checkout of the app's source at the release's version:

```bash
node scripts/release-key.mjs --verify --dir <folder>
```

It checks every `.sig` in the folder against the key built into that checkout and prints the
fingerprint. It also checks every `SHA256SUMS` line for a file that is in the folder. Files that
aren't in the folder are listed as `absent`, which is fine. Any `FAIL` line means don't install.
