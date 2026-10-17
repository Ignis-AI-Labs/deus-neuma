/** Canonical checkout reader shared by explicit import and read-only update checks. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, validateManifest } from './bundle.js';

/** impure — derive a content receipt without changing the canonical checkout. */
export const readCanonicalStandards = async (source) => {
  const sourceManifest = await fs.readFile(path.join(source, 'standards.json'));
  const upstream = JSON.parse(sourceManifest.toString('utf8'));
  if (upstream.schema_version !== 1 || !Array.isArray(upstream.core)
    || !upstream.modules || typeof upstream.modules !== 'object') throw new Error('Unsupported upstream standards schema.');
  const manifest = { schemaVersion: 1, version: upstream.version,
    sourceDigest: digest(sourceManifest), core: upstream.core, modules: upstream.modules,
    files: Object.fromEntries([...upstream.core, ...Object.keys(upstream.modules)].map((name) => [name, '0'.repeat(64)])) };
  const names = validateManifest(manifest);
  const files = {};
  for (const name of names) {
    files[name] = await fs.readFile(path.join(source, 'standards', `${name}.md`));
    manifest.files[name] = digest(files[name]);
  }
  const inventory = await fs.readdir(path.join(source, 'standards'));
  if (inventory.length !== names.length || inventory.some((file) => !names.some((name) => file === `${name}.md`))) {
    throw new Error('Upstream standards inventory differs from its manifest.');
  }
  manifest.sourceDigest = digest(Buffer.concat([sourceManifest,
    ...names.map((name) => Buffer.concat([Buffer.from(`\0${name}\0`), files[name]]))]));
  return { manifest, files, sourceManifest };
};
