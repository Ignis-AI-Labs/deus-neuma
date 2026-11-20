// Content attestation for unpacked desktop apps: public source blobs and clean build inputs.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const gitBlobSha = (bytes) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');

const filesUnder = (root, current = root, out = []) => {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) filesUnder(root, full, out);
    else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out.sort();
};

const BUILT = /^(?:node_modules|dist)\//;

/** Compare an app to public source blobs and the clean checkout it was built from. impure (filesystem). */
export const appContentProblems = ({ appRoot, referenceRoot, publicBlobs }) => {
  const problems = [];
  for (const name of filesUnder(appRoot)) {
    const bytes = fs.readFileSync(path.join(appRoot, name));
    if (publicBlobs[name]) {
      if (gitBlobSha(bytes) !== publicBlobs[name]) problems.push(`${name}: content is not the public Git blob`);
      continue;
    }
    if (!BUILT.test(name) && name !== 'build/release-notes.md') {
      problems.push(`${name}: not in the public tree or the declared build inputs`);
      continue;
    }
    const reference = path.join(referenceRoot, name);
    if (!fs.existsSync(reference)) problems.push(`${name}: absent from the clean build inputs`);
    else if (sha256Bytes(bytes) !== sha256Bytes(fs.readFileSync(reference))) problems.push(`${name}: content differs from the clean build inputs`);
  }
  return problems;
};

/** Recompute a CI content attestation over the app that actually reached the ship gate. impure. */
export const attestationProblems = ({ appRoot, attestation }) => {
  if (attestation?.schemaVersion !== 1 || !attestation.files || typeof attestation.files !== 'object') return ['content attestation has an unsupported shape'];
  const actual = filesUnder(appRoot);
  const expected = Object.keys(attestation.files).sort();
  const problems = [];
  for (const name of actual.filter((n) => !expected.includes(n))) problems.push(`${name}: absent from the content attestation`);
  for (const name of expected.filter((n) => !actual.includes(n))) problems.push(`${name}: attested but absent from the app`);
  for (const name of actual.filter((n) => expected.includes(n))) {
    const expectedHash = attestation.files[name];
    if (typeof expectedHash !== 'string' || !/^[0-9a-f]{64}$/.test(expectedHash)) problems.push(`${name}: attestation has no full SHA-256`);
    else if (sha256Bytes(fs.readFileSync(path.join(appRoot, name))) !== expectedHash) problems.push(`${name}: content does not match its attestation`);
  }
  return problems;
};

/** SHA-256 rows for one subtree, for cross-package comparison. impure. */
export const contentRows = (root, prefix = '') => Object.fromEntries(filesUnder(root).map((name) => [
  `${prefix}${name}`, sha256Bytes(fs.readFileSync(path.join(root, name))),
]));
