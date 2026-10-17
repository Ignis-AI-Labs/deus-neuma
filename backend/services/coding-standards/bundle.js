/** Packaged policy verification. Repository content cannot choose this trust root. */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLE_ROOT = fileURLToPath(new URL('./bundle/', import.meta.url));
const NAME = /^[A-Z][A-Z_]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 64 * 1024;

/** Pure — content identity used by import, CI, and runtime. */
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Pure — reject malformed routing before constructing any paths. */
export const validateManifest = (manifest) => {
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.version !== 'string'
    || !manifest.version.trim() || !HASH.test(manifest.sourceDigest)
    || !Array.isArray(manifest.core) || !manifest.core.length
    || !manifest.modules || typeof manifest.modules !== 'object' || Array.isArray(manifest.modules)
    || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('Invalid coding standards manifest.');
  }
  const names = [...manifest.core, ...Object.keys(manifest.modules)];
  if (names.length > 32 || new Set(names).size !== names.length
    || names.some((name) => typeof name !== 'string' || !NAME.test(name))
    || Object.values(manifest.modules).some((route) => typeof route !== 'string' || !route.trim())
    || Object.keys(manifest.files).length !== names.length
    || names.some((name) => !HASH.test(manifest.files[name]))) {
    throw new Error('Invalid coding standards module inventory.');
  }
  return Object.freeze(names);
};

// impure — bounded regular-file reads; symlinks and devices are not policy sources.
const readBounded = async (filename) => {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Invalid coding standards file.');
  const file = await fs.open(filename, 'r');
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES) throw new Error('Coding standards file exceeds its bound.');
    return buffer.subarray(0, bytesRead);
  } finally { await file.close(); }
};

/** impure — verify every shipped module; failures never become an empty policy. */
export const readStandardsBundle = async (root = BUNDLE_ROOT) => {
  const manifest = JSON.parse((await readBounded(path.join(root, 'manifest.json'))).toString('utf8'));
  const names = validateManifest(manifest);
  const sourceBytes = await readBounded(path.join(root, 'source-manifest.json'));
  const source = JSON.parse(sourceBytes.toString('utf8'));
  if (source.schema_version !== 1 || source.version !== manifest.version
    || JSON.stringify(source.core) !== JSON.stringify(manifest.core)
    || JSON.stringify(source.modules) !== JSON.stringify(manifest.modules)) {
    throw new Error('Coding standards routing differs from its canonical source.');
  }
  const documents = {};
  const sourceParts = [sourceBytes];
  for (const name of names) {
    const bytes = await readBounded(path.join(root, `${name}.md`));
    if (digest(bytes) !== manifest.files[name]) throw new Error(`Coding standards integrity failed: ${name}.`);
    sourceParts.push(Buffer.from(`\0${name}\0`), bytes);
    documents[name] = bytes.toString('utf8');
  }
  if (digest(Buffer.concat(sourceParts)) !== manifest.sourceDigest) throw new Error('Coding standards source digest differs.');
  const entries = await fs.readdir(root);
  if (entries.length !== names.length + 2 || entries.some((entry) => !['manifest.json', 'source-manifest.json'].includes(entry)
    && !names.some((name) => entry === `${name}.md`))) throw new Error('Unexpected coding standards files.');
  return Object.freeze({
    manifest: Object.freeze({ ...manifest, core: Object.freeze([...manifest.core]),
      modules: Object.freeze({ ...manifest.modules }), files: Object.freeze({ ...manifest.files }) }),
    documents: Object.freeze(documents),
  });
};
